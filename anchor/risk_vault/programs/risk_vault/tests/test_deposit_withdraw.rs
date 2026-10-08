use anchor_lang::{
    prelude::Pubkey,
    solana_program::{
        instruction::Instruction, program_option::COption, program_pack::Pack, system_program,
    },
    AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token::{
    spl_token::state::{Account as TokenAccount, AccountState, Mint},
    ID as TOKEN_PROGRAM_ID,
};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

struct Fixture {
    svm: LiteSVM,
    risk_authority: Keypair,
    collateral_mint: Pubkey,
    vault: Pubkey,
    vault_token_account: Pubkey,
}

struct User {
    keypair: Keypair,
    token_account: Pubkey,
    user_vault_account: Pubkey,
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

fn user_vault_pda(vault: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            risk_vault::constants::USER_VAULT_SEED,
            vault.as_ref(),
            owner.as_ref(),
        ],
        &risk_vault::id(),
    )
}

fn pack_mint(authority: Pubkey, supply: u64) -> Vec<u8> {
    let mint = Mint {
        mint_authority: COption::Some(authority),
        supply,
        decimals: 6,
        is_initialized: true,
        freeze_authority: COption::None,
    };
    let mut data = vec![0; Mint::LEN];
    Mint::pack(mint, &mut data).unwrap();
    data
}

fn pack_token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> Vec<u8> {
    let token_account = TokenAccount {
        mint,
        owner,
        amount,
        delegate: COption::None,
        state: AccountState::Initialized,
        is_native: COption::None,
        delegated_amount: 0,
        close_authority: COption::None,
    };
    let mut data = vec![0; TokenAccount::LEN];
    TokenAccount::pack(token_account, &mut data).unwrap();
    data
}

