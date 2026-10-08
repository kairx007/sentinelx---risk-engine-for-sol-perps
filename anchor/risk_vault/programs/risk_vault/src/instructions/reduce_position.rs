use anchor_lang::prelude::*;

use crate::{
    constants::{POSITION_SEED, USER_VAULT_SEED, VAULT_SEED},
    errors::VaultError,
    state::{Position, PositionStatus, UserVaultAccount, Vault},
};

#[derive(Accounts)]
pub struct ReducePosition<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
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

pub fn handle_reduce_position(
    ctx: Context<ReducePosition>,
    size_delta: u64,
    notional_delta: u64,
) -> Result<()> {
    let position = &ctx.accounts.position;
    require!(
        position.status == PositionStatus::Open,
        VaultError::PositionNotOpen
    );
    require!(
        size_delta > 0
            && notional_delta > 0
            && size_delta <= position.size
            && notional_delta <= position.notional,
        VaultError::InvalidReduction
    );

    let released_collateral = if notional_delta == position.notional {
        position.collateral_locked
    } else {
        let released = (position.collateral_locked as u128)
            .checked_mul(notional_delta as u128)
            .ok_or(VaultError::ArithmeticOverflow)?
            .checked_div(position.notional as u128)
            .ok_or(VaultError::ArithmeticOverflow)?;
        u64::try_from(released).map_err(|_| error!(VaultError::ConversionOverflow))?
    };
    require!(
        released_collateral > 0,
        VaultError::CollateralReleaseTooSmall
    );
    require!(
        released_collateral <= ctx.accounts.user_vault_account.locked_collateral,
        VaultError::InconsistentAccounting
    );

    let remaining_size = position
        .size
        .checked_sub(size_delta)
        .ok_or(VaultError::InvalidReduction)?;
    let remaining_notional = position
        .notional
        .checked_sub(notional_delta)
        .ok_or(VaultError::InvalidReduction)?;
    let remaining_collateral = position
        .collateral_locked
        .checked_sub(released_collateral)
        .ok_or(VaultError::InvalidReduction)?;
    require!(
        (remaining_notional == 0) == (remaining_collateral == 0),
        VaultError::InvalidPosition
    );
    require!(
        remaining_notional > 0 || remaining_size == 0,
        VaultError::InvalidPosition
    );

    let position = &mut ctx.accounts.position;
    position.size = remaining_size;
    position.notional = remaining_notional;
    position.collateral_locked = remaining_collateral;
    ctx.accounts.user_vault_account.locked_collateral = ctx
        .accounts
        .user_vault_account
        .locked_collateral
        .checked_sub(released_collateral)
        .ok_or(VaultError::InconsistentAccounting)?;

    emit!(PositionReduced {
        vault: ctx.accounts.vault.key(),
        owner: ctx.accounts.owner.key(),
        market: ctx.accounts.market.key(),
        side: position.side,
        resulting_size: remaining_size,
        resulting_exposure: remaining_notional,
        collateral_locked: remaining_collateral,
    });
    Ok(())
}

#[event]
pub struct PositionReduced {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub side: crate::state::PositionSide,
    pub resulting_size: u64,
    pub resulting_exposure: u64,
    pub collateral_locked: u64,
}
