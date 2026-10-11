import "../polyfills.js";
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  deriveVaultAddress,
  deriveRiskStateAddress,
  RISK_VAULT_PROGRAM_ID,
} from "../../../risk-publisher/src/risk-state";

// Constants matching Anchor program seeds
export const USER_VAULT_SEED = Buffer.from("user_vault");
export const POSITION_SEED = Buffer.from("position");
export const MARKET_CONFIG_SEED = Buffer.from("market_config");

// Instruction 8-byte discriminators from IDL
// increase_position: [253, 234, 128, 104, 192, 188, 45, 91]
export const INCREASE_POSITION_DISCRIMINATOR = Buffer.from([
  253, 234, 128, 104, 192, 188, 45, 91,
]);

// reduce_position: [96, 202, 33, 80, 24, 197, 33, 77]
export const REDUCE_POSITION_DISCRIMINATOR = Buffer.from([
  96, 202, 33, 80, 24, 197, 33, 77,
]);

// close_position: [123, 134, 81, 0, 49, 68, 98, 98]
export const CLOSE_POSITION_DISCRIMINATOR = Buffer.from([
  123, 134, 81, 0, 49, 68, 98, 98,
]);

// initialize_user_vault_account: [10, 106, 178, 52, 164, 91, 108, 69]
export const INITIALIZE_USER_VAULT_ACCOUNT_DISCRIMINATOR = Buffer.from([
  10, 106, 178, 52, 164, 91, 108, 69,
]);

// deposit: [242, 35, 198, 137, 82, 225, 242, 182]
export const DEPOSIT_DISCRIMINATOR = Buffer.from([
  242, 35, 198, 137, 82, 225, 242, 182,
]);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export function decodeUserVaultAccount(data: Buffer): {
  owner: PublicKey;
  vault: PublicKey;
  shares: bigint;
  lockedCollateral: bigint;
  settlementReserved: bigint;
  bump: number;
} {
  // Layout: discriminator(8) + owner(32) + vault(32) + shares(8) + locked_collateral(8) + settlement_reserved(8) + bump(1)
  return {
    owner: new PublicKey(data.subarray(8, 40)),
    vault: new PublicKey(data.subarray(40, 72)),
    shares: data.readBigUInt64LE(72),
    lockedCollateral: data.readBigUInt64LE(80),
    settlementReserved: data.readBigUInt64LE(88),
    bump: data.readUInt8(96),
  };
}

export function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  const SYSVAR_RENT_PUBKEY = new PublicKey(
    "SysvarRent111111111111111111111111111111111",
  );
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.alloc(0),
  });
}

export enum PositionSide {
  Long = 0,
  Short = 1,
}

export function parsePythPriceUpdateV2(data: Buffer): {
  normalizedPrice: bigint;
  publishTime: bigint;
} {
  // Pyth PriceUpdateV2 binary memory layout:
  // discriminator: 8 bytes (0..8)
  // write_authority: 32 bytes (8..40)
  // verification_level: 1 byte (40..41)
  // price_message:
  //   feed_id: 32 bytes (41..73)
  //   price: i64 (73..81)
  //   conf: u64 (81..89)
  //   exponent: i32 (89..93)
  //   publish_time: i64 (93..101)
  const rawPrice = data.readBigInt64LE(73);
  const exponent = data.readInt32LE(89);
  const publishTime = data.readBigInt64LE(93);

  const scaleDelta = exponent + 6;
  let normalizedPrice: bigint;
  if (scaleDelta >= 0) {
    normalizedPrice = rawPrice * 10n ** BigInt(scaleDelta);
  } else {
    normalizedPrice = rawPrice / 10n ** BigInt(-scaleDelta);
  }

  return { normalizedPrice, publishTime };
}

export function notionalForSize(
  sizeDelta: bigint,
  normalizedPrice: bigint,
): bigint {
  const QUANTITY_SCALE = 1_000_000n;
  return (sizeDelta * normalizedPrice) / QUANTITY_SCALE;
}

export function deriveUserVaultAddress(
  vaultAddress: PublicKey,
  userAddress: PublicKey,
  programId = RISK_VAULT_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_VAULT_SEED, vaultAddress.toBuffer(), userAddress.toBuffer()],
    programId,
  );
}

export function derivePositionAddress(
  vaultAddress: PublicKey,
  userAddress: PublicKey,
  marketAddress: PublicKey,
  programId = RISK_VAULT_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      POSITION_SEED,
      vaultAddress.toBuffer(),
      userAddress.toBuffer(),
      marketAddress.toBuffer(),
    ],
    programId,
  );
}

export function deriveMarketConfigAddress(
  vaultAddress: PublicKey,
  marketAddress: PublicKey,
  programId = RISK_VAULT_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MARKET_CONFIG_SEED, vaultAddress.toBuffer(), marketAddress.toBuffer()],
    programId,
  );
}

export interface BuildIncreasePositionParams {
  owner: PublicKey;
  collateralMint: PublicKey;
  market: PublicKey;
  oracleUpdateAccount: PublicKey;
  side: PositionSide;
  sizeDelta: bigint;
  notionalDelta: bigint;
  collateralDelta: bigint;
  programId?: PublicKey;
}

