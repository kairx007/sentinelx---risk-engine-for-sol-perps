use anchor_lang::prelude::*;

use crate::{
    constants::{POSITION_SEED, USER_VAULT_SEED, VAULT_SEED},
    errors::VaultError,
    state::{Position, PositionStatus, UserVaultAccount, Vault},
};

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    pub owner: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED, vault.collateral_mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [USER_VAULT_SEED, vault.key().as_ref(), owner.key().as_ref()],
        bump = user_vault_account.bump,
        has_one = owner,
        has_one = vault
    )]
    pub user_vault_account: Account<'info, UserVaultAccount>,
    /// CHECK: The market is constrained by the position PDA and stored market field.
    pub market: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [POSITION_SEED, vault.key().as_ref(), owner.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = vault,
        has_one = market
    )]
    pub position: Account<'info, Position>,
}

pub fn handle_close_position(ctx: Context<ClosePosition>) -> Result<()> {
    require!(
        ctx.accounts.position.status == PositionStatus::Open,
        VaultError::PositionAlreadyClosed
    );
    let released_collateral = ctx.accounts.position.collateral_locked;
    require!(
        released_collateral <= ctx.accounts.user_vault_account.locked_collateral,
        VaultError::InconsistentAccounting
    );
    let side = ctx.accounts.position.side;
    ctx.accounts.position.size = 0;
    ctx.accounts.position.notional = 0;
    ctx.accounts.position.collateral_locked = 0;
    ctx.accounts.position.status = PositionStatus::Closed;
    ctx.accounts.user_vault_account.locked_collateral = ctx
        .accounts
        .user_vault_account
        .locked_collateral
        .checked_sub(released_collateral)
        .ok_or(VaultError::InconsistentAccounting)?;

    emit!(PositionClosed {
        vault: ctx.accounts.vault.key(),
        owner: ctx.accounts.owner.key(),
        market: ctx.accounts.market.key(),
        side,
        collateral_released: released_collateral,
    });
    Ok(())
}

#[event]
pub struct PositionClosed {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub side: crate::state::PositionSide,
    pub collateral_released: u64,
}
