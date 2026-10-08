use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};

use crate::{
    constants::{
        MARKET_CONFIG_SEED, MAX_CONFIDENCE_BPS, MAX_MAINTENANCE_MARGIN_BPS, MAX_MARKET_AGE_SECONDS,
        MAX_ORACLE_EXPONENT, MIN_ORACLE_EXPONENT, VAULT_SEED,
    },
    errors::VaultError,
    state::{MarketConfig, Vault},
};

#[derive(Accounts)]
#[instruction(market: Pubkey)]
pub struct InitializeMarketConfig<'info> {
    #[account(mut, address = vault.authority @ VaultError::UnauthorizedVaultAuthority)]
    pub authority: Signer<'info>,
    #[account(seeds = [VAULT_SEED, vault.collateral_mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(address = vault.collateral_mint)]
    pub collateral_mint: Account<'info, Mint>,
    /// CHECK: Opaque, non-default market identity; it is permanently bound by this PDA.
    pub market: UncheckedAccount<'info>,
    pub oracle_update_account: Account<'info, PriceUpdateV2>,
    #[account(
        init,
        payer = authority,
        space = 8 + MarketConfig::INIT_SPACE,
        seeds = [MARKET_CONFIG_SEED, vault.key().as_ref(), market.key().as_ref()],
        bump
    )]
    pub market_config: Account<'info, MarketConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateMarketConfig<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [VAULT_SEED, vault.collateral_mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [MARKET_CONFIG_SEED, vault.key().as_ref(), market_config.market.as_ref()],
        bump = market_config.bump,
        has_one = authority @ VaultError::UnauthorizedVaultAuthority,
        has_one = vault
    )]
    pub market_config: Account<'info, MarketConfig>,
    pub oracle_update_account: Account<'info, PriceUpdateV2>,
}

fn validate_parameters(margin_bps: u16, confidence_bps: u16, max_age_seconds: i64) -> Result<()> {
    require!(
        margin_bps > 0 && margin_bps <= MAX_MAINTENANCE_MARGIN_BPS,
        VaultError::InvalidMarginConfig
    );
    require!(
        confidence_bps <= MAX_CONFIDENCE_BPS,
        VaultError::InvalidMarketConfig
    );
    require!(
        max_age_seconds >= 0 && max_age_seconds <= MAX_MARKET_AGE_SECONDS,
        VaultError::InvalidMarketConfig
    );
    Ok(())
}

pub fn handle_initialize_market_config(
    ctx: Context<InitializeMarketConfig>,
    market: Pubkey,
    feed_id: [u8; 32],
    maintenance_margin_bps: u16,
    max_confidence_bps: u16,
    max_age_seconds: i64,
) -> Result<()> {
    require!(market != Pubkey::default(), VaultError::InvalidMarket);
    require_keys_eq!(market, ctx.accounts.market.key(), VaultError::InvalidMarket);
    require!(
        ctx.accounts.collateral_mint.decimals == 6,
        VaultError::InvalidMarketConfig
    );
    validate_parameters(maintenance_margin_bps, max_confidence_bps, max_age_seconds)?;
    let oracle = &ctx.accounts.oracle_update_account;
    require!(
        oracle.verification_level == VerificationLevel::Full,
        VaultError::InvalidOracleAccount
    );
    let price = oracle
        .get_price_unchecked(&feed_id)
        .map_err(|_| error!(VaultError::WrongOracleFeed))?;
    require!(price.price > 0, VaultError::InvalidOraclePrice);
    require!(
        price.exponent >= MIN_ORACLE_EXPONENT && price.exponent <= MAX_ORACLE_EXPONENT,
        VaultError::UnsupportedPriceExponent
    );

    let config = &mut ctx.accounts.market_config;
    config.authority = ctx.accounts.authority.key();
    config.vault = ctx.accounts.vault.key();
    config.market = market;
    config.oracle_update_account = ctx.accounts.oracle_update_account.key();
    config.feed_id = feed_id;
    config.maintenance_margin_bps = maintenance_margin_bps;
    config.max_confidence_bps = max_confidence_bps;
    config.max_age_seconds = max_age_seconds;
    config.version = 1;
    config.bump = ctx.bumps.market_config;
    emit!(MarketConfigInitialized {
        vault: config.vault,
        market,
        oracle_update_account: config.oracle_update_account,
        feed_id,
        maintenance_margin_bps,
        max_confidence_bps,
        max_age_seconds,
        version: config.version,
    });
    Ok(())
}

pub fn handle_update_market_config(
    ctx: Context<UpdateMarketConfig>,
    feed_id: [u8; 32],
    maintenance_margin_bps: u16,
    max_confidence_bps: u16,
    max_age_seconds: i64,
) -> Result<()> {
    validate_parameters(maintenance_margin_bps, max_confidence_bps, max_age_seconds)?;
    let oracle = &ctx.accounts.oracle_update_account;
    require!(
        oracle.verification_level == VerificationLevel::Full,
        VaultError::InvalidOracleAccount
    );
    let price = oracle
        .get_price_unchecked(&feed_id)
        .map_err(|_| error!(VaultError::WrongOracleFeed))?;
    require!(price.price > 0, VaultError::InvalidOraclePrice);
    require!(
        price.exponent >= MIN_ORACLE_EXPONENT && price.exponent <= MAX_ORACLE_EXPONENT,
        VaultError::UnsupportedPriceExponent
    );

    let config = &mut ctx.accounts.market_config;
    let old_version = config.version;
    config.oracle_update_account = ctx.accounts.oracle_update_account.key();
    config.feed_id = feed_id;
    config.maintenance_margin_bps = maintenance_margin_bps;
    config.max_confidence_bps = max_confidence_bps;
    config.max_age_seconds = max_age_seconds;
    config.version = old_version
        .checked_add(1)
        .ok_or(VaultError::ArithmeticOverflow)?;
    emit!(MarketConfigUpdated {
        vault: config.vault,
        market: config.market,
        oracle_update_account: config.oracle_update_account,
        feed_id,
        maintenance_margin_bps,
        max_confidence_bps,
        max_age_seconds,
        version: config.version,
    });
    Ok(())
}

#[event]
pub struct MarketConfigInitialized {
    pub vault: Pubkey,
    pub market: Pubkey,
    pub oracle_update_account: Pubkey,
    pub feed_id: [u8; 32],
    pub maintenance_margin_bps: u16,
    pub max_confidence_bps: u16,
    pub max_age_seconds: i64,
    pub version: u8,
}

#[event]
pub struct MarketConfigUpdated {
    pub vault: Pubkey,
    pub market: Pubkey,
    pub oracle_update_account: Pubkey,
    pub feed_id: [u8; 32],
    pub maintenance_margin_bps: u16,
    pub max_confidence_bps: u16,
    pub max_age_seconds: i64,
    pub version: u8,
}
