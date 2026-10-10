import { describe, expect, it } from "vitest";
import { PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import {
  buildIncreasePositionInstruction,
  buildReducePositionInstruction,
  buildClosePositionInstruction,
  PositionSide,
  INCREASE_POSITION_DISCRIMINATOR,
  REDUCE_POSITION_DISCRIMINATOR,
  CLOSE_POSITION_DISCRIMINATOR,
} from "../src/solana/transactions";
import { RISK_VAULT_PROGRAM_ID } from "../../risk-publisher/src/risk-state";

describe("Phase 4 Transaction Builders", () => {
  const dummyOwner = new PublicKey("11111111111111111111111111111111");
  const dummyMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  const dummyMarket = new PublicKey("H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4SE5nv");
  const dummyOracle = new PublicKey("7UVimffxr9ow1ukKttssAKBiNdTe2deMm98qwx5Y8NNd");

  it("builds an increase_position instruction with matching 8-byte discriminator and accounts", () => {
    const ix = buildIncreasePositionInstruction({
      owner: dummyOwner,
      collateralMint: dummyMint,
      market: dummyMarket,
      oracleUpdateAccount: dummyOracle,
      side: PositionSide.Long,
      sizeDelta: 1_000_000n,
      notionalDelta: 150_000_000n,
      collateralDelta: 50_000_000n,
    });

    expect(ix.programId.toBase58()).toBe(RISK_VAULT_PROGRAM_ID.toBase58());
    expect(ix.data.subarray(0, 8)).toEqual(INCREASE_POSITION_DISCRIMINATOR);
    expect(ix.data.readUInt8(8)).toBe(PositionSide.Long);
    expect(ix.data.readBigUInt64LE(9)).toBe(1_000_000n);
    expect(ix.data.readBigUInt64LE(17)).toBe(150_000_000n);
    expect(ix.data.readBigUInt64LE(25)).toBe(50_000_000n);

    // Verify key accounts: owner signer, system program, clock
    expect(ix.keys[0].pubkey.toBase58()).toBe(dummyOwner.toBase58());
    expect(ix.keys[0].isSigner).toBe(true);
    expect(ix.keys[8].pubkey.toBase58()).toBe(SYSVAR_CLOCK_PUBKEY.toBase58());
    expect(ix.keys[9].pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
  });

  it("builds a reduce_position instruction with matching discriminator", () => {
    const ix = buildReducePositionInstruction({
      owner: dummyOwner,
      collateralMint: dummyMint,
      market: dummyMarket,
      oracleUpdateAccount: dummyOracle,
      sizeDelta: 500_000n,
      notionalDelta: 75_000_000n,
    });

    expect(ix.programId.toBase58()).toBe(RISK_VAULT_PROGRAM_ID.toBase58());
    expect(ix.data.subarray(0, 8)).toEqual(REDUCE_POSITION_DISCRIMINATOR);
    expect(ix.data.readBigUInt64LE(8)).toBe(500_000n);
    expect(ix.data.readBigUInt64LE(16)).toBe(75_000_000n);
  });

  it("builds a close_position instruction with matching discriminator and 8-byte payload", () => {
    const ix = buildClosePositionInstruction({
      owner: dummyOwner,
      collateralMint: dummyMint,
      market: dummyMarket,
      oracleUpdateAccount: dummyOracle,
    });

    expect(ix.programId.toBase58()).toBe(RISK_VAULT_PROGRAM_ID.toBase58());
    expect(ix.data).toEqual(CLOSE_POSITION_DISCRIMINATOR);
  });
});
