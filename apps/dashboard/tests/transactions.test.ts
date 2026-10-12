// @vitest-environment node
import "../src/polyfills";
import { describe, expect, it } from "vitest";
import { PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import {
  buildIncreasePositionInstruction,
  buildReducePositionInstruction,
  buildClosePositionInstruction,
  buildInitializeUserVaultAccountInstruction,
  buildDepositInstruction,
  decodeUserVaultAccount,
  parsePythPriceUpdateV2,
  notionalForSize,
  PositionSide,
  INCREASE_POSITION_DISCRIMINATOR,
  REDUCE_POSITION_DISCRIMINATOR,
  CLOSE_POSITION_DISCRIMINATOR,
  INITIALIZE_USER_VAULT_ACCOUNT_DISCRIMINATOR,
  DEPOSIT_DISCRIMINATOR,
} from "../src/solana/transactions";
import { RISK_VAULT_PROGRAM_ID } from "../../risk-publisher/src/risk-state";

describe("Phase 4 Transaction Builders", () => {
  const dummyOwner = new PublicKey("11111111111111111111111111111111");
  const dummyMint = new PublicKey(
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  );
  const dummyMarket = new PublicKey(
    "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4SE5nv",
  );
  const dummyOracle = new PublicKey(
    "7UVimffxr9ow1ukKttssAKBiNdTe2deMm98qwx5Y8NNd",
  );

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
    expect(ix.keys[0]?.pubkey.toBase58()).toBe(dummyOwner.toBase58());
    expect(ix.keys[0]?.isSigner).toBe(true);
    expect(ix.keys[8]?.pubkey.toBase58()).toBe(SYSVAR_CLOCK_PUBKEY.toBase58());
    expect(ix.keys[9]?.pubkey.toBase58()).toBe(
      SystemProgram.programId.toBase58(),
    );
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

  it("verifies that building instructions for Increase, Reduce, and Close works without accessing Node process", () => {
    // Increase
    const incIx = buildIncreasePositionInstruction({
      owner: dummyOwner,
      collateralMint: dummyMint,
      market: dummyMarket,
      oracleUpdateAccount: dummyOracle,
      side: PositionSide.Long,
      sizeDelta: 1_000_000n,
      notionalDelta: 150_000_000n,
      collateralDelta: 50_000_000n,
    });
    expect(incIx.keys.length).toBe(10);

    // Reduce
    const redIx = buildReducePositionInstruction({
      owner: dummyOwner,
      collateralMint: dummyMint,
      market: dummyMarket,
      oracleUpdateAccount: dummyOracle,
      sizeDelta: 500_000n,
      notionalDelta: 75_000_000n,
    });
    expect(redIx.keys.length).toBe(8);

    // Close
    const closeIx = buildClosePositionInstruction({
      owner: dummyOwner,
      collateralMint: dummyMint,
      market: dummyMarket,
      oracleUpdateAccount: dummyOracle,
    });
    expect(closeIx.keys.length).toBe(8);

    // Initialize User Vault Account
    const initIx = buildInitializeUserVaultAccountInstruction({
      owner: dummyOwner,
      collateralMint: dummyMint,
    });
    expect(initIx.keys.length).toBe(4);
    expect(initIx.keys[0]?.pubkey.toBase58()).toBe(dummyOwner.toBase58());
    expect(initIx.keys[0]?.isSigner).toBe(true);
    expect(initIx.keys[3]?.pubkey.toBase58()).toBe(
      SystemProgram.programId.toBase58(),
    );
    expect(initIx.data.subarray(0, 8)).toEqual(
      INITIALIZE_USER_VAULT_ACCOUNT_DISCRIMINATOR,
    );
  });

  it("accurately parses Pyth PriceUpdateV2 and computes integer notionalDelta", () => {
    // Construct dummy Pyth PriceUpdateV2 buffer
    // Layout: 8 bytes discriminator + 32 bytes auth + 1 byte verif + 32 bytes feed_id
    // + 8 bytes price + 8 bytes conf + 4 bytes expo + 8 bytes pub_time
    const buffer = Buffer.alloc(134);
    buffer.writeUInt8(1, 40); // VerificationLevel::Full
    buffer.writeBigInt64LE(10946856370n, 73); // $109.46856370 with expo -8
    buffer.writeBigUInt64LE(2986445n, 81);
    buffer.writeInt32LE(-8, 89);
    buffer.writeBigInt64LE(1700000000n, 93);

    const { normalizedPrice, publishTime } = parsePythPriceUpdateV2(buffer, 0);
    expect(normalizedPrice).toBe(109468563n); // scaled to 6 decimals (scale_delta = -8 + 6 = -2 -> /100)
    expect(publishTime).toBe(1700000000n);

    // Compute notional for 1.0 SOL (1_000_000n atoms)
    const notional = notionalForSize(1_000_000n, normalizedPrice);
    expect(notional).toBe(109468563n);
  });

  describe("Regression tests: InvalidPrice and Oracle validations", () => {
    it("rejects non-positive oracle price, zero size, and zero notional", () => {
      const buffer = Buffer.alloc(134);
      buffer.writeUInt8(1, 40);
      buffer.writeBigInt64LE(0n, 73); // Zero price
      buffer.writeBigUInt64LE(0n, 81);
      buffer.writeInt32LE(-8, 89);
      buffer.writeBigInt64LE(1700000000n, 93);

      expect(() => parsePythPriceUpdateV2(buffer, 0)).toThrow(/non-positive/);
      expect(() => notionalForSize(0n, 100_000_000n)).toThrow(/size must be greater than zero/);
      expect(() => notionalForSize(1_000_000n, 0n)).toThrow(/Price must be greater than zero/);
    });

    it("rejects confidence exceeding price and unverified oracle feed", () => {
      const unverifiedBuffer = Buffer.alloc(134);
      unverifiedBuffer.writeUInt8(0, 40); // Partial / unverified
      unverifiedBuffer.writeBigInt64LE(100_000_000n, 73);
      unverifiedBuffer.writeInt32LE(-8, 89);
      expect(() => parsePythPriceUpdateV2(unverifiedBuffer, 0)).toThrow(/not fully verified/);

      const highConfBuffer = Buffer.alloc(134);
      highConfBuffer.writeUInt8(1, 40);
      highConfBuffer.writeBigInt64LE(100_000_000n, 73);
      highConfBuffer.writeBigUInt64LE(100_000_001n, 81); // conf > price
      highConfBuffer.writeInt32LE(-8, 89);
      expect(() => parsePythPriceUpdateV2(highConfBuffer, 0)).toThrow(/confidence .* exceeds or equals price/);
    });

    it("rejects stale and future oracle updates", () => {
      const buffer = Buffer.alloc(134);
      buffer.writeUInt8(1, 40);
      buffer.writeBigInt64LE(100_000_000n, 73);
      buffer.writeBigUInt64LE(1_000n, 81);
      buffer.writeInt32LE(-8, 89);
      buffer.writeBigInt64LE(1000n, 93); // Published at t=1000

      // Future time check (now = 900 < publishTime = 1000)
      expect(() => parsePythPriceUpdateV2(buffer, 30, 900)).toThrow(/timestamp is in the future/);

      // Stale check (now = 1050 > 1000 + 30)
      expect(() => parsePythPriceUpdateV2(buffer, 30, 1050)).toThrow(/oracle price is stale/);
    });

    it("rejects unsupported exponents and truncation to zero", () => {
      const badExpoBuffer = Buffer.alloc(134);
      badExpoBuffer.writeUInt8(1, 40);
      badExpoBuffer.writeBigInt64LE(100_000_000n, 73);
      badExpoBuffer.writeInt32LE(-15, 89); // exponent < -12
      expect(() => parsePythPriceUpdateV2(badExpoBuffer, 0)).toThrow(/Unsupported Pyth price exponent/);

      const truncateBuffer = Buffer.alloc(134);
      truncateBuffer.writeUInt8(1, 40);
      truncateBuffer.writeBigInt64LE(10n, 73); // tiny price with -8 expo -> 10 / 100 = 0
      truncateBuffer.writeInt32LE(-8, 89);
      expect(() => parsePythPriceUpdateV2(truncateBuffer, 0)).toThrow(/truncated to zero/);
    });

    it("verifies accurate scaling across different positive and negative exponents", () => {
      // Exponent -6: exact quote atom unit ($150.000000 = 150_000_000 raw)
      const bufNeg6 = Buffer.alloc(134);
      bufNeg6.writeUInt8(1, 40);
      bufNeg6.writeBigInt64LE(150_000_000n, 73);
      bufNeg6.writeInt32LE(-6, 89);
      const parsedNeg6 = parsePythPriceUpdateV2(bufNeg6, 0);
      expect(parsedNeg6.normalizedPrice).toBe(150_000_000n);

      // Exponent 0: whole dollar units ($150 = 150 raw -> normalized to 150_000_000)
      const bufZero = Buffer.alloc(134);
      bufZero.writeUInt8(1, 40);
      bufZero.writeBigInt64LE(150n, 73);
      bufZero.writeInt32LE(0, 89);
      const parsedZero = parsePythPriceUpdateV2(bufZero, 0);
      expect(parsedZero.normalizedPrice).toBe(150_000_000n);
    });
  });

  it("builds a deposit instruction and decodes UserVaultAccount binary layout", () => {
    const depositIx = buildDepositInstruction({
      owner: dummyOwner,
      collateralMint: dummyMint,
      amount: 100_000_000n,
    });

    expect(depositIx.keys.length).toBe(7);
    expect(depositIx.data.subarray(0, 8)).toEqual(DEPOSIT_DISCRIMINATOR);
    expect(depositIx.data.readBigUInt64LE(8)).toBe(100_000_000n);

    // Test decodeUserVaultAccount
    const userVaultBuffer = Buffer.alloc(97);
    dummyOwner.toBuffer().copy(userVaultBuffer, 8);
    dummyMint.toBuffer().copy(userVaultBuffer, 40);
    userVaultBuffer.writeBigUInt64LE(50_000_000n, 72); // shares
    userVaultBuffer.writeBigUInt64LE(20_000_000n, 80); // locked_collateral
    userVaultBuffer.writeBigUInt64LE(0n, 88); // settlement_reserved
    userVaultBuffer.writeUInt8(254, 96); // bump

    const decoded = decodeUserVaultAccount(userVaultBuffer);
    expect(decoded.owner.toBase58()).toBe(dummyOwner.toBase58());
    expect(decoded.shares).toBe(50_000_000n);
    expect(decoded.lockedCollateral).toBe(20_000_000n);
    expect(decoded.bump).toBe(254);
  });
});
