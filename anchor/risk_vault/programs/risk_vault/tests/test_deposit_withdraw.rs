use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{
        instruction::Instruction, program_option::COption, program_pack::Pack, system_program,
        sysvar::SysvarId,
    },
    AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token::{
    spl_token::state::{Account as TokenAccount, AccountState, Mint},
    ID as TOKEN_PROGRAM_ID,
};
use litesvm::LiteSVM;
use pyth_solana_receiver_sdk::price_update::{PriceFeedMessage, PriceUpdateV2, VerificationLevel};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

struct Fixture {
    svm: LiteSVM,
    vault_authority: Keypair,
    risk_authority: Keypair,
    collateral_mint: Pubkey,
    vault: Pubkey,
    vault_token_account: Pubkey,
    oracle_update_account: Pubkey,
    feed_id: [u8; 32],
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

fn risk_state_pda(vault: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[risk_vault::constants::RISK_STATE_SEED, vault.as_ref()],
        &risk_vault::id(),
    )
    .0
}

fn market_config_pda(vault: &Pubkey, market: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            risk_vault::constants::MARKET_CONFIG_SEED,
            vault.as_ref(),
            market.as_ref(),
        ],
        &risk_vault::id(),
    )
    .0
}

fn set_pyth_price(
    fixture: &mut Fixture,
    price: i64,
    conf: u64,
    exponent: i32,
    publish_time: i64,
    feed_id: [u8; 32],
) {
    let update = PriceUpdateV2 {
        write_authority: Pubkey::new_unique(),
        verification_level: VerificationLevel::Full,
        price_message: PriceFeedMessage {
            feed_id,
            price,
            conf,
            exponent,
            publish_time,
            prev_publish_time: publish_time.saturating_sub(1),
            ema_price: price,
            ema_conf: conf,
        },
        posted_slot: 1,
    };
    let mut data = Vec::new();
    update.try_serialize(&mut data).unwrap();
    fixture
        .svm
        .set_account(
            fixture.oracle_update_account,
            Account {
                lamports: 1_000_000,
                data,
                owner: pyth_solana_receiver_sdk::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
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
            risk_state: risk_state_pda(&vault),
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

fn risk_update_instruction(
    fixture: &Fixture,
    risk_level: risk_vault::state::RiskLevel,
    risk_score: u8,
    contagion_state: risk_vault::state::ContagionState,
    max_leverage_x100: u16,
    observed_at: i64,
    nonce: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::UpdateRiskState {
            risk_level,
            risk_score,
            contagion_state,
            max_leverage_x100,
            observed_at,
            nonce,
        }
        .data(),
        risk_vault::accounts::UpdateRiskState {
            risk_authority: fixture.risk_authority.pubkey(),
            vault: fixture.vault,
            risk_state: risk_state_pda(&fixture.vault),
            clock: Clock::id(),
        }
        .to_account_metas(None),
    )
}

fn initialize_market_config_instruction(
    fixture: &Fixture,
    market: Pubkey,
    max_age_seconds: i64,
    maintenance_margin_bps: u16,
    max_confidence_bps: u16,
) -> Instruction {
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::InitializeMarketConfig {
            market,
            feed_id: fixture.feed_id,
            maintenance_margin_bps,
            max_confidence_bps,
            max_age_seconds,
        }
        .data(),
        risk_vault::accounts::InitializeMarketConfig {
            authority: fixture.vault_authority.pubkey(),
            vault: fixture.vault,
            collateral_mint: fixture.collateral_mint,
            market,
            oracle_update_account: fixture.oracle_update_account,
            market_config: market_config_pda(&fixture.vault, &market),
            system_program: system_program::ID,
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
    let oracle_update_account = Pubkey::new_unique();
    let feed_id = [7_u8; 32];
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
    svm.airdrop(&risk_authority.pubkey(), 1_000_000_000)
        .unwrap();
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

    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 1_000_000;
    svm.set_sysvar(&clock);
    let mut fixture = Fixture {
        svm,
        vault_authority: initializer,
        risk_authority,
        collateral_mint,
        vault,
        vault_token_account,
        oracle_update_account,
        feed_id,
    };
    set_pyth_price(&mut fixture, 300_000_000, 1_000, -8, 1_000_000, feed_id);
    fixture
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

#[test]
fn critical_risk_update_does_not_change_shares_or_disable_withdrawals() {
    let mut fixture = setup();
    let user = create_user(&mut fixture, 1_000);
    assert!(send_deposit(&mut fixture, &user, 250));

    let vault_before = vault_state(&fixture);
    let user_before = user_state(&fixture, &user);
    let user_tokens_before = token_balance(&fixture.svm, &user.token_account);
    let vault_tokens_before = token_balance(&fixture.svm, &fixture.vault_token_account);
    let clock = fixture.svm.get_sysvar::<Clock>();
    fixture.svm.set_sysvar(&clock);
    let update = risk_update_instruction(
        &fixture,
        risk_vault::state::RiskLevel::Critical,
        90,
        risk_vault::state::ContagionState::Active,
        0,
        clock.unix_timestamp,
        1,
    );
    assert!(send(&mut fixture.svm, &fixture.risk_authority, update));

    let vault_after = vault_state(&fixture);
    let user_after = user_state(&fixture, &user);
    assert_eq!(vault_after.total_deposits, vault_before.total_deposits);
    assert_eq!(vault_after.total_shares, vault_before.total_shares);
    assert_eq!(user_after.shares, user_before.shares);
    assert_eq!(
        token_balance(&fixture.svm, &user.token_account),
        user_tokens_before
    );
    assert_eq!(
        token_balance(&fixture.svm, &fixture.vault_token_account),
        vault_tokens_before
    );

    assert!(send_withdraw(
        &mut fixture,
        &user.keypair,
        user.keypair.pubkey(),
        user.user_vault_account,
        user.token_account,
        250,
    ));
    assert_eq!(vault_state(&fixture).total_deposits, 0);
}

fn position_pda(vault: &Pubkey, owner: &Pubkey, market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            risk_vault::constants::POSITION_SEED,
            vault.as_ref(),
            owner.as_ref(),
            market.as_ref(),
        ],
        &risk_vault::id(),
    )
}

fn set_clock(svm: &mut LiteSVM, timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = timestamp;
    svm.set_sysvar(&clock);
}

fn position_instruction(
    fixture: &Fixture,
    user: &User,
    market: Pubkey,
    side: risk_vault::state::PositionSide,
    size_delta: u64,
    notional_delta: u64,
    collateral_delta: u64,
) -> Instruction {
    let (position, _) = position_pda(&fixture.vault, &user.keypair.pubkey(), &market);
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::IncreasePosition {
            side,
            size_delta,
            notional_delta,
            collateral_delta,
        }
        .data(),
        risk_vault::accounts::IncreasePosition {
            owner: user.keypair.pubkey(),
            vault: fixture.vault,
            user_vault_account: user.user_vault_account,
            risk_state: risk_state_pda(&fixture.vault),
            market,
            market_config: market_config_pda(&fixture.vault, &market),
            oracle_update_account: fixture.oracle_update_account,
            position,
            clock: Clock::id(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn reduce_instruction(
    fixture: &Fixture,
    user: &User,
    market: Pubkey,
    size_delta: u64,
    notional_delta: u64,
) -> Instruction {
    let (position, _) = position_pda(&fixture.vault, &user.keypair.pubkey(), &market);
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::ReducePosition {
            size_delta,
            notional_delta,
        }
        .data(),
        risk_vault::accounts::ReducePosition {
            owner: user.keypair.pubkey(),
            vault: fixture.vault,
            user_vault_account: user.user_vault_account,
            market,
            market_config: market_config_pda(&fixture.vault, &market),
            oracle_update_account: fixture.oracle_update_account,
            position,
            clock: Clock::id(),
        }
        .to_account_metas(None),
    )
}

fn close_instruction(fixture: &Fixture, user: &User, market: Pubkey) -> Instruction {
    let (position, _) = position_pda(&fixture.vault, &user.keypair.pubkey(), &market);
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::ClosePosition {}.data(),
        risk_vault::accounts::ClosePosition {
            owner: user.keypair.pubkey(),
            vault: fixture.vault,
            user_vault_account: user.user_vault_account,
            market,
            market_config: market_config_pda(&fixture.vault, &market),
            oracle_update_account: fixture.oracle_update_account,
            position,
            clock: Clock::id(),
        }
        .to_account_metas(None),
    )
}

fn liquidate_instruction(fixture: &Fixture, owner: &User, market: Pubkey) -> Instruction {
    let (position, _) = position_pda(&fixture.vault, &owner.keypair.pubkey(), &market);
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::LiquidatePosition {}.data(),
        risk_vault::accounts::LiquidatePosition {
            liquidator: fixture.vault_authority.pubkey(),
            vault: fixture.vault,
            user_vault_account: owner.user_vault_account,
            market,
            market_config: market_config_pda(&fixture.vault, &market),
            oracle_update_account: fixture.oracle_update_account,
            position,
            owner: owner.keypair.pubkey(),
            clock: Clock::id(),
        }
        .to_account_metas(None),
    )
}

fn send_position(
    fixture: &mut Fixture,
    user: &User,
    market: Pubkey,
    side: risk_vault::state::PositionSide,
    size_delta: u64,
    notional_delta: u64,
    collateral_delta: u64,
) -> bool {
    if size_delta > 0 && notional_delta > 0 {
        let Some(price) = (notional_delta as u128)
            .checked_mul(risk_vault::constants::QUANTITY_SCALE as u128)
            .and_then(|value| value.checked_div(size_delta as u128))
            .and_then(|value| i64::try_from(value).ok())
        else {
            return false;
        };
        let now = fixture.svm.get_sysvar::<Clock>().unix_timestamp;
        let feed_id = fixture.feed_id;
        set_pyth_price(fixture, price, 0, -6, now, feed_id);
    }
    let instruction = position_instruction(
        fixture,
        user,
        market,
        side,
        size_delta,
        notional_delta,
        collateral_delta,
    );
    send(&mut fixture.svm, &user.keypair, instruction)
}

fn send_reduction(
    fixture: &mut Fixture,
    user: &User,
    market: Pubkey,
    size_delta: u64,
    notional_delta: u64,
) -> bool {
    let instruction = reduce_instruction(fixture, user, market, size_delta, notional_delta);
    send(&mut fixture.svm, &user.keypair, instruction)
}

fn send_close(fixture: &mut Fixture, user: &User, market: Pubkey) -> bool {
    let instruction = close_instruction(fixture, user, market);
    send(&mut fixture.svm, &user.keypair, instruction)
}

fn position_state(
    fixture: &Fixture,
    owner: &Pubkey,
    market: &Pubkey,
) -> risk_vault::state::Position {
    let (address, _) = position_pda(&fixture.vault, owner, market);
    let account = fixture.svm.get_account(&address).unwrap();
    let mut data: &[u8] = &account.data;
    risk_vault::state::Position::try_deserialize(&mut data).unwrap()
}

fn update_risk(
    fixture: &mut Fixture,
    level: risk_vault::state::RiskLevel,
    score: u8,
    contagion: risk_vault::state::ContagionState,
    cap: u16,
    nonce: u64,
) {
    let clock = fixture.svm.get_sysvar::<Clock>();
    fixture.svm.set_sysvar(&clock);
    let update = risk_update_instruction(
        fixture,
        level,
        score,
        contagion,
        cap,
        clock.unix_timestamp,
        nonce,
    );
    assert!(send(&mut fixture.svm, &fixture.risk_authority, update));
}

fn funded_position_fixture() -> (Fixture, User, Pubkey) {
    let mut fixture = setup();
    set_clock(&mut fixture.svm, 1_000_000);
    let user = create_user(&mut fixture, 1_000);
    assert!(send_deposit(&mut fixture, &user, 500));
    update_risk(
        &mut fixture,
        risk_vault::state::RiskLevel::Low,
        15,
        risk_vault::state::ContagionState::None,
        300,
        1,
    );
    let market = Pubkey::new_unique();
    let configure = initialize_market_config_instruction(&fixture, market, 30, 1_000, 100);
    assert!(send(&mut fixture.svm, &fixture.vault_authority, configure));
    (fixture, user, market)
}

#[test]
fn creates_position_and_stores_all_identity_and_accounting_fields() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        300,
        100
    ));

    let (expected_address, expected_bump) =
        position_pda(&fixture.vault, &user.keypair.pubkey(), &market);
    let position = position_state(&fixture, &user.keypair.pubkey(), &market);
    assert_eq!(fixture.svm.get_account(&expected_address).is_some(), true);
    assert_eq!(position.owner, user.keypair.pubkey());
    assert_eq!(position.vault, fixture.vault);
    assert_eq!(position.market, market);
    assert_eq!(position.side, risk_vault::state::PositionSide::Long);
    assert_eq!(position.size, 100);
    assert_eq!(position.notional, 300);
    assert_eq!(position.collateral_locked, 100);
    assert_eq!(position.status, risk_vault::state::PositionStatus::Open);
    assert_eq!(position.bump, expected_bump);
    assert_eq!(user_state(&fixture, &user).locked_collateral, 100);
}

