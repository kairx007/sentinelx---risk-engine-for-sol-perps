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

pub fn leverage_x100(notional: u64, collateral: u64) -> Result<u16> {
    require!(notional > 0, VaultError::InvalidPrice);
    require!(collateral > 0, VaultError::ZeroCollateral);
    let leverage = (notional as u128)
        .checked_mul(100)
        .ok_or(VaultError::ArithmeticOverflow)?
        .checked_div(collateral as u128)
        .ok_or(VaultError::ZeroCollateral)?;
    u16::try_from(leverage).map_err(|_| error!(VaultError::ConversionOverflow))
}

pub fn notional_for_size(size: u64, price: u64) -> Result<u64> {
    require!(size > 0 && price > 0, VaultError::InvalidPrice);
    let value = (size as u128)
        .checked_mul(price as u128)
        .ok_or(VaultError::ArithmeticOverflow)?
        .checked_div(crate::constants::QUANTITY_SCALE as u128)
        .ok_or(VaultError::ArithmeticOverflow)?;
    u64::try_from(value).map_err(|_| error!(VaultError::ConversionOverflow))
}

/// PnL is in quote/collateral atoms. Profits round down; losses round away
/// from zero so truncation cannot understate the amount at risk.
pub fn unrealized_pnl(
    side: crate::state::PositionSide,
    size: u64,
    entry_price: u64,
    current_price: u64,
) -> Result<i128> {
    use crate::state::PositionSide::{Long, Short};
    require!(
        size > 0 && entry_price > 0 && current_price > 0,
        VaultError::InvalidPrice
    );
    let price_delta = match side {
        Long => (current_price as i128)
            .checked_sub(entry_price as i128)
            .ok_or(VaultError::ArithmeticOverflow)?,
        Short => (entry_price as i128)
            .checked_sub(current_price as i128)
            .ok_or(VaultError::ArithmeticOverflow)?,
    };
    let product = price_delta
        .checked_mul(size as i128)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let scale = crate::constants::QUANTITY_SCALE as i128;
    if product < 0 {
        let magnitude = product
            .checked_neg()
            .ok_or(VaultError::ArithmeticOverflow)?;
        let rounded = magnitude
            .checked_add(scale - 1)
            .ok_or(VaultError::ArithmeticOverflow)?
            .checked_div(scale)
            .ok_or(VaultError::ArithmeticOverflow)?;
        rounded
            .checked_neg()
            .ok_or(VaultError::ArithmeticOverflow.into())
    } else {
        product
            .checked_div(scale)
            .ok_or(VaultError::ArithmeticOverflow.into())
    }
}

pub fn weighted_entry_price(
    side: crate::state::PositionSide,
    old_size: u64,
    old_price: u64,
    added_size: u64,
    added_price: u64,
) -> Result<u64> {
    require!(added_size > 0 && added_price > 0, VaultError::InvalidPrice);
    if old_size == 0 {
        return Ok(added_price);
    }
    require!(old_price > 0, VaultError::InvalidPosition);
    let total_size = old_size
        .checked_add(added_size)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let weighted = (old_size as u128)
        .checked_mul(old_price as u128)
        .and_then(|v| v.checked_add((added_size as u128).checked_mul(added_price as u128)?))
        .ok_or(VaultError::ArithmeticOverflow)?;
    let divisor = total_size as u128;
    let quotient = weighted
        .checked_div(divisor)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let rounded = if side == crate::state::PositionSide::Long && weighted % divisor != 0 {
        quotient
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?
    } else {
        quotient
    };
    u64::try_from(rounded).map_err(|_| error!(VaultError::ConversionOverflow))
}

pub fn initial_margin(notional: u64, leverage_x100: u16) -> Result<u64> {
    require!(notional > 0, VaultError::InvalidPrice);
    require!(leverage_x100 > 0, VaultError::LeverageLimitExceeded);
    // `max_leverage_x100 = 300` means 3.00x, so divide by 300/100.
    let numerator = (notional as u128)
        .checked_mul(100)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let divisor = leverage_x100 as u128;
    let rounded = numerator
        .checked_add(divisor - 1)
        .ok_or(VaultError::ArithmeticOverflow)?
        .checked_div(divisor)
        .ok_or(VaultError::ArithmeticOverflow)?;
    u64::try_from(rounded).map_err(|_| error!(VaultError::ConversionOverflow))
}

