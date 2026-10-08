use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{
        instruction::Instruction, program_option::COption, program_pack::Pack, system_program,
        sysvar::SysvarId,
    },
    AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use anchor_spl::token::{spl_token::state::Mint, ID as TOKEN_PROGRAM_ID};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

struct Fixture {
    svm: LiteSVM,
    authority: Keypair,
    risk_authority: Keypair,
    vault: Pubkey,
    risk_state: Pubkey,
}

const TEST_TIME: i64 = 1_000_000;

fn vault_pda(collateral_mint: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[risk_vault::constants::VAULT_SEED, collateral_mint.as_ref()],
        &risk_vault::id(),
    )
    .0
}

fn risk_state_pda(vault: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[risk_vault::constants::RISK_STATE_SEED, vault.as_ref()],
        &risk_vault::id(),
    )
    .0
}

fn set_clock(svm: &mut LiteSVM, timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = timestamp;
    svm.set_sysvar(&clock);
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

fn setup() -> Fixture {
    let mut svm = LiteSVM::new();
    let authority = Keypair::new();
    let risk_authority = Keypair::new();
    let collateral_mint = Pubkey::new_unique();
    let vault = vault_pda(collateral_mint);
    let risk_state = risk_state_pda(vault);

    svm.add_program(
        risk_vault::id(),
        include_bytes!(concat!(
            env!("CARGO_TARGET_TMPDIR"),
            "/../deploy/risk_vault.so"
        )),
    )
    .unwrap();
    set_clock(&mut svm, TEST_TIME);
    svm.airdrop(&authority.pubkey(), 2_000_000_000).unwrap();
    svm.airdrop(&risk_authority.pubkey(), 1_000_000_000)
        .unwrap();

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

    let instruction = Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::InitializeVault {
            risk_authority: risk_authority.pubkey(),
        }
        .data(),
        risk_vault::accounts::InitializeVault {
            authority: authority.pubkey(),
            collateral_mint,
            vault,
            risk_state,
            vault_token_account: anchor_spl::associated_token::get_associated_token_address(
                &vault,
                &collateral_mint,
            ),
            token_program: TOKEN_PROGRAM_ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(send(&mut svm, &authority, instruction));

    Fixture {
        svm,
        authority,
        risk_authority,
        vault,
        risk_state,
    }
}

fn update_instruction(
    signer: Pubkey,
    vault: Pubkey,
    risk_state: Pubkey,
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
            risk_authority: signer,
            vault,
            risk_state,
            clock: Clock::id(),
        }
        .to_account_metas(None),
    )
}

fn send_configured_update(
    fixture: &mut Fixture,
    risk_level: risk_vault::state::RiskLevel,
    risk_score: u8,
    contagion_state: risk_vault::state::ContagionState,
    max_leverage_x100: u16,
    observed_at: i64,
    nonce: u64,
) -> bool {
    let signer = &fixture.risk_authority;
    let instruction = update_instruction(
        signer.pubkey(),
        fixture.vault,
        fixture.risk_state,
        risk_level,
        risk_score,
        contagion_state,
        max_leverage_x100,
        observed_at,
        nonce,
    );
    let svm = &mut fixture.svm;
    send(svm, signer, instruction)
}

fn read_risk_state(fixture: &Fixture) -> risk_vault::state::RiskState {
    let account = fixture.svm.get_account(&fixture.risk_state).unwrap();
    let mut data: &[u8] = &account.data;
    risk_vault::state::RiskState::try_deserialize(&mut data).unwrap()
}

fn rotate_instruction(
    fixture: &Fixture,
    authority: Pubkey,
    new_risk_authority: Pubkey,
) -> Instruction {
    Instruction::new_with_bytes(
        risk_vault::id(),
        &risk_vault::instruction::RotateRiskAuthority { new_risk_authority }.data(),
        risk_vault::accounts::RotateRiskAuthority {
            authority,
            vault: fixture.vault,
        }
        .to_account_metas(None),
    )
}

#[test]
fn initializes_exact_risk_state_pda_with_fail_closed_defaults() {
    let fixture = setup();
    let (expected, bump) = Pubkey::find_program_address(
        &[
            risk_vault::constants::RISK_STATE_SEED,
            fixture.vault.as_ref(),
        ],
        &risk_vault::id(),
    );
    assert_eq!(fixture.risk_state, expected);
    let state = read_risk_state(&fixture);
    assert_eq!(state.risk_level, risk_vault::state::RiskLevel::Critical);
    assert_eq!(state.risk_score, 100);
    assert_eq!(
        state.contagion_state,
        risk_vault::state::ContagionState::Active
    );
    assert_eq!(state.max_leverage_x100, 0);
    assert_eq!(state.observed_at, 0);
    assert_eq!(state.updated_at, 0);
    assert_eq!(state.nonce, 0);
    assert_eq!(state.bump, bump);
}

