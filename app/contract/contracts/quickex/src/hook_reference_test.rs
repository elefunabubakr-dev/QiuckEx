#![cfg(test)]
#![allow(dead_code)]

use crate::test_context::TestContext;
use reference_hook::{ReferenceHook, ReferenceHookClient};

#[test]
fn test_reference_hook_success_and_failure_isolation() {
    let ctx = TestContext::with_admin();

    // Register the reference hook in the env
    let hook_id = ctx.env.register(ReferenceHook, ());
    let hook_client = ReferenceHookClient::new(&ctx.env, &hook_id);

    // Register it in the QuickEx contract
    ctx.client.set_hook_allowed(&ctx.admin, &hook_id, &true);
    ctx.client.register_hook(&hook_id);

    // Create a new escrow (triggers Create hook)
    let amount = 1000;
    let commitment = ctx.simple_deposit(&ctx.alice, amount, b"test-hook-salt");

    // Check stats (1 create)
    let stats = hook_client.get_stats();
    assert_eq!(stats.total_events, 1);
    assert_eq!(stats.created, 1);
    assert_eq!(stats.settled, 0);

    // Withdraw (triggers Settle hook)
    let salt = ctx.salt(b"test-hook-salt");
    ctx.client.withdraw(
        &ctx.token,
        &amount,
        &commitment,
        &ctx.alice,
        &salt,
        &0u64,
        &u64::MAX,
    );

    let stats = hook_client.get_stats();
    assert_eq!(stats.total_events, 2);
    assert_eq!(stats.created, 1);
    assert_eq!(stats.settled, 1);
}
