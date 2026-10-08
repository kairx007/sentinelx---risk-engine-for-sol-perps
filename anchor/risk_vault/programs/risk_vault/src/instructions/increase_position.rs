use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

use crate::{
    constants::{
        MARKET_CONFIG_SEED, POSITION_SCHEMA_VERSION, POSITION_SEED, RISK_STATE_SEED,
        USER_VAULT_SEED, VAULT_SEED,
    },
    errors::VaultError,
    math::{
        collateral_for_withdrawal, initial_margin, leverage_x100, notional_for_size,
        weighted_entry_price,
    },
    oracle::validate_pyth_price,
    policy::{validate_action_against_risk_state, ActionKind},
    state::{
        MarketConfig, Position, PositionSide, PositionStatus, RiskState, UserVaultAccount, Vault,
    },
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
        seeds = [MARKET_CONFIG_SEED, vault.key().as_ref(), market.key().as_ref()],
        bump = market_config.bump,
        has_one = vault,
        has_one = market
    )]
    pub market_config: Account<'info, MarketConfig>,
    #[account(address = market_config.oracle_update_account)]
    pub oracle_update_account: Account<'info, PriceUpdateV2>,
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

    let price = validate_pyth_price(
        &ctx.accounts.oracle_update_account,
        &ctx.accounts.market_config,
        ctx.accounts.oracle_update_account.key(),
        ctx.accounts.clock.unix_timestamp,
    )?;
    let computed_notional = notional_for_size(size_delta, price.price)?;
    require!(
        computed_notional == notional_delta,
        VaultError::InvalidPrice
    );

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
    let free_collateral = free_collateral
        .checked_sub(user.settlement_reserved)
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
            ctx.accounts.position.schema_version == POSITION_SCHEMA_VERSION,
            VaultError::InvalidPositionVersion
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
    let current_locked = if position_is_new {
        0
    } else {
        ctx.accounts.position.collateral_locked
    };
    let resulting_size = current_size
        .checked_add(size_delta)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let resulting_locked = current_locked
        .checked_add(collateral_delta)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let current_notional = notional_for_size(resulting_size, price.price)?;
    let resulting_leverage = leverage_x100(current_notional, resulting_locked)?;
    let required_margin = initial_margin(
        current_notional,
        crate::policy::effective_leverage_cap(&ctx.accounts.risk_state),
    )?;
    require!(
        resulting_locked >= required_margin,
        VaultError::InsufficientInitialMargin
    );

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
        position.entry_price = price.price;
        position.bad_debt = 0;
        position.schema_version = POSITION_SCHEMA_VERSION;
        position.status = PositionStatus::Open;
        position.bump = ctx.bumps.position;
    } else {
        position.entry_price = weighted_entry_price(
            side,
            position.size,
            position.entry_price,
            size_delta,
            price.price,
        )?;
        position.schema_version = POSITION_SCHEMA_VERSION;
    }
    position.size = resulting_size;
    position.notional = notional_for_size(resulting_size, position.entry_price)?;
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
        resulting_exposure: position.notional,
        collateral_locked: resulting_locked,
        entry_price: position.entry_price,
        current_price: price.price,
        publish_time: price.publish_time,
        risk_nonce: ctx.accounts.risk_state.nonce,
        config_version: ctx.accounts.market_config.version,
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
    pub entry_price: u64,
    pub current_price: u64,
    pub publish_time: i64,
    pub risk_nonce: u64,
    pub config_version: u8,
}
