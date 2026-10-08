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

pub fn handle_close_position(ctx: Context<ClosePosition>) -> Result<()> {
    require!(
        ctx.accounts.position.status == PositionStatus::Open,
        VaultError::PositionAlreadyClosed
    );
    require!(
        ctx.accounts.position.schema_version == POSITION_SCHEMA_VERSION,
        VaultError::InvalidPositionVersion
    );
    let price = validate_pyth_price(
        &ctx.accounts.oracle_update_account,
        &ctx.accounts.market_config,
        ctx.accounts.oracle_update_account.key(),
        ctx.accounts.clock.unix_timestamp,
    )?;
    let diagnostic_pnl = unrealized_pnl(
        ctx.accounts.position.side,
        ctx.accounts.position.size,
        ctx.accounts.position.entry_price,
        price.price,
    )?;
    let released_collateral = ctx.accounts.position.collateral_locked;
    let reserve_collateral = if diagnostic_pnl < 0 {
        released_collateral
    } else {
        0
    };
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
    ctx.accounts.user_vault_account.settlement_reserved = ctx
        .accounts
        .user_vault_account
        .settlement_reserved
        .checked_add(reserve_collateral)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let new_bad_debt = if diagnostic_pnl
        .checked_add(released_collateral as i128)
        .ok_or(VaultError::ArithmeticOverflow)?
        < 0
    {
        u64::try_from(
            diagnostic_pnl
                .checked_add(released_collateral as i128)
                .ok_or(VaultError::ArithmeticOverflow)?
                .checked_neg()
                .ok_or(VaultError::ArithmeticOverflow)?,
        )
        .map_err(|_| error!(VaultError::ConversionOverflow))?
    } else {
        0
    };
    ctx.accounts.position.bad_debt = ctx
        .accounts
        .position
        .bad_debt
        .checked_add(new_bad_debt)
        .ok_or(VaultError::ArithmeticOverflow)?;

    emit!(PositionClosed {
        vault: ctx.accounts.vault.key(),
        owner: ctx.accounts.owner.key(),
        market: ctx.accounts.market.key(),
        side,
        collateral_released: released_collateral
            .checked_sub(reserve_collateral)
            .ok_or(VaultError::InconsistentAccounting)?,
        collateral_reserved: reserve_collateral,
        diagnostic_pnl,
        price: price.price,
        publish_time: price.publish_time,
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
    pub collateral_reserved: u64,
    pub diagnostic_pnl: i128,
    pub price: u64,
    pub publish_time: i64,
}
