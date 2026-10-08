pub const VAULT_SEED: &[u8] = b"vault";
pub const USER_VAULT_SEED: &[u8] = b"user_vault";
pub const RISK_STATE_SEED: &[u8] = b"risk_state";
pub const POSITION_SEED: &[u8] = b"position";
pub const MARKET_CONFIG_SEED: &[u8] = b"market_config";

// MVP units: quantity and price use 6 decimal places; quote collateral uses
// the existing 6-decimal test mint convention (one raw quote atom per 1e-6).
pub const PRICE_SCALE: u64 = 1_000_000;
pub const QUANTITY_SCALE: u64 = 1_000_000;
pub const MAX_ORACLE_AGE_SECONDS: i64 = 30;
pub const MAX_ORACLE_FUTURE_SKEW_SECONDS: i64 = 0;
pub const MIN_ORACLE_EXPONENT: i32 = -12;
pub const MAX_ORACLE_EXPONENT: i32 = 0;
pub const MAX_MARKET_AGE_SECONDS: i64 = 30;
pub const MAX_CONFIDENCE_BPS: u16 = 10_000;
pub const MAX_MAINTENANCE_MARGIN_BPS: u16 = 10_000;
pub const POSITION_SCHEMA_VERSION: u8 = 1;

pub const MAX_RISK_SCORE: u8 = 100;
pub const MAX_RISK_STATE_AGE_SECONDS: i64 = 300;
pub const MAX_FUTURE_SKEW_SECONDS: i64 = 30;

pub const LOW_MAX_LEVERAGE_X100: u16 = 300;
pub const MEDIUM_MAX_LEVERAGE_X100: u16 = 200;
pub const HIGH_MAX_LEVERAGE_X100: u16 = 100;
pub const CRITICAL_MAX_LEVERAGE_X100: u16 = 0;
pub const DEVELOPING_MAX_LEVERAGE_X100: u16 = 100;
pub const ACTIVE_MAX_LEVERAGE_X100: u16 = 0;
