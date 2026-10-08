use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{constants::VAULT_SEED, state::Vault};

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