pub fn maintenance_margin(notional: u64, margin_bps: u16) -> Result<u64> {
    let numerator = (notional as u128)
        .checked_mul(margin_bps as u128)
        .ok_or(VaultError::ArithmeticOverflow)?;
    let divisor = 10_000_u128;
    let rounded = numerator
        .checked_add(divisor - 1)
        .ok_or(VaultError::ArithmeticOverflow)?
        .checked_div(divisor)
        .ok_or(VaultError::ArithmeticOverflow)?;
    u64::try_from(rounded).map_err(|_| error!(VaultError::ConversionOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leverage_uses_fixed_point_rounding() {
        assert_eq!(leverage_x100(300, 100).unwrap(), 300);
        assert_eq!(leverage_x100(301, 100).unwrap(), 301);
    }

    #[test]
    fn leverage_rejects_zero_collateral_and_overflow() {
        assert!(leverage_x100(1, 0).is_err());
        assert!(leverage_x100(u64::MAX, 1).is_err());
    }

    #[test]
    fn pnl_is_signed_and_rounds_losses_away_from_zero() {
        use crate::state::PositionSide::{Long, Short};
        assert_eq!(
            unrealized_pnl(Long, 1_000_000, 2_000_000, 2_500_000).unwrap(),
            500_000
        );
        assert_eq!(
            unrealized_pnl(Long, 1_000_000, 2_500_000, 2_000_000).unwrap(),
            -500_000
        );
        assert_eq!(
            unrealized_pnl(Short, 1_000_000, 2_500_000, 2_000_000).unwrap(),
            500_000
        );
        assert_eq!(
            unrealized_pnl(Short, 1_000_000, 2_000_000, 2_500_000).unwrap(),
            -500_000
        );
        assert_eq!(unrealized_pnl(Long, 1, 2_000_001, 2_000_000).unwrap(), -1);
    }

    #[test]
    fn weighted_entry_and_margin_round_conservatively() {
        use crate::state::PositionSide::{Long, Short};
        assert_eq!(weighted_entry_price(Long, 1, 1, 1, 2).unwrap(), 2);
        assert_eq!(weighted_entry_price(Short, 1, 1, 1, 2).unwrap(), 1);
        assert_eq!(initial_margin(301, 300).unwrap(), 101);
        assert_eq!(maintenance_margin(1, 1).unwrap(), 1);
        assert_eq!(notional_for_size(100, 3_000_000).unwrap(), 300);
        assert!(initial_margin(1, 0).is_err());
        assert!(unrealized_pnl(Long, u64::MAX, 1, u64::MAX).is_err());
    }

    #[test]
    fn pnl_covers_both_directions_break_even_and_fractional_atoms() {
        use crate::state::PositionSide::{Long, Short};
        assert_eq!(
            unrealized_pnl(Long, 1_000_000, 2_000_000, 3_000_000).unwrap(),
            1_000_000
        );
        assert_eq!(
            unrealized_pnl(Long, 1_000_000, 3_000_000, 2_000_000).unwrap(),
            -1_000_000
        );
        assert_eq!(
            unrealized_pnl(Short, 1_000_000, 3_000_000, 2_000_000).unwrap(),
            1_000_000
        );
        assert_eq!(
            unrealized_pnl(Short, 1_000_000, 2_000_000, 3_000_000).unwrap(),
            -1_000_000
        );
        assert_eq!(unrealized_pnl(Long, 7, 42, 42).unwrap(), 0);
        assert_eq!(unrealized_pnl(Short, 7, 42, 42).unwrap(), 0);
        assert_eq!(unrealized_pnl(Long, 1, 2, 3).unwrap(), 0);
        assert_eq!(unrealized_pnl(Long, 1, 3, 2).unwrap(), -1);
        assert_eq!(unrealized_pnl(Short, 1, 3, 2).unwrap(), 0);
        assert_eq!(unrealized_pnl(Short, 1, 2, 3).unwrap(), -1);
    }

    #[test]
    fn weighted_entry_uses_quantity_and_rounds_conservatively_by_side() {
        use crate::state::PositionSide::{Long, Short};
        assert_eq!(weighted_entry_price(Long, 2, 100, 1, 200).unwrap(), 134);
        assert_eq!(weighted_entry_price(Short, 2, 100, 1, 200).unwrap(), 133);
        assert_eq!(weighted_entry_price(Long, 1, 100, 1, 100).unwrap(), 100);
        assert!(weighted_entry_price(Long, u64::MAX, 1, 1, 1).is_err());
        assert!(weighted_entry_price(Long, u64::MAX, u64::MAX, u64::MAX, u64::MAX).is_err());
    }

    #[test]
    fn notional_and_margin_reject_unrepresentable_results() {
        assert!(notional_for_size(u64::MAX, u64::MAX).is_err());
        assert!(initial_margin(u64::MAX, 1).is_err());
        assert_eq!(maintenance_margin(u64::MAX, 10_000).unwrap(), u64::MAX);
        assert_eq!(maintenance_margin(101, 100).unwrap(), 2);
    }
}