#[test]
fn configured_risk_authority_can_publish_each_level() {
    let mut fixture = setup();
    let cases = [
        (risk_vault::state::RiskLevel::Low, 20, 300),
        (risk_vault::state::RiskLevel::Medium, 40, 200),
        (risk_vault::state::RiskLevel::High, 60, 100),
        (risk_vault::state::RiskLevel::Critical, 90, 0),
    ];

    for (index, (level, score, leverage)) in cases.into_iter().enumerate() {
        assert!(send_configured_update(
            &mut fixture,
            level,
            score,
            risk_vault::state::ContagionState::None,
            leverage,
            TEST_TIME,
            index as u64 + 1,
        ));
        let state = read_risk_state(&fixture);
        assert_eq!(state.risk_level, level);
        assert_eq!(state.risk_score, score);
        assert_eq!(state.max_leverage_x100, leverage);
        assert_eq!(state.nonce, index as u64 + 1);
        assert_eq!(state.updated_at, TEST_TIME);
    }
}

#[test]
fn preserves_and_caps_all_contagion_states() {
    let mut fixture = setup();
    let cases = [
        (risk_vault::state::ContagionState::None, 300),
        (risk_vault::state::ContagionState::Isolated, 300),
        (risk_vault::state::ContagionState::Developing, 100),
        (risk_vault::state::ContagionState::Active, 0),
    ];

    for (index, (contagion, leverage)) in cases.into_iter().enumerate() {
        assert!(send_configured_update(
            &mut fixture,
            risk_vault::state::RiskLevel::Low,
            10,
            contagion,
            leverage,
            TEST_TIME,
            index as u64 + 1,
        ));
        let state = read_risk_state(&fixture);
        assert_eq!(state.contagion_state, contagion);
        assert_eq!(state.max_leverage_x100, leverage);
    }
}

#[test]
fn vault_authority_and_random_signers_cannot_publish_risk() {
    let mut fixture = setup();
    let random = Keypair::new();
    fixture
        .svm
        .airdrop(&random.pubkey(), 1_000_000_000)
        .unwrap();
    let authority_update = update_instruction(
        fixture.authority.pubkey(),
        fixture.vault,
        fixture.risk_state,
        risk_vault::state::RiskLevel::Low,
        10,
        risk_vault::state::ContagionState::None,
        300,
        TEST_TIME,
        1,
    );
    assert!(!send(
        &mut fixture.svm,
        &fixture.authority,
        authority_update
    ));

    let random_update = update_instruction(
        random.pubkey(),
        fixture.vault,
        fixture.risk_state,
        risk_vault::state::RiskLevel::Low,
        10,
        risk_vault::state::ContagionState::None,
        300,
        TEST_TIME,
        1,
    );
    assert!(!send(&mut fixture.svm, &random, random_update));
    assert_eq!(read_risk_state(&fixture).nonce, 0);
}

#[test]
fn rejects_invalid_scores_and_score_level_mismatches() {
    let mut fixture = setup();
    let invalid = [
        (risk_vault::state::RiskLevel::Low, 70),
        (risk_vault::state::RiskLevel::Medium, 20),
        (risk_vault::state::RiskLevel::High, 40),
        (risk_vault::state::RiskLevel::Critical, 75),
    ];
    for (level, score) in invalid {
        assert!(!send_configured_update(
            &mut fixture,
            level,
            score,
            risk_vault::state::ContagionState::None,
            0,
            TEST_TIME,
            1,
        ));
    }
    assert!(!send_configured_update(
        &mut fixture,
        risk_vault::state::RiskLevel::Critical,
        101,
        risk_vault::state::ContagionState::None,
        0,
        TEST_TIME,
        1,
    ));
    assert_eq!(read_risk_state(&fixture).nonce, 0);
}

#[test]
fn enforces_level_and_contagion_leverage_caps() {
    let mut fixture = setup();
    let invalid = [
        (
            risk_vault::state::RiskLevel::Low,
            risk_vault::state::ContagionState::None,
            350,
        ),
        (
            risk_vault::state::RiskLevel::Medium,
            risk_vault::state::ContagionState::None,
            250,
        ),
        (
            risk_vault::state::RiskLevel::High,
            risk_vault::state::ContagionState::None,
            150,
        ),
        (
            risk_vault::state::RiskLevel::Critical,
            risk_vault::state::ContagionState::None,
            100,
        ),
        (
            risk_vault::state::RiskLevel::Low,
            risk_vault::state::ContagionState::Developing,
            150,
        ),
        (
            risk_vault::state::RiskLevel::Low,
            risk_vault::state::ContagionState::Active,
            100,
        ),
    ];

    for (level, contagion, leverage) in invalid {
        let score = match level {
            risk_vault::state::RiskLevel::Low => 10,
            risk_vault::state::RiskLevel::Medium => 40,
            risk_vault::state::RiskLevel::High => 60,
            risk_vault::state::RiskLevel::Critical => 90,
        };
        assert!(!send_configured_update(
            &mut fixture,
            level,
            score,
            contagion,
            leverage,
            TEST_TIME,
            1,
        ));
    }
    assert_eq!(read_risk_state(&fixture).nonce, 0);
}

