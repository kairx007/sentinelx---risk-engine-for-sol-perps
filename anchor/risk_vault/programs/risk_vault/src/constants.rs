pub const VAULT_SEED: &[u8] = b"vault";
pub const USER_VAULT_SEED: &[u8] = b"user_vault";
pub const RISK_STATE_SEED: &[u8] = b"risk_state";

pub const MAX_RISK_SCORE: u8 = 100;
pub const MAX_RISK_STATE_AGE_SECONDS: i64 = 300;
pub const MAX_FUTURE_SKEW_SECONDS: i64 = 30;

pub const LOW_MAX_LEVERAGE_X100: u16 = 300;
pub const MEDIUM_MAX_LEVERAGE_X100: u16 = 200;
pub const HIGH_MAX_LEVERAGE_X100: u16 = 100;
pub const CRITICAL_MAX_LEVERAGE_X100: u16 = 0;
pub const DEVELOPING_MAX_LEVERAGE_X100: u16 = 100;
pub const ACTIVE_MAX_LEVERAGE_X100: u16 = 0;
