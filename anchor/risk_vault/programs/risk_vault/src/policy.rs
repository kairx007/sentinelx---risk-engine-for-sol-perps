use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACTIVE_MAX_LEVERAGE_X100, CRITICAL_MAX_LEVERAGE_X100, DEVELOPING_MAX_LEVERAGE_X100,
        HIGH_MAX_LEVERAGE_X100, LOW_MAX_LEVERAGE_X100, MAX_FUTURE_SKEW_SECONDS,
        MAX_RISK_STATE_AGE_SECONDS, MEDIUM_MAX_LEVERAGE_X100,
    },
    errors::VaultError,
    state::{ContagionState, RiskLevel, RiskState},
};

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ActionKind {
    IncreaseExposure,
    ReduceExposure,
    ClosePosition,
    Withdraw,
}

pub fn level_cap_for_risk_level(risk_level: RiskLevel) -> u16 {
    match risk_level {
        RiskLevel::Low => LOW_MAX_LEVERAGE_X100,
        RiskLevel::Medium => MEDIUM_MAX_LEVERAGE_X100,
        RiskLevel::High => HIGH_MAX_LEVERAGE_X100,
        RiskLevel::Critical => CRITICAL_MAX_LEVERAGE_X100,
    }
}

pub fn contagion_cap_for_state(contagion_state: ContagionState) -> u16 {
    match contagion_state {
        ContagionState::None | ContagionState::Isolated => u16::MAX,
        ContagionState::Developing => DEVELOPING_MAX_LEVERAGE_X100,
        ContagionState::Active => ACTIVE_MAX_LEVERAGE_X100,
    }
}

pub fn effective_policy_cap(risk_level: RiskLevel, contagion_state: ContagionState) -> u16 {
    level_cap_for_risk_level(risk_level).min(contagion_cap_for_state(contagion_state))
}

pub fn effective_leverage_cap(risk_state: &RiskState) -> u16 {
    effective_policy_cap(risk_state.risk_level, risk_state.contagion_state)
        .min(risk_state.max_leverage_x100)
}

pub fn validate_action_against_risk_state(
    risk_state: &RiskState,
    action: ActionKind,
    current_timestamp: i64,
    resulting_leverage_x100: Option<u16>,
) -> Result<()> {
    match action {
        ActionKind::ReduceExposure | ActionKind::ClosePosition | ActionKind::Withdraw => {
            return Ok(());
        }
        ActionKind::IncreaseExposure => {
            require!(
                risk_state.nonce > 0 && risk_state.updated_at > 0,
                VaultError::RiskStateNotInitialized
            );

            require!(risk_state.observed_at >= 0, VaultError::RiskStateStale);
            let age = current_timestamp
                .checked_sub(risk_state.updated_at)
                .ok_or(VaultError::RiskStateStale)?;
            require!(
                age <= MAX_RISK_STATE_AGE_SECONDS,
                VaultError::RiskStateStale
            );
            require!(
                risk_state.observed_at
                    <= current_timestamp
                        .checked_add(MAX_FUTURE_SKEW_SECONDS)
                        .ok_or(VaultError::RiskStateStale)?,
                VaultError::RiskStateStale
            );

            let resulting_leverage =
                resulting_leverage_x100.ok_or(VaultError::ExposureIncreaseBlocked)?;
            let effective_cap = effective_leverage_cap(risk_state);
            require!(
                resulting_leverage <= effective_cap,
                VaultError::LeverageLimitExceeded
            );
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::ReduceExposure,
            1_000,
            None
        )
        .is_ok());
        assert!(
            validate_action_against_risk_state(&state, ActionKind::ClosePosition, 1_000, None)
                .is_ok()
        );
        assert!(
            validate_action_against_risk_state(&state, ActionKind::Withdraw, 1_000, None).is_ok()
        );
    }

    #[test]
    fn stale_risk_state_blocks_new_exposure() {
        let state = make_state(RiskLevel::Critical, ContagionState::Active, 0, 100, 100, 1);
        let stale_time = 100 + MAX_RISK_STATE_AGE_SECONDS + 1;
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            stale_time,
            Some(1)
        )
        .is_err());
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::ReduceExposure,
            stale_time,
            None
        )
        .is_ok());
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::ClosePosition,
            stale_time,
            None
        )
        .is_ok());
        assert!(
            validate_action_against_risk_state(&state, ActionKind::Withdraw, stale_time, None)
                .is_ok()
        );
    }

    #[test]
    fn low_risk_allows_up_to_three_x() {
        let state = make_state(RiskLevel::Low, ContagionState::None, 300, 1_000, 1_000, 1);
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            1_000,
            Some(250)
        )
        .is_ok());
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            1_000,
            Some(300)
        )
        .is_ok());
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            1_000,
            Some(301)
        )
        .is_err());
    }

    #[test]
    fn medium_risk_allows_up_to_two_x() {
        let state = make_state(
            RiskLevel::Medium,
            ContagionState::None,
            200,
            1_000,
            1_000,
            1,
        );
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            1_000,
            Some(200)
        )
        .is_ok());
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            1_000,
            Some(201)
        )
        .is_err());
    }

    #[test]
    fn high_risk_allows_up_to_one_x() {
        let state = make_state(RiskLevel::High, ContagionState::None, 100, 1_000, 1_000, 1);
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            1_000,
            Some(100)
        )
        .is_ok());
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            1_000,
            Some(101)
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
            Some(1)
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
            Some(100)
        )
        .is_ok());
        assert!(validate_action_against_risk_state(
            &developing,
            ActionKind::IncreaseExposure,
            1_000,
            Some(101)
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
            Some(200)
        )
        .is_ok());
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            1_000,
            Some(201)
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
            Some(100)
        )
        .is_err());
    }

    #[test]
    fn clock_timestamp_overflow_fails_closed() {
        let state = make_state(RiskLevel::Low, ContagionState::None, 300, 1, 1, 1);
        assert!(validate_action_against_risk_state(
            &state,
            ActionKind::IncreaseExposure,
            i64::MAX,
            Some(100),
        )
        .is_err());
    }
}