#[test]
fn requires_exactly_the_next_nonce() {
    let mut fixture = setup();
    let level = risk_vault::state::RiskLevel::Low;
    let contagion = risk_vault::state::ContagionState::None;
    assert!(send_configured_update(
        &mut fixture,
        level,
        10,
        contagion,
        300,
        TEST_TIME,
        1
    ));
    for nonce in [1, 0, 3] {
        assert!(!send_configured_update(
            &mut fixture,
            level,
            10,
            contagion,
            300,
            TEST_TIME,
            nonce,
        ));
    }
    assert!(send_configured_update(
        &mut fixture,
        level,
        10,
        contagion,
        300,
        TEST_TIME,
        2
    ));
    assert_eq!(read_risk_state(&fixture).nonce, 2);
}

#[test]
fn enforces_timestamp_age_future_skew_and_nonnegative_time() {
    let mut fixture = setup();
    let level = risk_vault::state::RiskLevel::Low;
    let contagion = risk_vault::state::ContagionState::None;

    assert!(!send_configured_update(
        &mut fixture,
        level,
        10,
        contagion,
        300,
        TEST_TIME - 301,
        1,
    ));
    assert!(!send_configured_update(
        &mut fixture,
        level,
        10,
        contagion,
        300,
        TEST_TIME + 31,
        1,
    ));
    assert!(!send_configured_update(
        &mut fixture,
        level,
        10,
        contagion,
        300,
        -1,
        1,
    ));
    assert!(send_configured_update(
        &mut fixture,
        level,
        10,
        contagion,
        300,
        TEST_TIME + 30,
        1,
    ));
    let state = read_risk_state(&fixture);
    assert_eq!(state.observed_at, TEST_TIME + 30);
    assert_eq!(state.updated_at, TEST_TIME);
}

#[test]
fn rejects_nonce_overflow() {
    let mut fixture = setup();
    let account = fixture.svm.get_account(&fixture.risk_state).unwrap();
    let mut data: &[u8] = &account.data;
    let mut state = risk_vault::state::RiskState::try_deserialize(&mut data).unwrap();
    state.nonce = u64::MAX;
    let mut serialized = Vec::new();
    state.try_serialize(&mut serialized).unwrap();
    let mut account = account;
    account.data = serialized;
    fixture
        .svm
        .set_account(fixture.risk_state, account)
        .unwrap();

    assert!(!send_configured_update(
        &mut fixture,
        risk_vault::state::RiskLevel::Low,
        10,
        risk_vault::state::ContagionState::None,
        300,
        TEST_TIME,
        0,
    ));
}

#[test]
fn vault_authority_can_rotate_risk_authority_and_old_key_stops_working() {
    let mut fixture = setup();
    let replacement = Keypair::new();
    fixture
        .svm
        .airdrop(&replacement.pubkey(), 1_000_000_000)
        .unwrap();
    let rotate = rotate_instruction(&fixture, fixture.authority.pubkey(), replacement.pubkey());
    assert!(send(&mut fixture.svm, &fixture.authority, rotate));

    let old_key_update = update_instruction(
        fixture.risk_authority.pubkey(),
        fixture.vault,
        fixture.risk_state,
        risk_vault::state::RiskLevel::Low,
        10,
        risk_vault::state::ContagionState::None,
        300,
        TEST_TIME,
        1,
    );
    assert!(!send(
        &mut fixture.svm,
        &fixture.risk_authority,
        old_key_update
    ));
    let new_key_update = update_instruction(
        replacement.pubkey(),
        fixture.vault,
        fixture.risk_state,
        risk_vault::state::RiskLevel::Low,
        10,
        risk_vault::state::ContagionState::None,
        300,
        TEST_TIME,
        1,
    );
    assert!(send(&mut fixture.svm, &replacement, new_key_update));

    let rotate_to_authority = rotate_instruction(
        &fixture,
        fixture.authority.pubkey(),
        fixture.authority.pubkey(),
    );
    assert!(send(
        &mut fixture.svm,
        &fixture.authority,
        rotate_to_authority
    ));
    let explicitly_configured_authority = update_instruction(
        fixture.authority.pubkey(),
        fixture.vault,
        fixture.risk_state,
        risk_vault::state::RiskLevel::Low,
        10,
        risk_vault::state::ContagionState::None,
        300,
        TEST_TIME,
        2,
    );
    assert!(send(
        &mut fixture.svm,
        &fixture.authority,
        explicitly_configured_authority
    ));
}

#[test]
fn unauthorized_or_default_risk_authority_rotation_fails() {
    let mut fixture = setup();
    let random = Keypair::new();
    fixture
        .svm
        .airdrop(&random.pubkey(), 1_000_000_000)
        .unwrap();

    let unauthorized = rotate_instruction(&fixture, random.pubkey(), Pubkey::new_unique());
    assert!(!send(&mut fixture.svm, &random, unauthorized));
    let default_key = rotate_instruction(&fixture, fixture.authority.pubkey(), Pubkey::default());
    assert!(!send(&mut fixture.svm, &fixture.authority, default_key));
    assert_eq!(
        risk_vault::state::Vault::try_deserialize(
            &mut fixture
                .svm
                .get_account(&fixture.vault)
                .unwrap()
                .data
                .as_slice()
        )
        .unwrap()
        .risk_authority,
        fixture.risk_authority.pubkey()
    );
}
