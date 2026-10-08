use anchor_lang::{
    prelude::Pubkey,
    solana_program::{
        instruction::Instruction, program_option::COption, program_pack::Pack, system_program,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token::{
    spl_token::state::{Account as TokenAccount, Mint},
    ID as TOKEN_PROGRAM_ID,
};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let program_id = risk_vault::id();
    let authority = Keypair::new();
    let collateral_mint = Pubkey::new_unique();
    let mut svm = LiteSVM::new();
    let program = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/risk_vault.so"
    ));
    svm.add_program(program_id, program).unwrap();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();

    let mint = Mint {
        mint_authority: COption::Some(authority.pubkey()),
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut mint_data = vec![0; Mint::LEN];
    Mint::pack(mint, &mut mint_data).unwrap();
    svm.set_account(
        collateral_mint,
        Account {
            lamports: 1_000_000,
            data: mint_data,
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    (svm, authority, collateral_mint)
}

fn vault_pda(collateral_mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[risk_vault::constants::VAULT_SEED, collateral_mint.as_ref()],
        &risk_vault::id(),
    )
}

fn vault_ata(vault: &Pubkey, collateral_mint: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address(vault, collateral_mint)
}

fn initialize_instruction(
    authority: Pubkey,
    risk_authority: Pubkey,
    collateral_mint: Pubkey,
    vault: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::InitializeVault { risk_authority }.data(),
        risk_vault::accounts::InitializeVault {
            authority,
            collateral_mint,
            vault,
            vault_token_account: vault_ata(&vault, &collateral_mint),
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn send(svm: &mut LiteSVM, payer: &Keypair, instruction: Instruction) -> bool {
    let blockhash = svm.latest_blockhash();
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let transaction =
        VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[payer]).unwrap();
    svm.send_transaction(transaction).is_ok()
}

#[test]
fn initializes_vault_state() {
    let (mut svm, authority, collateral_mint) = setup();
    let risk_authority = Pubkey::new_unique();
    let (vault, expected_bump) = vault_pda(&collateral_mint);
    let instruction =
        initialize_instruction(authority.pubkey(), risk_authority, collateral_mint, vault);

    assert!(send(&mut svm, &authority, instruction));

    let vault_account = svm.get_account(&vault).unwrap();
    let mut data: &[u8] = &vault_account.data;
    let state = risk_vault::state::Vault::try_deserialize(&mut data).unwrap();
    assert_eq!(state.authority, authority.pubkey());
    assert_eq!(state.risk_authority, risk_authority);
    assert_eq!(state.collateral_mint, collateral_mint);
    assert_eq!(state.total_deposits, 0);
    assert_eq!(state.total_shares, 0);
    assert_eq!(state.bump, expected_bump);

    let vault_ata = svm
        .get_account(&vault_ata(&vault, &collateral_mint))
        .unwrap();
    assert_eq!(vault_ata.owner, TOKEN_PROGRAM_ID);
    let token_state = TokenAccount::unpack(&vault_ata.data).unwrap();
    assert_eq!(token_state.mint, collateral_mint);
    assert_eq!(token_state.owner, vault);
    assert_eq!(token_state.amount, 0);
}

#[test]
fn vault_pda_is_deterministic_for_a_collateral_mint() {
    let collateral_mint = Pubkey::new_unique();
    assert_eq!(vault_pda(&collateral_mint), vault_pda(&collateral_mint));
    assert_ne!(
        vault_pda(&collateral_mint).0,
        vault_pda(&Pubkey::new_unique()).0
    );
}

#[test]
fn rejects_a_non_mint_collateral_account() {
    let (mut svm, authority, collateral_mint) = setup();
    let (vault, _) = vault_pda(&collateral_mint);
    svm.set_account(
        collateral_mint,
        Account {
            lamports: 1_000_000,
            data: vec![0; Mint::LEN],
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let instruction = initialize_instruction(
        authority.pubkey(),
        Pubkey::new_unique(),
        collateral_mint,
        vault,
    );
    assert!(!send(&mut svm, &authority, instruction));
}

#[test]
fn rejects_an_incorrect_vault_pda() {
    let (mut svm, authority, collateral_mint) = setup();
    let instruction = initialize_instruction(
        authority.pubkey(),
        Pubkey::new_unique(),
        collateral_mint,
        Pubkey::new_unique(),
    );

    assert!(!send(&mut svm, &authority, instruction));
}

#[test]
fn rejects_initialization_without_authority_signature() {
    let (mut svm, _authority, collateral_mint) = setup();
    let fee_payer = Keypair::new();
    svm.airdrop(&fee_payer.pubkey(), 1_000_000_000).unwrap();
    let unsigned_authority = Pubkey::new_unique();
    let (vault, _) = vault_pda(&collateral_mint);
    let mut instruction = initialize_instruction(
        unsigned_authority,
        Pubkey::new_unique(),
        collateral_mint,
        vault,
    );
    instruction.accounts[0].is_signer = false;

    assert!(!send(&mut svm, &fee_payer, instruction));
}
