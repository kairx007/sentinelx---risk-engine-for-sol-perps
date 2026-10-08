use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    constants::{USER_VAULT_SEED, VAULT_SEED},
    errors::VaultError,
    math::{shares_for_deposit, validate_accounting},
    state::{UserVaultAccount, Vault},
};

#[derive(Accounts)]
pub struct DepositAccounts<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, collateral_mint.key().as_ref()],
        bump = vault.bump,
        has_one = collateral_mint
    )]
    pub vault: Account<'info, Vault>,
    pub collateral_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [USER_VAULT_SEED, vault.key().as_ref(), owner.key().as_ref()],
        bump = user_vault_account.bump,
        has_one = owner,
        has_one = vault
    )]
    pub user_vault_account: Account<'info, UserVaultAccount>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = owner
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = collateral_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_deposit(ctx: Context<DepositAccounts>, amount: u64) -> Result<()> {
    let vault = &ctx.accounts.vault;
    validate_accounting(
        vault.total_deposits,
        vault.total_shares,
        ctx.accounts.vault_token_account.amount,
    )?;

    let shares = shares_for_deposit(amount, vault.total_deposits, vault.total_shares)?;
    let total_deposits = vault
        .total_deposits
        .checked_add(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let total_shares = vault
        .total_shares
        .checked_add(shares)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let user_shares = ctx
        .accounts
        .user_vault_account
        .shares
        .checked_add(shares)
        .ok_or(VaultError::ArithmeticOverflow)?;

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    ctx.accounts.vault.total_deposits = total_deposits;
    ctx.accounts.vault.total_shares = total_shares;
    ctx.accounts.user_vault_account.shares = user_shares;

    emit!(Deposit {
        user: ctx.accounts.owner.key(),
        vault: ctx.accounts.vault.key(),
        amount,
        shares,
    });
    Ok(())
}

#[event]
pub struct Deposit {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub amount: u64,
    pub shares: u64,
}