fn set_token_account(svm: &mut LiteSVM, address: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000,
            data: pack_token_account(mint, owner, amount),
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn send(svm: &mut LiteSVM, payer: &Keypair, instruction: Instruction) -> bool {
    let message = Message::new_with_blockhash(
        &[instruction],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let transaction =
        match VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[payer]) {
            Ok(transaction) => transaction,
            Err(_) => return false,
        };
    svm.send_transaction(transaction).is_ok()
}

fn initialize_vault_instruction(
    initializer: Pubkey,
    risk_authority: Pubkey,
    collateral_mint: Pubkey,
    vault: Pubkey,
    vault_token_account: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::InitializeVault { risk_authority }.data(),
        risk_vault::accounts::InitializeVault {
            authority: initializer,
            collateral_mint,
            vault,
            vault_token_account,
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn initialize_user_instruction(
    owner: Pubkey,
    vault: Pubkey,
    user_vault_account: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::InitializeUserVaultAccount {}.data(),
        risk_vault::accounts::InitializeUserVaultAccount {
            owner,
            vault,
            user_vault_account,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn deposit_instruction(owner: Pubkey, user: &User, fixture: &Fixture, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::Deposit { amount }.data(),
        risk_vault::accounts::DepositAccounts {
            owner,
            vault: fixture.vault,
            collateral_mint: fixture.collateral_mint,
            user_vault_account: user.user_vault_account,
            user_token_account: user.token_account,
            vault_token_account: fixture.vault_token_account,
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    )
}

fn withdraw_instruction(
    owner: Pubkey,
    user_vault_account: Pubkey,
    user_token_account: Pubkey,
    fixture: &Fixture,
    shares: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::Withdraw { shares }.data(),
        risk_vault::accounts::WithdrawAccounts {
            owner,
            vault: fixture.vault,
            collateral_mint: fixture.collateral_mint,
            user_vault_account,
            vault_token_account: fixture.vault_token_account,
            user_token_account,
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
    )
}

fn send_deposit(fixture: &mut Fixture, user: &User, amount: u64) -> bool {
    let instruction = deposit_instruction(user.keypair.pubkey(), user, fixture, amount);
    send(&mut fixture.svm, &user.keypair, instruction)
}

fn send_withdraw(
    fixture: &mut Fixture,
    signer: &Keypair,
    owner: Pubkey,
    user_vault_account: Pubkey,
    user_token_account: Pubkey,
    shares: u64,
) -> bool {
    let instruction = withdraw_instruction(
        owner,
        user_vault_account,
        user_token_account,
        fixture,
        shares,
    );
    send(&mut fixture.svm, signer, instruction)
}

fn setup() -> Fixture {
    let mut svm = LiteSVM::new();
    let initializer = Keypair::new();
    let risk_authority = Keypair::new();
    let collateral_mint = Pubkey::new_unique();
    let (vault, _) = vault_pda(&collateral_mint);
    let vault_token_account = vault_ata(&vault, &collateral_mint);

    svm.add_program(
        risk_vault::id(),
        include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/risk_vault.so"
        )),
    )
    .unwrap();
    svm.airdrop(&initializer.pubkey(), 2_000_000_000).unwrap();
    svm.set_account(
        collateral_mint,
        Account {
            lamports: 1_000_000,
            data: pack_mint(initializer.pubkey(), u64::MAX),
            owner: TOKEN_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let initialize = initialize_vault_instruction(
        initializer.pubkey(),
        risk_authority.pubkey(),
        collateral_mint,
        vault,
        vault_token_account,
    );
    assert!(send(&mut svm, &initializer, initialize));

    Fixture {
        svm,
        risk_authority,
        collateral_mint,
        vault,
        vault_token_account,
    }
}

fn create_user(fixture: &mut Fixture, initial_tokens: u64) -> User {
    let keypair = Keypair::new();
    let token_account = Pubkey::new_unique();
    let (user_vault_account, _) = user_vault_pda(&fixture.vault, &keypair.pubkey());
    fixture
        .svm
        .airdrop(&keypair.pubkey(), 1_000_000_000)
        .unwrap();
    set_token_account(
        &mut fixture.svm,
        token_account,
        fixture.collateral_mint,
        keypair.pubkey(),
        initial_tokens,
    );
    let initialize =
        initialize_user_instruction(keypair.pubkey(), fixture.vault, user_vault_account);
    assert!(send(&mut fixture.svm, &keypair, initialize));
    User {
        keypair,
        token_account,
        user_vault_account,
    }
}

fn vault_state(fixture: &Fixture) -> risk_vault::state::Vault {
    let account = fixture.svm.get_account(&fixture.vault).unwrap();
    let mut data: &[u8] = &account.data;
    risk_vault::state::Vault::try_deserialize(&mut data).unwrap()
}

fn user_state(fixture: &Fixture, user: &User) -> risk_vault::state::UserVaultAccount {
    let account = fixture.svm.get_account(&user.user_vault_account).unwrap();
    let mut data: &[u8] = &account.data;
    risk_vault::state::UserVaultAccount::try_deserialize(&mut data).unwrap()
}

fn token_balance(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let account = svm.get_account(address).unwrap();
    TokenAccount::unpack(&account.data).unwrap().amount
}

fn set_accounting(fixture: &mut Fixture, total_deposits: u64, total_shares: u64, balance: u64) {
    let mut account = fixture.svm.get_account(&fixture.vault).unwrap();
    let mut data: &[u8] = &account.data;
    let mut state = risk_vault::state::Vault::try_deserialize(&mut data).unwrap();
    state.total_deposits = total_deposits;
    state.total_shares = total_shares;
    let mut serialized = Vec::new();
    state.try_serialize(&mut serialized).unwrap();
    account.data = serialized;
    fixture.svm.set_account(fixture.vault, account).unwrap();
    set_token_account(
        &mut fixture.svm,
        fixture.vault_token_account,
        fixture.collateral_mint,
        fixture.vault,
        balance,
    );
}

#[test]
fn first_deposit_mints_equal_shares_and_moves_collateral() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);
    assert!(send_deposit(&mut fixture, &user, 250));

    let vault = vault_state(&fixture);
    let user_state = user_state(&fixture, &user);
    assert_eq!(vault.total_deposits, 250);
    assert_eq!(vault.total_shares, 250);
    assert_eq!(user_state.shares, 250);
    assert_eq!(token_balance(&fixture.svm, &user.token_account), 750);
    assert_eq!(
        token_balance(&fixture.svm, &fixture.vault_token_account),
        250
    );
}

#[test]
fn second_deposit_uses_proportional_share_price() {
    let mut fixture = setup();
    let first = create_user(&mut fixture, 1_000);
    let second = create_user(&mut fixture, 1_000);

    assert!(send_deposit(&mut fixture, &first, 100));
    assert!(send_deposit(&mut fixture, &second, 100));

    assert_eq!(vault_state(&fixture).total_deposits, 200);
    assert_eq!(vault_state(&fixture).total_shares, 200);
    assert_eq!(user_state(&fixture, &first).shares, 100);
    assert_eq!(user_state(&fixture, &second).shares, 100);
}

#[test]
fn user_vault_account_stores_owner_vault_shares_and_deterministic_bump() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 100);
    let (expected_address, expected_bump) = user_vault_pda(&fixture.vault, &user.keypair.pubkey());
    let state = user_state(&fixture, &user);

    assert_eq!(user.user_vault_account, expected_address);
    assert_eq!(state.owner, user.keypair.pubkey());
    assert_eq!(state.vault, fixture.vault);
    assert_eq!(state.shares, 0);
    assert_eq!(state.bump, expected_bump);
    assert_ne!(
        user_vault_pda(&fixture.vault, &Keypair::new().pubkey()).0,
        expected_address
    );
}

#[test]
fn multiple_users_preserve_total_share_invariant() {
    let mut fixture = setup();
    let users = [
        create_user(&mut fixture, 1_000),
        create_user(&mut fixture, 1_000),
        create_user(&mut fixture, 1_000),
    ];

    for (user, amount) in users.iter().zip([100, 200, 300]) {
        assert!(send_deposit(&mut fixture, user, amount));
    }

    let shares: u64 = users
        .iter()
        .map(|user| user_state(&fixture, user).shares)
        .sum();
    let vault = vault_state(&fixture);
    assert_eq!(shares, vault.total_shares);
    assert_eq!(vault.total_deposits, 600);
    assert_eq!(
        token_balance(&fixture.svm, &fixture.vault_token_account),
        600
    );
}

#[test]
fn partial_withdrawal_burns_shares_proportionally() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);
    assert!(send_deposit(&mut fixture, &user, 400));
    assert!(send_withdraw(
        &mut fixture,
        &user.keypair,
        user.keypair.pubkey(),
        user.user_vault_account,
        user.token_account,
        150,
    ));

    assert_eq!(vault_state(&fixture).total_deposits, 250);
    assert_eq!(vault_state(&fixture).total_shares, 250);
    assert_eq!(user_state(&fixture, &user).shares, 250);
    assert_eq!(token_balance(&fixture.svm, &user.token_account), 750);
    assert_eq!(
        token_balance(&fixture.svm, &fixture.vault_token_account),
        250
    );
}

