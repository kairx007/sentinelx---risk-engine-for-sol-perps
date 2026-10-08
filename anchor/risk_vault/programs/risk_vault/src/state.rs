use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub authority: Pubkey,
    pub risk_authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub total_deposits: u64,
    pub total_shares: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserVaultAccount {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub shares: u64,
    pub locked_collateral: u64,
    /// Collateral quarantined by valuation-only liquidation. No PnL is settled.
    pub settlement_reserved: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MarketConfig {
    pub authority: Pubkey,
    pub vault: Pubkey,
    pub market: Pubkey,
    pub oracle_update_account: Pubkey,
    pub feed_id: [u8; 32],
    pub maintenance_margin_bps: u16,
    pub max_confidence_bps: u16,
    pub max_age_seconds: i64,
    pub version: u8,
    pub bump: u8,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PositionSide {
    Long,
    Short,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PositionStatus {
    Open,
    Closed,
}

#[account]
#[derive(Debug, InitSpace, PartialEq, Eq)]
pub struct Position {
    pub owner: Pubkey,
    pub vault: Pubkey,
    pub market: Pubkey,
    pub side: PositionSide,
    pub size: u64,
    pub notional: u64,
    /// Weighted average entry price, quote atoms per whole base unit at PRICE_SCALE.
    pub entry_price: u64,
    pub collateral_locked: u64,
    /// Diagnostic only. Never charged to other users or vault shares.
    pub bad_debt: u64,
    pub schema_version: u8,
    pub opened_at: i64,
    pub status: PositionStatus,
    pub bump: u8,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ContagionState {
    None,
    Isolated,
    Developing,
    Active,
}

#[account]
#[derive(InitSpace)]
pub struct RiskState {
    pub risk_level: RiskLevel,
    pub risk_score: u8,
    pub contagion_state: ContagionState,
    pub max_leverage_x100: u16,
    pub observed_at: i64,
    pub updated_at: i64,
    pub nonce: u64,
    pub bump: u8,
}