#[test]
fn increase_rejects_stale_wrong_feed_and_wrong_owner_oracle_accounts() {
    let (mut fixture, user, market) = funded_position_fixture();
    let fake_notional = position_instruction(
        &fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        299,
        100,
    );
    assert!(!send(&mut fixture.svm, &user.keypair, fake_notional));
    let stale = position_instruction(
        &fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        300,
        100,
    );
    let feed_id = fixture.feed_id;
    set_pyth_price(&mut fixture, 3_000_000, 0, -6, 999_969, feed_id);
    assert!(!send(&mut fixture.svm, &user.keypair, stale));

    let wrong_feed = [8_u8; 32];
    set_pyth_price(&mut fixture, 3_000_000, 0, -6, 1_000_000, wrong_feed);
    let wrong_feed_ix = position_instruction(
        &fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        300,
        100,
    );
    assert!(!send(&mut fixture.svm, &user.keypair, wrong_feed_ix));

    set_pyth_price(&mut fixture, 3_000_000, 0, -6, 1_000_000, feed_id);
    let valid = fixture
        .svm
        .get_account(&fixture.oracle_update_account)
        .unwrap();
    fixture
        .svm
        .set_account(
            fixture.oracle_update_account,
            Account {
                owner: system_program::ID,
                ..valid
            },
        )
        .unwrap();
    let wrong_owner_ix = position_instruction(
        &fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        300,
        100,
    );
    assert!(!send(&mut fixture.svm, &user.keypair, wrong_owner_ix));
    assert!(fixture
        .svm
        .get_account(&position_pda(&fixture.vault, &user.keypair.pubkey(), &market).0)
        .is_none());
}

