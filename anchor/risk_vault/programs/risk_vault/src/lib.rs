pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("33fMx1DC1XXdSYXG8VUFqH5y1gDqxmEpbTTwESx21Rtq");

#[program]
pub mod risk_vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>, risk_authority: Pubkey) -> Result<()> {
        crate::instructions::initialize::handle_initialize_vault(ctx, risk_authority)
    }

    pub fn initialize_user_vault_account(ctx: Context<InitializeUserVaultAccount>) -> Result<()> {
        crate::instructions::initialize_user_vault_account::handle_initialize_user_vault_account(
            ctx,
        )
    }

    pub fn deposit(ctx: Context<DepositAccounts>, amount: u64) -> Result<()> {
        crate::instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<WithdrawAccounts>, shares: u64) -> Result<()> {
        crate::instructions::withdraw::handle_withdraw(ctx, shares)
    }

    pub fn update_risk_state(
        ctx: Context<UpdateRiskState>,
        risk_level: RiskLevel,
        risk_score: u8,
        contagion_state: ContagionState,
        max_leverage_x100: u16,
        observed_at: i64,
        nonce: u64,
    ) -> Result<()> {
        crate::instructions::update_risk_state::handle_update_risk_state(
            ctx,
            risk_level,
            risk_score,
            contagion_state,
            max_leverage_x100,
            observed_at,
            nonce,
        )
    }

    pub fn rotate_risk_authority(
        ctx: Context<RotateRiskAuthority>,
        new_risk_authority: Pubkey,
    ) -> Result<()> {
        crate::instructions::rotate_risk_authority::handle_rotate_risk_authority(
            ctx,
            new_risk_authority,
        )
    }
}
