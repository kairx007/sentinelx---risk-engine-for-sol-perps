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
    pub collateral_locked: u64,
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
