use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Share amount must be greater than zero")]
    ZeroShares,
    #[msg("Vault deposit and share totals are inconsistent")]
    InconsistentAccounting,
    #[msg("Vault token balance is below recorded deposits")]
    InsufficientVaultCollateral,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("Calculated value does not fit in the account type")]
    ConversionOverflow,
    #[msg("Deposit is too small to mint a share")]
    DepositTooSmall,
    #[msg("Withdrawal is too small to transfer collateral")]
    WithdrawalTooSmall,
    #[msg("Withdrawal exceeds the user's share balance")]
    InsufficientUserShares,
    #[msg("Signer is not the configured risk authority")]
    UnauthorizedRiskAuthority,
    #[msg("Signer is not the Vault authority")]
    UnauthorizedVaultAuthority,
    #[msg("Risk score must be between zero and one hundred")]
    InvalidRiskScore,
    #[msg("Risk level does not match the supplied score")]
    RiskLevelScoreMismatch,
    #[msg("Risk policy exceeds the on-chain leverage cap")]
    InvalidRiskPolicy,
    #[msg("Risk update nonce is not the exact next sequence")]
    InvalidNonce,
    #[msg("Risk update nonce has been exhausted")]
    NonceExhausted,
    #[msg("Risk update is older than the allowed age")]
    StaleRiskUpdate,
    #[msg("Risk update timestamp is too far in the future")]
    FutureRiskTimestamp,
    #[msg("Risk update timestamp is invalid")]
    InvalidRiskTimestamp,
    #[msg("Risk authority cannot be the default public key")]
    InvalidRiskAuthority,
    #[msg("Risk state has not been initialized")]
    RiskStateNotInitialized,
    #[msg("Risk state is stale and blocks new exposure")]
    RiskStateStale,
    #[msg("Action would increase exposure beyond the configured policy")]
    ExposureIncreaseBlocked,
    #[msg("Requested leverage exceeds the effective risk cap")]
    LeverageLimitExceeded,
    #[msg("Risk policy is in reduction-only mode")]
    ReductionOnlyMode,
    #[msg("Position market is invalid")]
    InvalidMarket,
    #[msg("Position is invalid")]
    InvalidPosition,
    #[msg("Position is not open")]
    PositionNotOpen,
    #[msg("Position is already closed")]
    PositionAlreadyClosed,
    #[msg("Position reduction is invalid")]
    InvalidReduction,
    #[msg("Insufficient free collateral")]
    InsufficientFreeCollateral,
    #[msg("Position collateral cannot be zero")]
    ZeroCollateral,
    #[msg("Position side does not match the existing position")]
    PositionSideMismatch,
    #[msg("Position price or notional is invalid")]
    InvalidPrice,
    #[msg("Collateral release is too small")]
    CollateralReleaseTooSmall,
}