export function buildIncreasePositionInstruction(
  params: BuildIncreasePositionParams,
): TransactionInstruction {
  const programId = params.programId ?? RISK_VAULT_PROGRAM_ID;
  const [vault] = deriveVaultAddress(params.collateralMint);
  const [userVaultAccount] = deriveUserVaultAddress(
    vault,
    params.owner,
    programId,
  );
  const [riskState] = deriveRiskStateAddress(vault);
  const [marketConfig] = deriveMarketConfigAddress(
    vault,
    params.market,
    programId,
  );
  const [position] = derivePositionAddress(
    vault,
    params.owner,
    params.market,
    programId,
  );

  // Layout: discriminator(8) + side(1) + size_delta(8) + notional_delta(8) + collateral_delta(8) = 33 bytes
  const data = Buffer.alloc(8 + 1 + 8 + 8 + 8);
  INCREASE_POSITION_DISCRIMINATOR.copy(data, 0);
  data.writeUInt8(params.side, 8);
  data.writeBigUInt64LE(params.sizeDelta, 9);
  data.writeBigUInt64LE(params.notionalDelta, 17);
  data.writeBigUInt64LE(params.collateralDelta, 25);

  const keys = [
    { pubkey: params.owner, isSigner: true, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: userVaultAccount, isSigner: false, isWritable: true },
    { pubkey: riskState, isSigner: false, isWritable: false },
    { pubkey: params.market, isSigner: false, isWritable: false },
    { pubkey: marketConfig, isSigner: false, isWritable: false },
    { pubkey: params.oracleUpdateAccount, isSigner: false, isWritable: false },
    { pubkey: position, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

export interface BuildReducePositionParams {
  owner: PublicKey;
  collateralMint: PublicKey;
  market: PublicKey;
  oracleUpdateAccount: PublicKey;
  sizeDelta: bigint;
  notionalDelta: bigint;
  programId?: PublicKey;
}

export function buildReducePositionInstruction(
  params: BuildReducePositionParams,
): TransactionInstruction {
  const programId = params.programId ?? RISK_VAULT_PROGRAM_ID;
  const [vault] = deriveVaultAddress(params.collateralMint);
  const [userVaultAccount] = deriveUserVaultAddress(
    vault,
    params.owner,
    programId,
  );
  const [marketConfig] = deriveMarketConfigAddress(
    vault,
    params.market,
    programId,
  );
  const [position] = derivePositionAddress(
    vault,
    params.owner,
    params.market,
    programId,
  );

  // Layout: discriminator(8) + size_delta(8) + notional_delta(8) = 24 bytes
  const data = Buffer.alloc(8 + 8 + 8);
  REDUCE_POSITION_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(params.sizeDelta, 8);
  data.writeBigUInt64LE(params.notionalDelta, 16);

  const keys = [
    { pubkey: params.owner, isSigner: true, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: userVaultAccount, isSigner: false, isWritable: true },
    { pubkey: params.market, isSigner: false, isWritable: false },
    { pubkey: marketConfig, isSigner: false, isWritable: false },
    { pubkey: params.oracleUpdateAccount, isSigner: false, isWritable: false },
    { pubkey: position, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

export interface BuildClosePositionParams {
  owner: PublicKey;
  collateralMint: PublicKey;
  market: PublicKey;
  oracleUpdateAccount: PublicKey;
  programId?: PublicKey;
}

export function buildClosePositionInstruction(
  params: BuildClosePositionParams,
): TransactionInstruction {
  const programId = params.programId ?? RISK_VAULT_PROGRAM_ID;
  const [vault] = deriveVaultAddress(params.collateralMint);
  const [userVaultAccount] = deriveUserVaultAddress(
    vault,
    params.owner,
    programId,
  );
  const [marketConfig] = deriveMarketConfigAddress(
    vault,
    params.market,
    programId,
  );
  const [position] = derivePositionAddress(
    vault,
    params.owner,
    params.market,
    programId,
  );

  // Layout: discriminator(8)
  const data = Buffer.alloc(8);
  CLOSE_POSITION_DISCRIMINATOR.copy(data, 0);

  const keys = [
    { pubkey: params.owner, isSigner: true, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: userVaultAccount, isSigner: false, isWritable: true },
    { pubkey: params.market, isSigner: false, isWritable: false },
    { pubkey: marketConfig, isSigner: false, isWritable: false },
    { pubkey: params.oracleUpdateAccount, isSigner: false, isWritable: false },
    { pubkey: position, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

export interface BuildInitializeUserVaultAccountParams {
  owner: PublicKey;
  collateralMint: PublicKey;
  programId?: PublicKey;
}

export function buildInitializeUserVaultAccountInstruction(
  params: BuildInitializeUserVaultAccountParams,
): TransactionInstruction {
  const programId = params.programId ?? RISK_VAULT_PROGRAM_ID;
  const [vault] = deriveVaultAddress(params.collateralMint);
  const [userVaultAccount] = deriveUserVaultAddress(
    vault,
    params.owner,
    programId,
  );

  const data = Buffer.alloc(8);
  INITIALIZE_USER_VAULT_ACCOUNT_DISCRIMINATOR.copy(data, 0);

  const keys = [
    { pubkey: params.owner, isSigner: true, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: userVaultAccount, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}

export interface BuildDepositParams {
  owner: PublicKey;
  collateralMint: PublicKey;
  amount: bigint;
  programId?: PublicKey;
}

export function buildDepositInstruction(
  params: BuildDepositParams,
): TransactionInstruction {
  const programId = params.programId ?? RISK_VAULT_PROGRAM_ID;
  const [vault] = deriveVaultAddress(params.collateralMint);
  const [userVaultAccount] = deriveUserVaultAddress(
    vault,
    params.owner,
    programId,
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    params.collateralMint,
    params.owner,
  );
  const vaultTokenAccount = getAssociatedTokenAddressSync(
    params.collateralMint,
    vault,
  );

  // Layout: discriminator(8) + amount(8) = 16 bytes
  const data = Buffer.alloc(8 + 8);
  DEPOSIT_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(params.amount, 8);

  const keys = [
    { pubkey: params.owner, isSigner: true, isWritable: false },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: params.collateralMint, isSigner: false, isWritable: false },
    { pubkey: userVaultAccount, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId,
    data,
  });
}
