use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::{
    constants::{
        MARKET_CONFIG_SEED, POSITION_SCHEMA_VERSION, POSITION_SEED, USER_VAULT_SEED, VAULT_SEED,
    },
    errors::VaultError,
    math::{maintenance_margin, notional_for_size, unrealized_pnl},
    oracle::validate_pyth_price,
    state::{MarketConfig, Position, PositionStatus, UserVaultAccount, Vault},
};

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    pub liquidator: Signer<'info>,
    #[account(mut, seeds = [VAULT_SEED, vault.collateral_mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [USER_VAULT_SEED, vault.key().as_ref(), user_vault_account.owner.as_ref()],
        bump = user_vault_account.bump,
        has_one = vault
    )]
    pub user_vault_account: Account<'info, UserVaultAccount>,
    /// CHECK: Market identity is bound by MarketConfig and Position PDA.
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
        seeds = [POSITION_SEED, vault.key().as_ref(), user_vault_account.owner.as_ref(), market.key().as_ref()],
        bump = position.bump,
        has_one = owner @ VaultError::InvalidPosition,
        has_one = vault,
        has_one = market
    )]
    pub position: Account<'info, Position>,
    /// CHECK: Constrained to the identity stored in UserVaultAccount and Position.
    pub owner: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
}

pub fn handle_liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
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
        position.size > 0 && position.entry_price > 0,
        VaultError::InvalidPosition
    );
    let liquidated_size = position.size;

    let price = validate_pyth_price(
        &ctx.accounts.oracle_update_account,
        &ctx.accounts.market_config,
        ctx.accounts.oracle_update_account.key(),
        ctx.accounts.clock.unix_timestamp,
    )?;
    let current_notional = notional_for_size(position.size, price.price)?;
    let pnl = unrealized_pnl(
        position.side,
        position.size,
        position.entry_price,
        price.price,
    )?;
    let equity = (position.collateral_locked as i128)
        .checked_add(pnl)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let maintenance = maintenance_margin(
        current_notional,
        ctx.accounts.market_config.maintenance_margin_bps,
    )?;
    require!(equity <= maintenance as i128, VaultError::PositionHealthy);

    let new_bad_debt = if equity < 0 {
        u64::try_from(equity.checked_neg().ok_or(VaultError::ArithmeticOverflow)?)
            .map_err(|_| error!(VaultError::ConversionOverflow))?
    } else {
        0
    };
    let bad_debt = position
        .bad_debt
        .checked_add(new_bad_debt)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let reserved = position.collateral_locked;
    require!(
        reserved <= ctx.accounts.user_vault_account.locked_collateral,
        VaultError::InconsistentAccounting
    );
    let new_user_locked = ctx
        .accounts
        .user_vault_account
        .locked_collateral
        .checked_sub(reserved)
        .ok_or(VaultError::InconsistentAccounting)?;
    let new_reserved = ctx
        .accounts
        .user_vault_account
        .settlement_reserved
        .checked_add(reserved)
        .ok_or(VaultError::ArithmeticOverflow)?;

    // This is an accounting-only liquidation: all isolated collateral is
    // quarantined pending a future settlement mechanism. No PnL is paid,
    // charged to shares, or transferred to another depositor.
    let position = &mut ctx.accounts.position;
    let side = position.side;
    position.size = 0;
    position.notional = 0;
    position.collateral_locked = 0;
    position.bad_debt = bad_debt;
    position.status = PositionStatus::Closed;
    ctx.accounts.user_vault_account.locked_collateral = new_user_locked;
    ctx.accounts.user_vault_account.settlement_reserved = new_reserved;

    emit!(PositionLiquidated {
        vault: ctx.accounts.vault.key(),
        owner: ctx.accounts.owner.key(),
        market: ctx.accounts.market.key(),
        liquidator: ctx.accounts.liquidator.key(),
        side,
        size: liquidated_size,
        price: price.price,
        publish_time: price.publish_time,
        unrealized_pnl: pnl,
        equity,
        maintenance_margin: maintenance,
        bad_debt,
        collateral_reserved: reserved,
        config_version: ctx.accounts.market_config.version,
    });
    Ok(())
}

#[event]
pub struct PositionLiquidated {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub liquidator: Pubkey,
    pub side: crate::state::PositionSide,
    pub size: u64,
    pub price: u64,
    pub publish_time: i64,
    pub unrealized_pnl: i128,
    pub equity: i128,
    pub maintenance_margin: u64,
    pub bad_debt: u64,
    pub collateral_reserved: u64,
    pub config_version: u8,
}
