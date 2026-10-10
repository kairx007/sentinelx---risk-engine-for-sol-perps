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

export enum PositionSide {
  Long = 0,
  Short = 1,
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
  const [vault] = deriveVaultAddress(params.collateralMint, programId);
  const [userVaultAccount] = deriveUserVaultAddress(
    vault,
    params.owner,
    programId,
  );
  const [riskState] = deriveRiskStateAddress(vault, programId);
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
  const [vault] = deriveVaultAddress(params.collateralMint, programId);
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
  const [vault] = deriveVaultAddress(params.collateralMint, programId);
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