#[test]
fn multiple_users_withdraw_independently() {
    let mut fixture = setup();
    let first = create_user(&mut fixture, 1_000);
    let second = create_user(&mut fixture, 1_000);
    assert!(send_deposit(&mut fixture, &first, 100));
    assert!(send_deposit(&mut fixture, &second, 100));

    assert!(send_withdraw(
        &mut fixture,
        &first.keypair,
        first.keypair.pubkey(),
        first.user_vault_account,
        first.token_account,
        50,
    ));
    assert!(send_withdraw(
        &mut fixture,
        &second.keypair,
        second.keypair.pubkey(),
        second.user_vault_account,
        second.token_account,
        100,
    ));

    assert_eq!(user_state(&fixture, &first).shares, 50);
    assert_eq!(user_state(&fixture, &second).shares, 0);
    assert_eq!(vault_state(&fixture).total_shares, 50);
    assert_eq!(vault_state(&fixture).total_deposits, 50);
    assert_eq!(token_balance(&fixture.svm, &first.token_account), 950);
    assert_eq!(token_balance(&fixture.svm, &second.token_account), 1_000);
    assert_eq!(
        token_balance(&fixture.svm, &fixture.vault_token_account),
        50
    );
}

#[test]
fn full_withdrawal_resets_totals_and_keeps_user_account_reusable() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);
    assert!(send_deposit(&mut fixture, &user, 400));
    assert!(send_withdraw(
        &mut fixture,
        &user.keypair,
        user.keypair.pubkey(),
        user.user_vault_account,
        user.token_account,
        400,
    ));

    let vault = vault_state(&fixture);
    assert_eq!(vault.total_deposits, 0);
    assert_eq!(vault.total_shares, 0);
    assert_eq!(user_state(&fixture, &user).shares, 0);
    assert!(fixture.svm.get_account(&user.user_vault_account).is_some());
    assert_eq!(token_balance(&fixture.svm, &user.token_account), 1_000);
    assert_eq!(token_balance(&fixture.svm, &fixture.vault_token_account), 0);

    assert!(send_deposit(&mut fixture, &user, 100));
    assert_eq!(user_state(&fixture, &user).shares, 100);
}