#[test]
fn leverage_boundary_allows_three_x_and_rejects_above_it_atomically() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        300,
        100
    ));
    let before = position_state(&fixture, &user.keypair.pubkey(), &market);
    assert!(!send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        1,
        1,
        0
    ));
    assert_eq!(
        position_state(&fixture, &user.keypair.pubkey(), &market),
        before
    );
}

#[test]
fn configured_cap_overrides_low_risk_cap() {
    let (mut fixture, user, market) = funded_position_fixture();
    update_risk(
        &mut fixture,
        risk_vault::state::RiskLevel::Low,
        15,
        risk_vault::state::ContagionState::None,
        200,
        2,
    );
    assert!(!send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        201,
        100
    ));
    assert!(fixture
        .svm
        .get_account(&position_pda(&fixture.vault, &user.keypair.pubkey(), &market).0)
        .is_none());
}

#[test]
fn medium_high_and_critical_risk_caps_are_enforced() {
    for (level, score, cap, notional, allowed) in [
        (risk_vault::state::RiskLevel::Medium, 35, 200, 200, true),
        (risk_vault::state::RiskLevel::High, 60, 100, 101, false),
        (risk_vault::state::RiskLevel::Critical, 90, 0, 1, false),
    ] {
        let (mut fixture, user, market) = funded_position_fixture();
        update_risk(
            &mut fixture,
            level,
            score,
            risk_vault::state::ContagionState::None,
            cap,
            2,
        );
        let result = send_position(
            &mut fixture,
            &user,
            market,
            risk_vault::state::PositionSide::Long,
            100,
            notional,
            100,
        );
        assert_eq!(result, allowed);
    }
}

