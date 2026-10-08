use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    constants::{USER_VAULT_SEED, VAULT_SEED},
    errors::VaultError,
    math::{collateral_for_withdrawal, validate_accounting},
    state::{UserVaultAccount, Vault},
};

#[derive(Accounts)]
pub struct WithdrawAccounts<'info> {
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
        associated_token::mint = collateral_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = collateral_mint,
        token::authority = owner
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw(ctx: Context<WithdrawAccounts>, shares: u64) -> Result<()> {
    let vault = &ctx.accounts.vault;
    validate_accounting(
        vault.total_deposits,
        vault.total_shares,
        ctx.accounts.vault_token_account.amount,
    )?;
    require!(
        ctx.accounts.user_vault_account.shares <= vault.total_shares,
        VaultError::InconsistentAccounting
    );
    require!(
        shares <= ctx.accounts.user_vault_account.shares,
        VaultError::InsufficientUserShares
    );

    let amount = collateral_for_withdrawal(shares, vault.total_deposits, vault.total_shares)?;
    require!(
        ctx.accounts.user_vault_account.locked_collateral
            <= collateral_for_withdrawal(
                ctx.accounts.user_vault_account.shares,
                vault.total_deposits,
                vault.total_shares,
            )?,
        VaultError::InconsistentAccounting
    );
    let free_collateral = collateral_for_withdrawal(
        ctx.accounts.user_vault_account.shares,
        vault.total_deposits,
        vault.total_shares,
    )?
    .checked_sub(ctx.accounts.user_vault_account.locked_collateral)
    .ok_or(VaultError::InconsistentAccounting)?;
    let free_collateral = free_collateral
        .checked_sub(ctx.accounts.user_vault_account.settlement_reserved)
        .ok_or(VaultError::InconsistentAccounting)?;
    require!(
        amount <= free_collateral,
        VaultError::InsufficientFreeCollateral
    );
    let total_deposits = vault
        .total_deposits
        .checked_sub(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let total_shares = vault
        .total_shares
        .checked_sub(shares)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let user_shares = ctx
        .accounts
        .user_vault_account
        .shares
        .checked_sub(shares)
        .ok_or(VaultError::InsufficientUserShares)?;

    let mint_key = ctx.accounts.collateral_mint.key();
    let bump = [vault.bump];
    let signer_seeds: &[&[u8]] = &[VAULT_SEED, mint_key.as_ref(), &bump];
    let signer = &[signer_seeds];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        ),
        amount,
    )?;

    ctx.accounts.vault.total_deposits = total_deposits;
    ctx.accounts.vault.total_shares = total_shares;
    ctx.accounts.user_vault_account.shares = user_shares;

    emit!(Withdraw {
        user: ctx.accounts.owner.key(),
        vault: ctx.accounts.vault.key(),
        amount,
        shares,
    });
    Ok(())
}

#[event]
pub struct Withdraw {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub amount: u64,
    pub shares: u64,
}
