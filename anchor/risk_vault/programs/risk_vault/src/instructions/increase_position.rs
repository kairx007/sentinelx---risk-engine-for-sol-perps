use anchor_lang::prelude::*;

use crate::{
    constants::{POSITION_SEED, RISK_STATE_SEED, USER_VAULT_SEED, VAULT_SEED},
    errors::VaultError,
    math::{collateral_for_withdrawal, leverage_x100},
    policy::{validate_action_against_risk_state, ActionKind},
    state::{Position, PositionSide, PositionStatus, RiskState, UserVaultAccount, Vault},
};

#[derive(Accounts)]
pub struct IncreasePosition<'info> {
    #[account(mut)]
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
    #[account(
        seeds = [RISK_STATE_SEED, vault.key().as_ref()],
        bump = risk_state.bump
    )]
    pub risk_state: Account<'info, RiskState>,
    /// CHECK: A market is an opaque identifier in this MVP and is bound to the position PDA.
    pub market: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, vault.key().as_ref(), owner.key().as_ref(), market.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    pub clock: Sysvar<'info, Clock>,
    pub system_program: Program<'info, System>,
}

pub fn handle_increase_position(
    ctx: Context<IncreasePosition>,
    side: PositionSide,
    size_delta: u64,
    notional_delta: u64,
    collateral_delta: u64,
) -> Result<()> {
    require!(
        ctx.accounts.market.key() != Pubkey::default(),
        VaultError::InvalidMarket
    );
    require!(
        size_delta > 0 && notional_delta > 0,
        VaultError::InvalidPrice
    );
    require!(collateral_delta > 0, VaultError::ZeroCollateral);

    let user = &ctx.accounts.user_vault_account;
    let total_collateral = collateral_for_withdrawal(
        user.shares,
        ctx.accounts.vault.total_deposits,
        ctx.accounts.vault.total_shares,
    )?;
    require!(
        user.locked_collateral <= total_collateral,
        VaultError::InconsistentAccounting
    );
    let free_collateral = total_collateral
        .checked_sub(user.locked_collateral)
        .ok_or(VaultError::InconsistentAccounting)?;
    require!(
        collateral_delta <= free_collateral,
        VaultError::InsufficientFreeCollateral
    );

    let position_is_new = ctx.accounts.position.owner == Pubkey::default();
    if !position_is_new {
        require!(
            ctx.accounts.position.owner == ctx.accounts.owner.key()
                && ctx.accounts.position.vault == ctx.accounts.vault.key()
                && ctx.accounts.position.market == ctx.accounts.market.key(),
            VaultError::InvalidPosition
        );
        require!(
            ctx.accounts.position.status == PositionStatus::Open,
            VaultError::PositionAlreadyClosed
        );
        require!(
            ctx.accounts.position.side == side,
            VaultError::PositionSideMismatch
        );
    }

    let current_size = if position_is_new {
        0
    } else {
        ctx.accounts.position.size
    };
    let current_notional = if position_is_new {
        0
    } else {
        ctx.accounts.position.notional
    };
    let current_locked = if position_is_new {
        0
    } else {
        ctx.accounts.position.collateral_locked
    };
    let resulting_size = current_size
        .checked_add(size_delta)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let resulting_notional = current_notional
        .checked_add(notional_delta)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let resulting_locked = current_locked
        .checked_add(collateral_delta)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let resulting_leverage = leverage_x100(resulting_notional, resulting_locked)?;

    validate_action_against_risk_state(
        &ctx.accounts.risk_state,
        ActionKind::IncreaseExposure,
        ctx.accounts.clock.unix_timestamp,
        Some(resulting_leverage),
    )?;

    let position = &mut ctx.accounts.position;
    if position_is_new {
        position.owner = ctx.accounts.owner.key();
        position.vault = ctx.accounts.vault.key();
        position.market = ctx.accounts.market.key();
        position.side = side;
        position.opened_at = ctx.accounts.clock.unix_timestamp;
        position.status = PositionStatus::Open;
        position.bump = ctx.bumps.position;
    }
    position.size = resulting_size;
    position.notional = resulting_notional;
    position.collateral_locked = resulting_locked;
    ctx.accounts.user_vault_account.locked_collateral = ctx
        .accounts
        .user_vault_account
        .locked_collateral
        .checked_add(collateral_delta)
        .ok_or(VaultError::ArithmeticOverflow)?;

    emit!(PositionIncreased {
        vault: ctx.accounts.vault.key(),
        owner: ctx.accounts.owner.key(),
        market: ctx.accounts.market.key(),
        side,
        resulting_size,
        resulting_exposure: resulting_notional,
        collateral_locked: resulting_locked,
    });
    Ok(())
}

#[event]
pub struct PositionIncreased {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub side: PositionSide,
    pub resulting_size: u64,
    pub resulting_exposure: u64,
    pub collateral_locked: u64,
}