#[test]
fn contagion_developing_caps_at_one_x_and_active_blocks_increases() {
    for (contagion, notional, allowed) in [
        (risk_vault::state::ContagionState::Developing, 100, true),
        (risk_vault::state::ContagionState::Developing, 101, false),
        (risk_vault::state::ContagionState::Active, 1, false),
    ] {
        let (mut fixture, user, market) = funded_position_fixture();
        update_risk(
            &mut fixture,
            risk_vault::state::RiskLevel::Low,
            15,
            contagion,
            risk_vault::policy::effective_policy_cap(risk_vault::state::RiskLevel::Low, contagion),
            2,
        );
        assert_eq!(
            send_position(
                &mut fixture,
                &user,
                market,
                risk_vault::state::PositionSide::Long,
                100,
                notional,
                100,
            ),
            allowed
        );
    }
}

#[test]
fn zero_values_cross_side_and_duplicate_market_are_rejected() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(!send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        0,
        100,
        100
    ));
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        100,
        100
    ));
    assert!(!send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Short,
        1,
        1,
        1
    ));
}

#[test]
fn insufficient_free_collateral_does_not_create_or_mutate_position() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(!send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        100,
        501
    ));
    assert_eq!(user_state(&fixture, &user).locked_collateral, 0);
    assert!(fixture
        .svm
        .get_account(&position_pda(&fixture.vault, &user.keypair.pubkey(), &market).0)
        .is_none());
}

