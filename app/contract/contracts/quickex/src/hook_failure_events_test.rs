//! Tests for SC-W7-05 (Issue #669): hook failure isolation observability.
//!
//! `hook::invoke_hooks` already isolates the primary transaction from a
//! failing or skipped hook (deposit/withdraw/refund succeed regardless).
//! These tests prove the *observability* half of that contract: every
//! non-success outcome for a hook call now emits a stable, reason-coded
//! event (`HookInvocationFailed` or `HookInvocationSkipped`), and the
//! primary transaction's own events/state are unaffected either way.
//!
//! Covers both failure shapes named in the ticket:
//! - "reverting" — the hook call aborts (a raw panic/trap), tested via
//!   [`PanickingHook`] and [`test_panicking_hook_emits_invocation_aborted`].
//! - "non-reverting" — the hook runs to completion but signals failure with
//!   an explicit contract error, tested via [`GracefullyFailingHook`] and
//!   [`test_hook_contract_error_emits_contract_error_reason`].
//!
//! Plus the batch-skip path (`test_reentrancy_skip_emits_hook_invocation_skipped`),
//! which — like the existing reentrancy-guard tests — is only reachable by
//! calling `hook::invoke_hooks` directly rather than through the public
//! contract API, since every state-mutating entrypoint already rejects a
//! genuinely reentrant call before it would reach that internal guard.
//!
//! **Test-harness note:** `env.events().all()` only returns events from the
//! *most recent* top-level contract call, not an accumulated log across the
//! whole test. Every assertion here reads events immediately after the
//! action under test and before any other contract call (including a
//! `ctx.balance(...)` read, which is itself a top-level call to the token
//! contract) — otherwise the events being asserted on would already be gone
//! by the time they're checked, not because they were never emitted.

#![cfg(test)]
#![allow(dead_code)]

use soroban_sdk::{
    contract, contracterror, contractimpl, panic_with_error, symbol_short, testutils::Events as _,
    Address, BytesN, Env, Map, Symbol, TryIntoVal, Val,
};

use crate::{
    hook, storage,
    test_context::TestContext,
    types::{HookEventKind, HookFailureReason},
};

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

/// Well-behaved hook: counts invocations. Used to prove a failing hook
/// doesn't stop *other* registered hooks from still firing normally, and as
/// a negative control (a healthy hook must never emit a failure event).
#[contract]
pub struct CountingHook;

#[contractimpl]
impl CountingHook {
    pub fn on_escrow_event(
        env: Env,
        _event_kind: u32,
        _escrow_id: BytesN<32>,
        _owner: Address,
        _token: Address,
        _amount: i128,
        _fee: i128,
    ) {
        let key = symbol_short!("count");
        let count: u32 = env.storage().persistent().get(&key).unwrap_or(0);
        env.storage().persistent().set(&key, &(count + 1));
    }

    pub fn count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&symbol_short!("count"))
            .unwrap_or(0)
    }
}

/// "Reverting" failure: aborts with a raw panic (host-level trap), not a
/// structured contract error. Exercises `HookFailureReason::InvocationAborted`.
#[contract]
pub struct PanickingHook;

#[contractimpl]
impl PanickingHook {
    pub fn on_escrow_event(
        _env: Env,
        _event_kind: u32,
        _escrow_id: BytesN<32>,
        _owner: Address,
        _token: Address,
        _amount: i128,
        _fee: i128,
    ) {
        panic!("PanickingHook: deliberate abort");
    }
}

/// A hook-local error type, deliberately distinct from `QuickexError`, to
/// show the failure classification in `hook::invoke_hooks` doesn't depend
/// on any specific error type a hook happens to use — any explicit
/// contract error a hook returns is classified as `ContractError`.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MockHookError {
    DeliberateFailure = 1,
}

/// "Non-reverting" failure: runs to completion and returns a structured
/// contract error instead of aborting. Exercises `HookFailureReason::ContractError`.
#[contract]
pub struct GracefullyFailingHook;

