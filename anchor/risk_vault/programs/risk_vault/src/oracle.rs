use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::{PriceUpdateV2, VerificationLevel};

use crate::{
    constants::{
        MAX_ORACLE_AGE_SECONDS, MAX_ORACLE_EXPONENT, MAX_ORACLE_FUTURE_SKEW_SECONDS,
        MIN_ORACLE_EXPONENT, PRICE_SCALE,
    },
    errors::VaultError,
    state::MarketConfig,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ValidatedPrice {
    /// Quote atoms per whole base unit at `PRICE_SCALE` precision.
    pub price: u64,
    pub publish_time: i64,
}

pub fn validate_pyth_price(
    update: &PriceUpdateV2,
    config: &MarketConfig,
    account_key: Pubkey,
    now: i64,
) -> Result<ValidatedPrice> {
    require_keys_eq!(
        account_key,
        config.oracle_update_account,
        VaultError::InvalidOracleAccount
    );
    require!(
        update.verification_level == VerificationLevel::Full,
        VaultError::InvalidOracleAccount
    );
    let price = update
        .get_price_unchecked(&config.feed_id)
        .map_err(|_| error!(VaultError::WrongOracleFeed))?;
    require!(price.price > 0, VaultError::InvalidOraclePrice);
    require!(
        price.conf < price.price as u64,
        VaultError::InvalidOracleConfidence
    );
    require!(
        price.exponent >= MIN_ORACLE_EXPONENT && price.exponent <= MAX_ORACLE_EXPONENT,
        VaultError::UnsupportedPriceExponent
    );
    require!(
        config.max_confidence_bps <= 10_000
            && (price.conf as u128)
                .checked_mul(10_000)
                .ok_or(VaultError::ArithmeticOverflow)?
                <= (price.price as u128)
                    .checked_mul(config.max_confidence_bps as u128)
                    .ok_or(VaultError::ArithmeticOverflow)?,
        VaultError::InvalidOracleConfidence
    );
    require!(
        config.max_age_seconds <= MAX_ORACLE_AGE_SECONDS && config.max_age_seconds >= 0,
        VaultError::InvalidMarketConfig
    );
    let age = now
        .checked_sub(price.publish_time)
        .ok_or(VaultError::FutureOraclePrice)?;
    require!(
        age >= -MAX_ORACLE_FUTURE_SKEW_SECONDS,
        VaultError::FutureOraclePrice
    );
    require!(age <= config.max_age_seconds, VaultError::StaleOraclePrice);

    let scale_delta = price.exponent + 6;
    let normalized = if scale_delta >= 0 {
        (price.price as u128)
            .checked_mul(
                10_u128
                    .checked_pow(scale_delta as u32)
                    .ok_or(VaultError::ArithmeticOverflow)?,
            )
            .ok_or(VaultError::ArithmeticOverflow)?
    } else {
        (price.price as u128)
            .checked_div(
                10_u128
                    .checked_pow((-scale_delta) as u32)
                    .ok_or(VaultError::ArithmeticOverflow)?,
            )
            .ok_or(VaultError::InvalidOraclePrice)?
    };
    let normalized = u64::try_from(normalized).map_err(|_| error!(VaultError::PriceOutOfRange))?;
    require!(
        normalized > 0 && PRICE_SCALE > 0,
        VaultError::InvalidOraclePrice
    );

    Ok(ValidatedPrice {
        price: normalized,
        publish_time: price.publish_time,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use pyth_solana_receiver_sdk::price_update::{PriceFeedMessage, VerificationLevel};

    const FEED: [u8; 32] = [9; 32];
    const ACCOUNT: Pubkey = Pubkey::new_from_array([3; 32]);

    fn config() -> MarketConfig {
        MarketConfig {
            authority: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            market: Pubkey::new_unique(),
            oracle_update_account: ACCOUNT,
            feed_id: FEED,
            maintenance_margin_bps: 500,
            max_confidence_bps: 100,
            max_age_seconds: 30,
            version: 1,
            bump: 1,
        }
    }

    fn update(price: i64, conf: u64, exponent: i32, timestamp: i64) -> PriceUpdateV2 {
        PriceUpdateV2 {
            write_authority: Pubkey::new_unique(),
            verification_level: VerificationLevel::Full,
            price_message: PriceFeedMessage {
                feed_id: FEED,
                price,
                conf,
                exponent,
                publish_time: timestamp,
                prev_publish_time: timestamp.saturating_sub(1),
                ema_price: price,
                ema_conf: conf,
            },
            posted_slot: 1,
        }
    }

    #[test]
    fn normalizes_a_full_verification_pyth_price() {
        let result = validate_pyth_price(
            &update(300_000_000, 1_000, -8, 100),
            &config(),
            ACCOUNT,
            130,
        )
        .unwrap();
        assert_eq!(result.price, 3_000_000);
        assert_eq!(result.publish_time, 100);
    }

    #[test]
    fn rejects_wrong_feed_price_sign_confidence_and_exponent() {
        let mut wrong_feed = update(1, 0, -6, 100);
        wrong_feed.price_message.feed_id = [8; 32];
        assert!(validate_pyth_price(&wrong_feed, &config(), ACCOUNT, 100).is_err());
        assert!(validate_pyth_price(&update(0, 0, -6, 100), &config(), ACCOUNT, 100).is_err());
        assert!(validate_pyth_price(&update(-1, 0, -6, 100), &config(), ACCOUNT, 100).is_err());
        assert!(
            validate_pyth_price(&update(100_000, 2_000, -6, 100), &config(), ACCOUNT, 100).is_err()
        );
        assert!(validate_pyth_price(&update(1, 0, -13, 100), &config(), ACCOUNT, 100).is_err());
    }

    #[test]
    fn rejects_stale_future_unverified_and_wrong_account() {
        assert!(
            validate_pyth_price(&update(1_000_000, 0, -6, 99), &config(), ACCOUNT, 130).is_err()
        );
        assert!(
            validate_pyth_price(&update(1_000_000, 0, -6, 131), &config(), ACCOUNT, 130).is_err()
        );
        let mut partial = update(1_000_000, 0, -6, 130);
        partial.verification_level = VerificationLevel::Partial {
            num_signatures: 255,
        };
        assert!(validate_pyth_price(&partial, &config(), ACCOUNT, 130).is_err());
        assert!(validate_pyth_price(
            &update(1_000_000, 0, -6, 130),
            &config(),
            Pubkey::new_unique(),
            130
        )
        .is_err());
    }
}