#[test]
fn risk_authority_cannot_withdraw_a_users_shares() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);
    assert!(send_deposit(&mut fixture, &user, 100));
    let risk_token_account = Pubkey::new_unique();
    set_token_account(
        &mut fixture.svm,
        risk_token_account,
        fixture.collateral_mint,
        fixture.risk_authority.pubkey(),
        0,
    );

    let withdraw = withdraw_instruction(
        fixture.risk_authority.pubkey(),
        user.user_vault_account,
        risk_token_account,
        &fixture,
        100,
    );
    assert!(!send(&mut fixture.svm, &fixture.risk_authority, withdraw));
    assert_eq!(vault_state(&fixture).total_shares, 100);
    assert_eq!(user_state(&fixture, &user).shares, 100);
}

#[test]
fn rejects_zero_deposit_and_zero_withdrawal() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);
    assert!(!send_deposit(&mut fixture, &user, 0));
    let withdraw = withdraw_instruction(
        user.keypair.pubkey(),
        user.user_vault_account,
        user.token_account,
        &fixture,
        0,
    );
    assert!(!send(&mut fixture.svm, &user.keypair, withdraw));
}

#[test]
fn rejects_withdrawal_exceeding_users_shares() {
    let mut fixture = setup();
    let first = create_user(&mut fixture, 1_000);
    let second = create_user(&mut fixture, 1_000);
    assert!(send_deposit(&mut fixture, &first, 100));
    assert!(send_deposit(&mut fixture, &second, 100));

    let withdraw = withdraw_instruction(
        first.keypair.pubkey(),
        first.user_vault_account,
        first.token_account,
        &fixture,
        101,
    );
    assert!(!send(&mut fixture.svm, &first.keypair, withdraw));
    assert_eq!(vault_state(&fixture).total_deposits, 200);
}

#[test]
fn rejects_a_second_user_account_for_the_same_owner_and_vault() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 100);
    let initialize = initialize_user_instruction(
        user.keypair.pubkey(),
        fixture.vault,
        user.user_vault_account,
    );
    assert!(!send(&mut fixture.svm, &user.keypair, initialize));
}

#[test]
fn rejects_user_token_accounts_with_wrong_mint_or_owner() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);
    let wrong_mint_account = Pubkey::new_unique();
    set_token_account(
        &mut fixture.svm,
        wrong_mint_account,
        Pubkey::new_unique(),
        user.keypair.pubkey(),
        100,
    );
    let mut instruction = deposit_instruction(user.keypair.pubkey(), &user, &fixture, 10);
    instruction.accounts[4].pubkey = wrong_mint_account;
    assert!(!send(&mut fixture.svm, &user.keypair, instruction));

    let wrong_owner_account = Pubkey::new_unique();
    set_token_account(
        &mut fixture.svm,
        wrong_owner_account,
        fixture.collateral_mint,
        Pubkey::new_unique(),
        100,
    );
    let mut instruction = deposit_instruction(user.keypair.pubkey(), &user, &fixture, 10);
    instruction.accounts[4].pubkey = wrong_owner_account;
    assert!(!send(&mut fixture.svm, &user.keypair, instruction));
}

