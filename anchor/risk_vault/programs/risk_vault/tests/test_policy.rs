use risk_vault::policy::{validate_action_against_risk_state, ActionKind};
use risk_vault::state::{ContagionState, RiskLevel, RiskState};

fn make_state(
    risk_level: RiskLevel,
    contagion_state: ContagionState,
    max_leverage_x100: u16,
    observed_at: i64,
    updated_at: i64,
    nonce: u64,
) -> RiskState {
    RiskState {
        risk_level,
        risk_score: match risk_level {
            RiskLevel::Low => 15,
            RiskLevel::Medium => 35,
            RiskLevel::High => 60,
            RiskLevel::Critical => 90,
        },
        contagion_state,
        max_leverage_x100,
        observed_at,
        updated_at,
        nonce,
        bump: 0,
    }
}

#[test]
fn uninitialized_risk_state_blocks_new_exposure_but_allows_exits() {
    let state = make_state(RiskLevel::Low, ContagionState::None, 300, 0, 0, 0);

    assert!(validate_action_against_risk_state(
        &state,
        ActionKind::IncreaseExposure,
        1_000,
        Some(100),
    )
    .is_err());
    assert!(
        validate_action_against_risk_state(&state, ActionKind::ReduceExposure, 1_000, None,)
            .is_ok()
    );
    assert!(
        validate_action_against_risk_state(&state, ActionKind::ClosePosition, 1_000, None,).is_ok()
    );
    assert!(validate_action_against_risk_state(&state, ActionKind::Withdraw, 1_000, None,).is_ok());
}

#[test]
fn stale_risk_state_blocks_new_exposure_and_allows_exit_paths() {
    let state = make_state(RiskLevel::Critical, ContagionState::Active, 0, 100, 100, 1);

    assert!(validate_action_against_risk_state(
        &state,
        ActionKind::IncreaseExposure,
        100 + risk_vault::constants::MAX_RISK_STATE_AGE_SECONDS + 1,
        Some(1),
    )
    .is_err());
    assert!(validate_action_against_risk_state(
        &state,
        ActionKind::ReduceExposure,
        100 + risk_vault::constants::MAX_RISK_STATE_AGE_SECONDS + 1,
        None,
    )
    .is_ok());
    assert!(validate_action_against_risk_state(
        &state,
        ActionKind::ClosePosition,
        100 + risk_vault::constants::MAX_RISK_STATE_AGE_SECONDS + 1,
        None,
    )
    .is_ok());
    assert!(validate_action_against_risk_state(
        &state,
        ActionKind::Withdraw,
        100 + risk_vault::constants::MAX_RISK_STATE_AGE_SECONDS + 1,
        None,
    )
    .is_ok());
}

#[test]
fn low_risk_allows_up_to_three_x_and_rejects_higher_leverage() {
    let fresh = make_state(RiskLevel::Low, ContagionState::None, 300, 1_000, 1_000, 1);
    assert!(validate_action_against_risk_state(
        &fresh,
        ActionKind::IncreaseExposure,
        1_000,
        Some(250),
    )
    .is_ok());
    assert!(validate_action_against_risk_state(
        &fresh,
        ActionKind::IncreaseExposure,
        1_000,
        Some(300),
    )
    .is_ok());
    assert!(validate_action_against_risk_state(
        &fresh,
        ActionKind::IncreaseExposure,
        1_000,
        Some(301),
    )
    .is_err());
}

#[test]
fn medium_risk_allows_up_to_two_x_and_rejects_higher_leverage() {
    let fresh = make_state(
        RiskLevel::Medium,
        ContagionState::None,
        200,
        1_000,
        1_000,
        1,
    );
    assert!(validate_action_against_risk_state(
        &fresh,
        ActionKind::IncreaseExposure,
        1_000,
        Some(200),
    )
    .is_ok());
    assert!(validate_action_against_risk_state(
        &fresh,
        ActionKind::IncreaseExposure,
        1_000,
        Some(201),
    )
    .is_err());
}

#[test]
fn high_risk_allows_one_x_and_rejects_more() {
    let fresh = make_state(RiskLevel::High, ContagionState::None, 100, 1_000, 1_000, 1);
    assert!(validate_action_against_risk_state(
        &fresh,
        ActionKind::IncreaseExposure,
        1_000,
        Some(100),
    )
    .is_ok());
    assert!(validate_action_against_risk_state(
        &fresh,
        ActionKind::IncreaseExposure,
        1_000,
        Some(101),
    )
    .is_err());
}

#[test]
fn critical_risk_and_active_contagion_block_new_exposure() {
    let critical = make_state(
        RiskLevel::Critical,
        ContagionState::Active,
        0,
        1_000,
        1_000,
        1,
    );
    assert!(validate_action_against_risk_state(
        &critical,
        ActionKind::IncreaseExposure,
        1_000,
        Some(1),
    )
    .is_err());

    let developing = make_state(
        RiskLevel::Low,
        ContagionState::Developing,
        300,
        1_000,
        1_000,
        1,
    );
    assert!(validate_action_against_risk_state(
        &developing,
        ActionKind::IncreaseExposure,
        1_000,
        Some(100),
    )
    .is_ok());
    assert!(validate_action_against_risk_state(
        &developing,
        ActionKind::IncreaseExposure,
        1_000,
        Some(101),
    )
    .is_err());
}

#[test]
fn configured_state_cap_cannot_be_bypassed() {
    let state = make_state(RiskLevel::Low, ContagionState::None, 200, 1_000, 1_000, 1);
    assert!(validate_action_against_risk_state(
        &state,
        ActionKind::IncreaseExposure,
        1_000,
        Some(200),
    )
    .is_ok());
    assert!(validate_action_against_risk_state(
        &state,
        ActionKind::IncreaseExposure,
        1_000,
        Some(201),
    )
    .is_err());
}

#[test]
fn future_observed_timestamp_rejects_new_exposure() {
    let state = make_state(
        RiskLevel::Low,
        ContagionState::None,
        300,
        1_000_000,
        1_000,
        1,
    );
    assert!(validate_action_against_risk_state(
        &state,
        ActionKind::IncreaseExposure,
        1_000,
        Some(100),
    )
    .is_err());
}
