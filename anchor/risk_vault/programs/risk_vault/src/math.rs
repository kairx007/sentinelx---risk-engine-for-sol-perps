use anchor_lang::prelude::*;

use crate::errors::VaultError;

pub fn validate_accounting(
    total_deposits: u64,
    total_shares: u64,
    vault_token_balance: u64,
) -> Result<()> {
    require!(
        (total_deposits == 0) == (total_shares == 0),
        VaultError::InconsistentAccounting
    );
    require!(
        vault_token_balance >= total_deposits,
        VaultError::InsufficientVaultCollateral
    );
    Ok(())
}

pub fn shares_for_deposit(amount: u64, total_deposits: u64, total_shares: u64) -> Result<u64> {
    require!(amount > 0, VaultError::ZeroAmount);
    require!(
        (total_deposits == 0) == (total_shares == 0),
        VaultError::InconsistentAccounting
    );

    if total_shares == 0 {
        return Ok(amount);
    }

    let minted = (amount as u128)
        .checked_mul(total_shares as u128)
        .ok_or(VaultError::ArithmeticOverflow)?
        .checked_div(total_deposits as u128)
        .ok_or(VaultError::InconsistentAccounting)?;
    let minted = u64::try_from(minted).map_err(|_| error!(VaultError::ConversionOverflow))?;
    require!(minted > 0, VaultError::DepositTooSmall);
    Ok(minted)
}

pub fn collateral_for_withdrawal(
    shares: u64,
    total_deposits: u64,
    total_shares: u64,
) -> Result<u64> {
    require!(shares > 0, VaultError::ZeroShares);
    require!(
        total_deposits > 0 && total_shares > 0,
        VaultError::InconsistentAccounting
    );
    require!(shares <= total_shares, VaultError::InsufficientUserShares);

    if shares == total_shares {
        return Ok(total_deposits);
    }

    let amount = (shares as u128)
        .checked_mul(total_deposits as u128)
        .ok_or(VaultError::ArithmeticOverflow)?
        .checked_div(total_shares as u128)
        .ok_or(VaultError::InconsistentAccounting)?;
    let amount = u64::try_from(amount).map_err(|_| error!(VaultError::ConversionOverflow))?;
    require!(amount > 0, VaultError::WithdrawalTooSmall);
    Ok(amount)
}