#[test]
fn rejects_wrong_vault_ata_and_wrong_user_vault_pda() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);

    let mut wrong_ata = deposit_instruction(user.keypair.pubkey(), &user, &fixture, 10);
    wrong_ata.accounts[5].pubkey = user.token_account;
    assert!(!send(&mut fixture.svm, &user.keypair, wrong_ata));

    let mut wrong_user_vault = deposit_instruction(user.keypair.pubkey(), &user, &fixture, 10);
    wrong_user_vault.accounts[3].pubkey = Pubkey::new_unique();
    assert!(!send(&mut fixture.svm, &user.keypair, wrong_user_vault));
}

#[test]
fn rejects_wrong_collateral_mint_and_vault_accounts() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);
    let wrong_mint = Pubkey::new_unique();
    fixture
        .svm
        .set_account(
            wrong_mint,
            Account {
                lamports: 1_000_000,
                data: pack_mint(fixture.risk_authority.pubkey(), 0),
                owner: TOKEN_PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let mut wrong_mint_instruction =
        deposit_instruction(user.keypair.pubkey(), &user, &fixture, 10);
    wrong_mint_instruction.accounts[2].pubkey = wrong_mint;
    assert!(!send(
        &mut fixture.svm,
        &user.keypair,
        wrong_mint_instruction
    ));

    let mut wrong_vault_instruction =
        deposit_instruction(user.keypair.pubkey(), &user, &fixture, 10);
    wrong_vault_instruction.accounts[1].pubkey = Pubkey::new_unique();
    assert!(!send(
        &mut fixture.svm,
        &user.keypair,
        wrong_vault_instruction
    ));
}

#[test]
fn rejects_deposits_that_round_to_zero_shares() {
    assert!(risk_vault::math::shares_for_deposit(1, 2, 1).is_err());
}

#[test]
fn rejects_partial_withdrawals_that_round_to_zero_collateral() {
    assert!(risk_vault::math::collateral_for_withdrawal(1, 1, 2).is_err());
}

#[test]
fn checked_math_handles_large_values_and_rejects_conversion_overflow() {
    assert!(risk_vault::math::shares_for_deposit(u64::MAX, 1, u64::MAX).is_err());
    assert_eq!(
        risk_vault::math::collateral_for_withdrawal(u64::MAX, u64::MAX, u64::MAX).unwrap(),
        u64::MAX
    );
    assert!(risk_vault::math::validate_accounting(0, 1, 1).is_err());
    assert!(risk_vault::math::validate_accounting(1, 0, 1).is_err());
    assert!(risk_vault::math::validate_accounting(2, 2, 1).is_err());
}

#[test]
fn deposit_counter_overflow_fails_without_moving_tokens() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 10);
    set_accounting(&mut fixture, u64::MAX - 1, u64::MAX - 1, u64::MAX - 1);

    assert!(!send_deposit(&mut fixture, &user, 2));
    assert_eq!(vault_state(&fixture).total_deposits, u64::MAX - 1);
    assert_eq!(vault_state(&fixture).total_shares, u64::MAX - 1);
    assert_eq!(token_balance(&fixture.svm, &user.token_account), 10);
    assert_eq!(
        token_balance(&fixture.svm, &fixture.vault_token_account),
        u64::MAX - 1
    );
}

#[test]
fn unsolicited_collateral_is_surplus_and_not_counted_as_user_deposits() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);
    set_token_account(
        &mut fixture.svm,
        fixture.vault_token_account,
        fixture.collateral_mint,
        fixture.vault,
        25,
    );

    assert!(send_deposit(&mut fixture, &user, 100));
    assert_eq!(vault_state(&fixture).total_deposits, 100);
    assert_eq!(vault_state(&fixture).total_shares, 100);
    assert_eq!(
        token_balance(&fixture.svm, &fixture.vault_token_account),
        125
    );
}
