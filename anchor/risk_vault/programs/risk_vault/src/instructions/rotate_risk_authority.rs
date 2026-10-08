use anchor_lang::prelude::*;

use crate::{constants::VAULT_SEED, errors::VaultError, state::Vault};

#[derive(Accounts)]
pub struct RotateRiskAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.collateral_mint.as_ref()],
        bump = vault.bump,
        has_one = authority @ VaultError::UnauthorizedVaultAuthority
    )]
    pub vault: Account<'info, Vault>,
}

pub fn handle_rotate_risk_authority(
    ctx: Context<RotateRiskAuthority>,
    new_risk_authority: Pubkey,
) -> Result<()> {
    require!(
        new_risk_authority != Pubkey::default(),
        VaultError::InvalidRiskAuthority
    );

    let old_risk_authority = ctx.accounts.vault.risk_authority;
    ctx.accounts.vault.risk_authority = new_risk_authority;

    emit!(RiskAuthorityRotated {
        vault: ctx.accounts.vault.key(),
        old_risk_authority,
        new_risk_authority,
    });
    Ok(())
}

#[event]
pub struct RiskAuthorityRotated {
    pub vault: Pubkey,
    pub old_risk_authority: Pubkey,
    pub new_risk_authority: Pubkey,
}
