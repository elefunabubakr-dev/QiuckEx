use soroban_sdk::{
    testutils::{Address as _, EnvTestConfig},
    xdr::ToXdr,
    Address, Env, Vec,
};

use crate::{
    errors::QuickexError,
    storage::{self, DataKey, MAX_PRIVACY_HISTORY},
    QuickexContract, QuickexContractClient,
};

fn setup() -> (Env, Address, Address) {
    let env = Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    let contract_id = env.register(QuickexContract, ());
    let owner = Address::generate(&env);
    let admin = Address::generate(&env);
    QuickexContractClient::new(&env, &contract_id).initialize(&admin);
    (env, contract_id, owner)
}

#[test]
fn privacy_history_empty_account_returns_empty_without_creating_storage() {
    let (env, contract_id, owner) = setup();
    let client = QuickexContractClient::new(&env, &contract_id);
    assert!(client.privacy_history(&owner).is_empty());
    env.as_contract(&contract_id, || {
        assert!(!env
            .storage()
            .persistent()
            .has(&DataKey::PrivacyHistory(owner)));
    });
}

#[test]
fn privacy_history_repeated_toggles_bound_storage_and_serialized_return() {
    let (env, contract_id, owner) = setup();
    let client = QuickexContractClient::new(&env, &contract_id);
    // Twenty times the cap, resetting the budget like separate transactions.
    // No unlimited budget masks a growing per-call storage/serialization cost.
    for i in 0..MAX_PRIVACY_HISTORY * 20 {
        env.cost_estimate().budget().reset_default();
        let level = u32::from(i % 2 == 0);
        assert_eq!(client.enable_privacy(&owner, &level), level == 1);
        let history = client.privacy_history(&owner);
        assert_eq!(history.len(), (i + 1).min(MAX_PRIVACY_HISTORY));
        assert_eq!(history.get(0), Some(level));
        assert_eq!(client.get_privacy(&owner), level == 1);
        assert_eq!(client.privacy_status(&owner), Some(level));
        assert!(history.to_xdr(&env).len() <= 524);
        env.as_contract(&contract_id, || {
            let stored: Vec<u32> = env
                .storage()
                .persistent()
                .get(&DataKey::PrivacyHistory(owner.clone()))
                .unwrap();
            assert_eq!(stored.len(), (i + 1).min(MAX_PRIVACY_HISTORY));
        });
    }
    assert_eq!(client.privacy_history(&owner).to_xdr(&env).len(), 524);
}

#[test]
fn privacy_history_reads_bound_legacy_records_without_mutating_them() {
    let (env, contract_id, owner) = setup();
    let client = QuickexContractClient::new(&env, &contract_id);
    let mut legacy = Vec::new(&env);
    for i in 0..MAX_PRIVACY_HISTORY * 8 {
        legacy.push_back(u32::from(i % 3 == 0));
    }
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::PrivacyHistory(owner.clone()), &legacy);
    });
    let bounded = client.privacy_history(&owner);
    assert_eq!(bounded, legacy.slice(..MAX_PRIVACY_HISTORY));
    assert_eq!(bounded.to_xdr(&env).len(), 524);
    assert!(!client.get_privacy(&owner));
    env.as_contract(&contract_id, || {
        let stored: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::PrivacyHistory(owner.clone()))
            .unwrap();
        assert_eq!(stored, legacy);
    });
}

#[test]
fn privacy_history_append_compacts_legacy_and_evicts_only_oldest_entries() {
    let (env, contract_id, owner) = setup();
    let client = QuickexContractClient::new(&env, &contract_id);
    let mut legacy = Vec::new(&env);
    for i in 0..MAX_PRIVACY_HISTORY * 4 {
        legacy.push_back(u32::from(i % 3 == 0));
    }
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .set(&DataKey::PrivacyHistory(owner.clone()), &legacy);
    });
    client.enable_privacy(&owner, &1);
    let mut expected = legacy.slice(..MAX_PRIVACY_HISTORY - 1);
    expected.push_front(1);
    assert_eq!(client.privacy_history(&owner), expected);
    env.as_contract(&contract_id, || {
        let stored: Vec<u32> = env
            .storage()
            .persistent()
            .get(&DataKey::PrivacyHistory(owner.clone()))
            .unwrap();
        assert_eq!(stored, expected);
        storage::add_privacy_history(&env, &owner, 0);
        let mut next = expected.slice(..MAX_PRIVACY_HISTORY - 1);
        next.push_front(0);
        assert_eq!(storage::get_privacy_history(&env, &owner), next);
    });
}

#[test]
fn privacy_history_rejected_calls_and_canonical_setter_do_not_append() {
    let (env, contract_id, owner) = setup();
    let client = QuickexContractClient::new(&env, &contract_id);
    client.enable_privacy(&owner, &1);
    let before = client.privacy_history(&owner);
    assert_eq!(
        client.try_enable_privacy(&owner, &1),
        Err(Ok(QuickexError::PrivacyAlreadySet))
    );
    assert_eq!(
        client.try_enable_privacy(&owner, &2),
        Err(Ok(QuickexError::InvalidPrivacyLevel))
    );
    assert_eq!(client.privacy_history(&owner), before);
    client.set_privacy(&owner, &false);
    assert_eq!(client.privacy_history(&owner), before);
    assert!(!client.get_privacy(&owner));
}

#[test]
fn privacy_history_compacting_one_account_never_changes_another() {
    let (env, contract_id, owner) = setup();
    let client = QuickexContractClient::new(&env, &contract_id);
    let other = Address::generate(&env);
    client.enable_privacy(&other, &1);
    let before = client.privacy_history(&other);
    env.as_contract(&contract_id, || {
        for level in 0..MAX_PRIVACY_HISTORY * 2 {
            storage::add_privacy_history(&env, &owner, level % 2);
        }
    });
    assert_eq!(client.privacy_history(&owner).len(), MAX_PRIVACY_HISTORY);
    assert_eq!(client.privacy_history(&other), before);
    assert!(client.get_privacy(&other));
}
