use anchor_lang::prelude::*;

use crate::{
    constants::{
        MAX_FUTURE_SKEW_SECONDS, MAX_RISK_SCORE, MAX_RISK_STATE_AGE_SECONDS, RISK_STATE_SEED,
        VAULT_SEED,
    },
    errors::VaultError,
    policy::effective_policy_cap,
    state::{ContagionState, RiskLevel, RiskState, Vault},
};

#[derive(Accounts)]
pub struct UpdateRiskState<'info> {
    #[account(address = vault.risk_authority @ VaultError::UnauthorizedRiskAuthority)]
    pub risk_authority: Signer<'info>,
    #[account(seeds = [VAULT_SEED, vault.collateral_mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [RISK_STATE_SEED, vault.key().as_ref()],
        bump = risk_state.bump
    )]
    pub risk_state: Account<'info, RiskState>,
    pub clock: Sysvar<'info, Clock>,
}

fn score_matches_level(risk_level: RiskLevel, risk_score: u8) -> bool {
    match risk_level {
        RiskLevel::Low => risk_score <= 25,
        RiskLevel::Medium => (26..=50).contains(&risk_score),
        RiskLevel::High => (51..=75).contains(&risk_score),
        RiskLevel::Critical => (76..=100).contains(&risk_score),
    }
}

pub fn handle_update_risk_state(
    ctx: Context<UpdateRiskState>,
    risk_level: RiskLevel,
    risk_score: u8,
    contagion_state: ContagionState,
    max_leverage_x100: u16,
    observed_at: i64,
    nonce: u64,
) -> Result<()> {
    require!(risk_score <= MAX_RISK_SCORE, VaultError::InvalidRiskScore);
    require!(
        score_matches_level(risk_level, risk_score),
        VaultError::RiskLevelScoreMismatch
    );
    require!(
        max_leverage_x100 <= effective_policy_cap(risk_level, contagion_state),
        VaultError::InvalidRiskPolicy
    );
    require!(observed_at >= 0, VaultError::InvalidRiskTimestamp);

    let now = ctx.accounts.clock.unix_timestamp;
    let latest_allowed_timestamp = now
        .checked_add(MAX_FUTURE_SKEW_SECONDS)
        .ok_or(VaultError::InvalidRiskTimestamp)?;
    require!(
        observed_at <= latest_allowed_timestamp,
        VaultError::FutureRiskTimestamp
    );
    let age = now
        .checked_sub(observed_at)
        .ok_or(VaultError::InvalidRiskTimestamp)?;
    require!(
        age <= MAX_RISK_STATE_AGE_SECONDS,
        VaultError::StaleRiskUpdate
    );

    let expected_nonce = ctx
        .accounts
        .risk_state
        .nonce
        .checked_add(1)
        .ok_or(VaultError::NonceExhausted)?;
    require!(nonce == expected_nonce, VaultError::InvalidNonce);

    let risk_state = &mut ctx.accounts.risk_state;
    risk_state.risk_level = risk_level;
    risk_state.risk_score = risk_score;
    risk_state.contagion_state = contagion_state;
    risk_state.max_leverage_x100 = max_leverage_x100;
    risk_state.observed_at = observed_at;
    risk_state.updated_at = now;
    risk_state.nonce = nonce;

    emit!(RiskStateUpdated {
        vault: ctx.accounts.vault.key(),
        risk_authority: ctx.accounts.risk_authority.key(),
        risk_level,
        risk_score,
        contagion_state,
        max_leverage_x100,
        observed_at,
        updated_at: now,
        nonce,
    });
    Ok(())
}

#[event]
pub struct RiskStateUpdated {
    pub vault: Pubkey,
    pub risk_authority: Pubkey,
    pub risk_level: RiskLevel,
    pub risk_score: u8,
    pub contagion_state: ContagionState,
    pub max_leverage_x100: u16,
    pub observed_at: i64,
    pub updated_at: i64,
    pub nonce: u64,
}