#[contractimpl]
impl GracefullyFailingHook {
    pub fn on_escrow_event(
        env: Env,
        _event_kind: u32,
        _escrow_id: BytesN<32>,
        _owner: Address,
        _token: Address,
        _amount: i128,
        _fee: i128,
    ) {
        panic_with_error!(env, MockHookError::DeliberateFailure);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn allow_and_register_hook(ctx: &TestContext, hook_id: &Address) {
    ctx.client.set_hook_allowed(&ctx.admin, hook_id, &true);
    ctx.client.register_hook(hook_id);
}

/// Finds the most recent event on `contract_id` named `event_name` and
/// returns its (topics, data) pair, or `None` if no such event was emitted.
///
/// Must be called before any other contract call — see the module doc
/// comment on why `env.events().all()` is call-scoped, not cumulative.
fn find_event(
    env: &Env,
    contract_id: &Address,
    event_name: &str,
) -> Option<(soroban_sdk::Vec<Val>, Val)> {
    let all = env.events().all();
    for i in (0..all.len()).rev() {
        let event = all.get(i).unwrap();
        if event.0 != *contract_id {
            continue;
        }
        let topics = event.1.clone();
        if topics.len() < 2 {
            continue;
        }
        let name: Symbol = topics.get(1).unwrap().try_into_val(env).unwrap();
        if name == Symbol::new(env, event_name) {
            return Some((event.1, event.2));
        }
    }
    None
}

fn event_data_map(env: &Env, data: Val) -> Map<Symbol, Val> {
    data.try_into_val(env).unwrap()
}

fn u32_field(env: &Env, data: &Map<Symbol, Val>, key: &str) -> u32 {
    data.get(Symbol::new(env, key))
        .unwrap()
        .try_into_val(env)
        .unwrap()
}

// ---------------------------------------------------------------------------
// Tests: per-hook failure events (isolation preserved either way)
// ---------------------------------------------------------------------------

/// A hook that aborts with a raw panic must not stop the primary deposit,
/// and must be reported as `InvocationAborted` — not silently swallowed.
#[test]
fn test_panicking_hook_emits_invocation_aborted() {
    let ctx = TestContext::with_admin();
    let hook_id = ctx.env.register(PanickingHook, ());
    allow_and_register_hook(&ctx, &hook_id);

    let commitment = ctx.simple_deposit(&ctx.alice, 1000, b"abort-salt");

    // Read events from the deposit call before anything else touches the
    // env (a balance check is itself a top-level call — see module docs).
    let (topics, data) = find_event(&ctx.env, &ctx.client.address, "HookInvocationFailed")
        .expect("HookInvocationFailed event must be emitted");

    // Primary flow succeeded despite the hook aborting.
    assert_eq!(ctx.balance(&ctx.alice), 0);
    assert_eq!(ctx.balance(&ctx.client.address), 1000);

    // topics: [TOPIC_ESCROW, "HookInvocationFailed", hook_contract, escrow_id]
    let event_hook_contract: Address = topics.get(2).unwrap().try_into_val(&ctx.env).unwrap();
    let event_escrow_id: BytesN<32> = topics.get(3).unwrap().try_into_val(&ctx.env).unwrap();
    assert_eq!(event_hook_contract, hook_id);
    assert_eq!(event_escrow_id, commitment);

    let map = event_data_map(&ctx.env, data);
    assert_eq!(
        u32_field(&ctx.env, &map, "event_kind"),
        HookEventKind::Create as u32
    );
    assert_eq!(
        u32_field(&ctx.env, &map, "reason"),
        HookFailureReason::InvocationAborted as u32
    );
}

/// A hook that returns a structured contract error (no panic/trap) must
/// also leave the primary flow untouched, and must be reported distinctly
/// as `ContractError` rather than `InvocationAborted`.
#[test]
fn test_hook_contract_error_emits_contract_error_reason() {
    let ctx = TestContext::with_admin();
    // Register the hook after the deposit so only withdraw's Settle event
    // (the one under test) triggers it — keeps this test focused on one
    // failure, not two.
    let commitment = ctx.simple_deposit(&ctx.alice, 1000, b"ce-salt");
    let salt = ctx.salt(b"ce-salt");

    let hook_id = ctx.env.register(GracefullyFailingHook, ());
    allow_and_register_hook(&ctx, &hook_id);

    ctx.client.withdraw(
        &ctx.token,
        &1000i128,
        &commitment,
        &ctx.alice,
        &salt,
        &0u64,
        &u64::MAX,
    );

    let (_, data) = find_event(&ctx.env, &ctx.client.address, "HookInvocationFailed")
        .expect("HookInvocationFailed event must be emitted");
    let map = event_data_map(&ctx.env, data);
    assert_eq!(
        u32_field(&ctx.env, &map, "event_kind"),
        HookEventKind::Settle as u32
    );
    assert_eq!(
        u32_field(&ctx.env, &map, "reason"),
        HookFailureReason::ContractError as u32
    );

    // Primary flow succeeded despite the hook's explicit error.
    assert_eq!(ctx.balance(&ctx.alice), 1000);
}

/// A failing hook must not stop *other* registered hooks from firing: the
/// failure is isolated per-hook, not just isolated from the primary flow.
#[test]
fn test_failing_hook_does_not_block_other_registered_hooks() {
    let ctx = TestContext::with_admin();
    let panicking_id = ctx.env.register(PanickingHook, ());
    let counting_id = ctx.env.register(CountingHook, ());
    allow_and_register_hook(&ctx, &panicking_id);
    allow_and_register_hook(&ctx, &counting_id);

    ctx.simple_deposit(&ctx.alice, 1000, b"multi-salt");

    assert!(find_event(&ctx.env, &ctx.client.address, "HookInvocationFailed").is_some());

    let counting_client = CountingHookClient::new(&ctx.env, &counting_id);
    assert_eq!(counting_client.count(), 1);
}

/// A healthy hook must never emit a failure event — the gate is precise,
/// not a blanket "hook ran" signal.
#[test]
fn test_healthy_hook_emits_no_failure_or_skip_events() {
    let ctx = TestContext::with_admin();
    let hook_id = ctx.env.register(CountingHook, ());
    allow_and_register_hook(&ctx, &hook_id);

    ctx.simple_deposit(&ctx.alice, 1000, b"healthy-salt");

    assert!(find_event(&ctx.env, &ctx.client.address, "HookInvocationFailed").is_none());
    assert!(find_event(&ctx.env, &ctx.client.address, "HookInvocationSkipped").is_none());
}

// ---------------------------------------------------------------------------
// Test: batch-skip event
// ---------------------------------------------------------------------------

/// When `invoke_hooks` is entered while the reentrancy guard is already
/// held, the whole batch is skipped — no hook is invoked at all — and that
/// must be observable as a distinct `HookInvocationSkipped` event, not
/// silence. Like the existing reentrancy-guard tests, this path isn't
/// reachable through the public contract API (every state-mutating
/// entrypoint already rejects a reentrant call earlier), so it's exercised
/// by calling `hook::invoke_hooks` directly.
#[test]
fn test_reentrancy_skip_emits_hook_invocation_skipped() {
    let ctx = TestContext::with_admin();
    let hook_id = ctx.env.register(CountingHook, ());
    allow_and_register_hook(&ctx, &hook_id);

    let escrow_id = BytesN::from_array(&ctx.env, &[7u8; 32]);

    ctx.env.as_contract(&ctx.client.address, || {
        storage::set_reentrancy_guard(&ctx.env, &true);
        hook::invoke_hooks(
            &ctx.env,
            HookEventKind::Refund,
            &escrow_id,
            ctx.alice.clone(),
            ctx.token.clone(),
            1000i128,
            0i128,
        );
        storage::set_reentrancy_guard(&ctx.env, &false);
    });

    let (topics, data) = find_event(&ctx.env, &ctx.client.address, "HookInvocationSkipped")
        .expect("HookInvocationSkipped event must be emitted");

    // No hook was actually invoked — the whole batch was skipped.
    let counting_client = CountingHookClient::new(&ctx.env, &hook_id);
    assert_eq!(counting_client.count(), 0);

    // topics: [TOPIC_ESCROW, "HookInvocationSkipped", escrow_id]
    let event_escrow_id: BytesN<32> = topics.get(2).unwrap().try_into_val(&ctx.env).unwrap();
    assert_eq!(event_escrow_id, escrow_id);

    let map = event_data_map(&ctx.env, data);
    assert_eq!(
        u32_field(&ctx.env, &map, "event_kind"),
        HookEventKind::Refund as u32
    );
    assert_eq!(
        u32_field(&ctx.env, &map, "reason"),
        HookFailureReason::ReentrancyGuardActive as u32
    );
    assert_eq!(u32_field(&ctx.env, &map, "hook_count"), 1);
}
