use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::{
    constants::{
        MARKET_CONFIG_SEED, POSITION_SCHEMA_VERSION, POSITION_SEED, USER_VAULT_SEED, VAULT_SEED,
    },
    errors::VaultError,
    math::unrealized_pnl,
    oracle::validate_pyth_price,
    state::{MarketConfig, Position, PositionStatus, UserVaultAccount, Vault},
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
        seeds = [MARKET_CONFIG_SEED, vault.key().as_ref(), market.key().as_ref()],
        bump = market_config.bump,
        has_one = vault,
        has_one = market
    )]
    pub market_config: Account<'info, MarketConfig>,
    #[account(address = market_config.oracle_update_account)]
    pub oracle_update_account: Account<'info, PriceUpdateV2>,
    #[account(
        mut,
        seeds = [POSITION_SEED, vault.key().as_ref(), owner.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        has_one = vault,
        has_one = market
    )]
    pub position: Account<'info, Position>,
    pub clock: Sysvar<'info, Clock>,
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
        position.schema_version == POSITION_SCHEMA_VERSION,
        VaultError::InvalidPositionVersion
    );
    require!(
        size_delta > 0
            && notional_delta > 0
            && size_delta <= position.size
            && notional_delta <= position.notional,
        VaultError::InvalidReduction
    );
    let expected_notional_delta = if size_delta == position.size {
        position.notional
    } else {
        u64::try_from(
            (position.notional as u128)
                .checked_mul(size_delta as u128)
                .ok_or(VaultError::ArithmeticOverflow)?
                .checked_div(position.size as u128)
                .ok_or(VaultError::ArithmeticOverflow)?,
        )
        .map_err(|_| error!(VaultError::ConversionOverflow))?
    };
    require!(
        notional_delta == expected_notional_delta,
        VaultError::InvalidReduction
    );

    let price = validate_pyth_price(
        &ctx.accounts.oracle_update_account,
        &ctx.accounts.market_config,
        ctx.accounts.oracle_update_account.key(),
        ctx.accounts.clock.unix_timestamp,
    )?;
    let diagnostic_pnl =
        unrealized_pnl(position.side, size_delta, position.entry_price, price.price)?;

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
    let reserve_collateral = if diagnostic_pnl < 0 {
        released_collateral
    } else {
        0
    };
    let slice_equity = (released_collateral as i128)
        .checked_add(diagnostic_pnl)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let bad_debt_increment = if slice_equity < 0 {
        u64::try_from(
            slice_equity
                .checked_neg()
                .ok_or(VaultError::ArithmeticOverflow)?,
        )
        .map_err(|_| error!(VaultError::ConversionOverflow))?
    } else {
        0
    };
    require!(
        (remaining_notional == 0) == (remaining_collateral == 0),
        VaultError::InvalidPosition
    );
    require!(
        (remaining_notional == 0) == (remaining_size == 0),
        VaultError::InvalidPosition
    );

    let position = &mut ctx.accounts.position;
    position.size = remaining_size;
    position.notional = remaining_notional;
    position.collateral_locked = remaining_collateral;
    if remaining_size == 0 {
        position.status = PositionStatus::Closed;
    }
    position.bad_debt = position
        .bad_debt
        .checked_add(bad_debt_increment)
        .ok_or(VaultError::ArithmeticOverflow)?;
    ctx.accounts.user_vault_account.locked_collateral = ctx
        .accounts
        .user_vault_account
        .locked_collateral
        .checked_sub(released_collateral)
        .ok_or(VaultError::InconsistentAccounting)?;
    ctx.accounts.user_vault_account.settlement_reserved = ctx
        .accounts
        .user_vault_account
        .settlement_reserved
        .checked_add(reserve_collateral)
        .ok_or(VaultError::ArithmeticOverflow)?;

    emit!(PositionReduced {
        vault: ctx.accounts.vault.key(),
        owner: ctx.accounts.owner.key(),
        market: ctx.accounts.market.key(),
        side: position.side,
        resulting_size: remaining_size,
        resulting_exposure: remaining_notional,
        collateral_locked: remaining_collateral,
        diagnostic_pnl,
        collateral_reserved: reserve_collateral,
        price: price.price,
        publish_time: price.publish_time,
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
    pub diagnostic_pnl: i128,
    pub collateral_reserved: u64,
    pub price: u64,
    pub publish_time: i64,
}
