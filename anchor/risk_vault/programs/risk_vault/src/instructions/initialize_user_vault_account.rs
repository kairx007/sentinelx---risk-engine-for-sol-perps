use anchor_lang::prelude::*;

use crate::{
    constants::{USER_VAULT_SEED, VAULT_SEED},
    state::{UserVaultAccount, Vault},
};

#[derive(Accounts)]
pub struct InitializeUserVaultAccount<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED, vault.collateral_mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = owner,
        space = 8 + UserVaultAccount::INIT_SPACE,
        seeds = [USER_VAULT_SEED, vault.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub user_vault_account: Account<'info, UserVaultAccount>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_user_vault_account(
    ctx: Context<InitializeUserVaultAccount>,
) -> Result<()> {
    let user_vault_account = &mut ctx.accounts.user_vault_account;
    user_vault_account.owner = ctx.accounts.owner.key();
    user_vault_account.vault = ctx.accounts.vault.key();
    user_vault_account.shares = 0;
    user_vault_account.bump = ctx.bumps.user_vault_account;
    Ok(())
}
