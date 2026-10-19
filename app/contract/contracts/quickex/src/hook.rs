use crate::{
    errors::QuickexError,
    events::{publish_hook_invocation_failed, publish_hook_invocation_skipped},
    storage,
    types::{HookEventKind, HookFailureReason},
};
use soroban_sdk::{
    contractclient, xdr::ScErrorType, Address, BytesN, Env, Error as HostError, IntoVal, Symbol,
    Vec,
};

/// Interface that must be implemented by any contract registering as a QuickEx hook.
///
/// Hooks are invoked synchronously during the main contract's lifecycle events
/// (`Create`, `Settle`, `Refund`).
///
/// ## Failure Isolation
/// Any error, panic, or trap within a hook is swallowed by the QuickEx contract
/// and does NOT abort the primary transaction. A failing hook will simply be
/// skipped for that event, and the QuickEx transaction will proceed. The
/// skip/failure itself is still observable off-chain: see
/// [`crate::events::HookInvocationFailedEvent`] and
/// [`crate::events::HookInvocationSkippedEvent`] (SC-W7-05).
///
/// ## Invocation Ordering
/// Hooks are invoked in the order they were registered.
///
/// ## Resource Limits
/// Hook execution consumes Soroban compute and storage budget from the overall
/// transaction limits. Because hook failures do not abort the parent transaction,
/// if a hook traps (e.g. out of memory, generic panic), it is ignored. However,
/// if the hook consumes too much overall CPU or memory budget such that the
/// parent transaction hits its limits, the entire transaction will fail.
/// Hook integrators must be mindful of their compute overhead.
#[contractclient(name = "HookInterfaceClient")]
pub trait HookInterface {
    fn on_escrow_event(
        env: Env,
        event_kind: u32,
        escrow_id: BytesN<32>,
        owner: Address,
        token: Address,
        amount: i128,
        fee: i128,
    );
}

pub fn register_hook(env: &Env, hook_contract: Address) -> Result<(), QuickexError> {
    if !storage::is_hook_allowed(env, &hook_contract) {
        return Err(QuickexError::HookNotAllowed);
    }
    let mut hooks = storage::get_registered_hooks(env);
    if hooks.contains(hook_contract.clone()) {
        return Err(QuickexError::HookAlreadyRegistered);
    }
    hooks.push_back(hook_contract);
    storage::set_registered_hooks(env, &hooks);
    Ok(())
}

pub fn unregister_hook(env: &Env, hook_contract: Address) -> Result<(), QuickexError> {
    let hooks = storage::get_registered_hooks(env);
    let mut updated = Vec::new(env);
    let mut found = false;
    for hook in hooks {
        if hook != hook_contract {
            updated.push_back(hook);
        } else {
            found = true;
        }
    }
    if !found {
        return Err(QuickexError::HookNotRegistered);
    }
    storage::set_registered_hooks(env, &updated);
    Ok(())
}

pub fn get_registered_hooks(env: &Env) -> Vec<Address> {
    storage::get_registered_hooks(env)
}

pub fn assert_not_reentrant(env: &Env) -> Result<(), QuickexError> {
    if storage::get_reentrancy_guard(env) {
        return Err(QuickexError::ReentrancyDetected);
    }
    Ok(())
}

pub fn invoke_hooks(
    env: &Env,
    event_kind: HookEventKind,
    escrow_id: &BytesN<32>,
    owner: Address,
    token: Address,
    amount: i128,
    fee: i128,
) {
    let event_kind_code = event_kind as u32;

    if storage::get_reentrancy_guard(env) {
        // The whole batch is skipped, not just one hook — no hook in the
        // registry gets invoked for this event while the guard is held.
        let hook_count = storage::get_registered_hooks(env).len();
        publish_hook_invocation_skipped(
            env,
            escrow_id.clone(),
            event_kind_code,
            HookFailureReason::ReentrancyGuardActive as u32,
            hook_count,
        );
        return;
    }

    storage::set_reentrancy_guard(env, &true);
    let hooks = storage::get_registered_hooks(env);
    for hook in hooks {
        let args = soroban_sdk::vec![
            env,
            event_kind_code.into_val(env),
            escrow_id.into_val(env),
            owner.clone().into_val(env),
            token.clone().into_val(env),
            amount.into_val(env),
            fee.into_val(env),
        ];
        // A failing hook must never abort the primary transaction — the
        // result is inspected only to classify and publish a failure
        // reason, never propagated as an error. The error type is
        // `HostError` (not `Val`): a `Val` would accept any error shape,
        // including the trap the host synthesizes for a raw hook panic, so
        // it can't tell "the hook aborted" apart from "the hook returned a
        // structured contract error" — `HostError::is_type` can.
        let result = env.try_invoke_contract::<soroban_sdk::Val, HostError>(
            &hook,
            &Symbol::new(env, "on_escrow_event"),
            args,
        );
        if let Err(invoke_err) = result {
            let reason = match invoke_err {
                // The hook ran to completion and returned an explicit
                // contract error (e.g. via `panic_with_error!`).
                Ok(err) if err.is_type(ScErrorType::Contract) => HookFailureReason::ContractError,
                // Anything else — a raw panic/trap, exceeded resource
                // limits, or a host-level invocation failure.
                _ => HookFailureReason::InvocationAborted,
            };
            publish_hook_invocation_failed(
                env,
                hook,
                escrow_id.clone(),
                event_kind_code,
                reason as u32,
            );
        }
    }
    storage::set_reentrancy_guard(env, &false);
}