#[test]
fn partial_reduction_releases_proportional_collateral_without_risk_state() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        300,
        100
    ));
    let clock = fixture.svm.get_sysvar::<Clock>();
    fixture.svm.set_sysvar(&Clock {
        unix_timestamp: clock.unix_timestamp
            + risk_vault::constants::MAX_RISK_STATE_AGE_SECONDS
            + 1,
        ..clock
    });
    let now = fixture.svm.get_sysvar::<Clock>().unix_timestamp;
    let feed_id = fixture.feed_id;
    set_pyth_price(&mut fixture, 3_000_000, 0, -6, now, feed_id);
    assert!(send_reduction(&mut fixture, &user, market, 50, 150));
    let position = position_state(&fixture, &user.keypair.pubkey(), &market);
    assert_eq!(position.size, 50);
    assert_eq!(position.notional, 150);
    assert_eq!(position.collateral_locked, 50);
    assert_eq!(user_state(&fixture, &user).locked_collateral, 50);
}

#[test]
fn over_reduction_and_zero_reduction_are_atomic() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        100,
        100
    ));
    let before = position_state(&fixture, &user.keypair.pubkey(), &market);
    assert!(!send_reduction(&mut fixture, &user, market, 101, 101));
    assert!(!send_reduction(&mut fixture, &user, market, 0, 0));
    assert_eq!(
        position_state(&fixture, &user.keypair.pubkey(), &market),
        before
    );
}

#[test]
fn close_zeroes_position_and_releases_all_collateral_under_critical_risk() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        100,
        100
    ));
    update_risk(
        &mut fixture,
        risk_vault::state::RiskLevel::Critical,
        90,
        risk_vault::state::ContagionState::Active,
        0,
        2,
    );
    assert!(send_close(&mut fixture, &user, market));
    let position = position_state(&fixture, &user.keypair.pubkey(), &market);
    assert_eq!(position.size, 0);
    assert_eq!(position.notional, 0);
    assert_eq!(position.collateral_locked, 0);
    assert_eq!(position.status, risk_vault::state::PositionStatus::Closed);
    assert_eq!(user_state(&fixture, &user).locked_collateral, 0);
    assert!(!send_close(&mut fixture, &user, market));
}

