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
}
