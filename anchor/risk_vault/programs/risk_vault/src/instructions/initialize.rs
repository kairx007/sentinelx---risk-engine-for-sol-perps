use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    constants::{RISK_STATE_SEED, VAULT_SEED},
    state::{ContagionState, RiskLevel, RiskState, Vault},
};

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub collateral_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, collateral_mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = authority,
        space = 8 + RiskState::INIT_SPACE,
        seeds = [RISK_STATE_SEED, vault.key().as_ref()],
        bump
    )]
    pub risk_state: Account<'info, RiskState>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = collateral_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_vault(
    ctx: Context<InitializeVault>,
    risk_authority: Pubkey,
) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.risk_authority = risk_authority;
    vault.collateral_mint = ctx.accounts.collateral_mint.key();
    vault.total_deposits = 0;
    vault.total_shares = 0;
    vault.bump = ctx.bumps.vault;

    let risk_state = &mut ctx.accounts.risk_state;
    risk_state.risk_level = RiskLevel::Critical;
    risk_state.risk_score = 100;
    risk_state.contagion_state = ContagionState::Active;
    risk_state.max_leverage_x100 = 0;
    risk_state.observed_at = 0;
    risk_state.updated_at = 0;
    risk_state.nonce = 0;
    risk_state.bump = ctx.bumps.risk_state;

    emit!(VaultInitialized {
        vault: vault.key(),
        authority: vault.authority,
        risk_authority: vault.risk_authority,
        collateral_mint: vault.collateral_mint,
    });

    Ok(())
}

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub authority: Pubkey,
    pub risk_authority: Pubkey,
    pub collateral_mint: Pubkey,
}