#[test]
fn loss_making_close_quarantines_collateral_without_settling_pnl() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        300,
        100,
    ));
    let feed_id = fixture.feed_id;
    set_pyth_price(&mut fixture, 100_000_000, 0, -8, 1_000_000, feed_id);
    assert!(send_close(&mut fixture, &user, market));

    let position = position_state(&fixture, &user.keypair.pubkey(), &market);
    assert_eq!(position.status, risk_vault::state::PositionStatus::Closed);
    assert_eq!(position.bad_debt, 100);
    let account = user_state(&fixture, &user);
    assert_eq!(account.locked_collateral, 0);
    assert_eq!(account.settlement_reserved, 100);
    assert_eq!(vault_state(&fixture).total_deposits, 500);
}

#[test]
fn permissionless_liquidation_quarantines_collateral_and_records_bad_debt() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        300,
        100,
    ));

    // $1 price versus $3 entry creates a diagnostic loss of 200 quote atoms.
    // This path never settles the loss against vault deposits or user shares.
    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += risk_vault::constants::MAX_RISK_STATE_AGE_SECONDS + 1;
    fixture.svm.set_sysvar(&clock);
    let feed_id = fixture.feed_id;
    set_pyth_price(
        &mut fixture,
        100_000_000,
        500,
        -8,
        clock.unix_timestamp,
        feed_id,
    );
    let instruction = liquidate_instruction(&fixture, &user, market);
    assert!(send(
        &mut fixture.svm,
        &fixture.vault_authority,
        instruction
    ));

    let position = position_state(&fixture, &user.keypair.pubkey(), &market);
    assert_eq!(position.status, risk_vault::state::PositionStatus::Closed);
    assert_eq!(position.size, 0);
    assert_eq!(position.notional, 0);
    assert_eq!(position.collateral_locked, 0);
    assert_eq!(position.bad_debt, 100);
    let user_state = user_state(&fixture, &user);
    assert_eq!(user_state.locked_collateral, 0);
    assert_eq!(user_state.settlement_reserved, 100);
    assert_eq!(vault_state(&fixture).total_deposits, 500);
    assert_eq!(user_state.shares, 500);
    assert!(!send_withdraw(
        &mut fixture,
        &user.keypair,
        user.keypair.pubkey(),
        user.user_vault_account,
        user.token_account,
        450,
    ));
    let second_liquidation = liquidate_instruction(&fixture, &user, market);
    assert!(!send(
        &mut fixture.svm,
        &fixture.vault_authority,
        second_liquidation,
    ));
}

#[test]
fn healthy_or_stale_price_position_cannot_be_liquidated() {
    let (mut fixture, user, market) = funded_position_fixture();
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        300,
        100,
    ));
    let healthy = liquidate_instruction(&fixture, &user, market);
    assert!(!send(&mut fixture.svm, &fixture.vault_authority, healthy));
    assert_eq!(
        position_state(&fixture, &user.keypair.pubkey(), &market).status,
        risk_vault::state::PositionStatus::Open
    );

    let mut clock = fixture.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += 31;
    fixture.svm.set_sysvar(&clock);
    let stale = liquidate_instruction(&fixture, &user, market);
    assert!(!send(&mut fixture.svm, &fixture.vault_authority, stale));
    assert_eq!(
        position_state(&fixture, &user.keypair.pubkey(), &market).status,
        risk_vault::state::PositionStatus::Open
    );
    assert_eq!(user_state(&fixture, &user).settlement_reserved, 0);
}

#[test]
fn unauthorized_user_cannot_modify_another_users_position() {
    let (mut fixture, user, market) = funded_position_fixture();
    let other = create_user(&mut fixture, 1_000);
    assert!(send_deposit(&mut fixture, &other, 500));
    assert!(send_position(
        &mut fixture,
        &user,
        market,
        risk_vault::state::PositionSide::Long,
        100,
        100,
        100
    ));
    let before = position_state(&fixture, &user.keypair.pubkey(), &market);
    let mut malicious = reduce_instruction(&fixture, &other, market, 50, 50);
    let (position, _) = position_pda(&fixture.vault, &user.keypair.pubkey(), &market);
    malicious.accounts[6].pubkey = position;
    assert!(!send(&mut fixture.svm, &other.keypair, malicious));
    assert_eq!(
        position_state(&fixture, &user.keypair.pubkey(), &market),
        before
    );
}
