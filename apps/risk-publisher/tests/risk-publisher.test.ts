import { createHash } from "node:crypto";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { RiskPolicyDecision } from "@perps-risk/cross-venue";
import { describe, expect, it } from "vitest";
import { publishRiskPolicy, type RiskStateChain } from "../src/publisher.js";
import {
  buildUpdateRiskStateInstruction,
  decodeRiskState,
  deriveRiskStateAddress,
  deriveVaultAddress,
  encodeUpdateRiskState,
  RISK_VAULT_PROGRAM_ID,
  type RiskStateCommand,
} from "../src/risk-state.js";

const VAULT_DISCRIMINATOR = Buffer.from([211, 8, 232, 43, 2, 152, 117, 119]);
const RISK_STATE_DISCRIMINATOR = Buffer.from([
  120, 33, 58, 236, 210, 191, 106, 97,
]);
const riskAuthority = new PublicKey(new Uint8Array(32).fill(7));

const decision: RiskPolicyDecision = {
  riskLevel: "high",
  riskScore: 60,
  contagionState: "DEVELOPING",
  maxLeverageX100: 100,
  observedAt: 1_800_000_000,
};

function makeVaultData(): Buffer {
  const collateralMint = new PublicKey(new Uint8Array(32).fill(8));
  const [vault, bump] = deriveVaultAddress(collateralMint);
  const data = Buffer.alloc(121);
  VAULT_DISCRIMINATOR.copy(data);
  riskAuthority.toBuffer().copy(data, 40);
  collateralMint.toBuffer().copy(data, 72);
  data.writeUInt8(bump, 120);
  return data;
}

function makeRiskStateData(overrides: Partial<RiskStateCommand> = {}): Buffer {
  const command: RiskStateCommand = {
    riskLevel: "low",
    riskScore: 10,
    contagionState: "NONE",
    maxLeverageX100: 300,
    observedAt: 1_799_999_000,
    nonce: 4n,
    ...overrides,
  };
  const data = Buffer.alloc(38);
  RISK_STATE_DISCRIMINATOR.copy(data);
  data.writeUInt8(
    { low: 0, medium: 1, high: 2, critical: 3 }[command.riskLevel],
    8,
  );
  data.writeUInt8(command.riskScore, 9);
  data.writeUInt8(
    { NONE: 0, ISOLATED: 1, DEVELOPING: 2, ACTIVE: 3 }[command.contagionState],
    10,
  );
  data.writeUInt16LE(command.maxLeverageX100, 11);
  data.writeBigInt64LE(BigInt(command.observedAt), 13);
  data.writeBigInt64LE(1_799_999_000n, 21);
  data.writeBigUInt64LE(command.nonce, 29);
  data.writeUInt8(255, 37);
  return data;
}

function makeChain(vaultData: Buffer, initialRiskState: Buffer) {
  const collateralMint = new PublicKey(vaultData.subarray(72, 104));
  const [vault] = deriveVaultAddress(collateralMint);
  const [riskState, riskStateBump] = deriveRiskStateAddress(vault);
  let riskStateData = initialRiskState;
  riskStateData.writeUInt8(riskStateBump, 37);
  let submitted: TransactionInstruction | null = null;
  const chain: RiskStateChain = {
    async getAccount(address) {
      if (address.equals(vault))
        return { owner: RISK_VAULT_PROGRAM_ID, data: vaultData };
      if (address.equals(riskState))
        return { owner: RISK_VAULT_PROGRAM_ID, data: riskStateData };
      return null;
    },
    async submitAndConfirm(instruction) {
      submitted = instruction;
      const bytes = instruction.data;
      const riskLevel = (["low", "medium", "high", "critical"] as const)[
        bytes.readUInt8(8)
      ]!;
      const contagionState = (
        ["NONE", "ISOLATED", "DEVELOPING", "ACTIVE"] as const
      )[bytes.readUInt8(10)]!;
      riskStateData = makeRiskStateData({
        riskLevel,
        riskScore: bytes.readUInt8(9),
        contagionState,
        maxLeverageX100: bytes.readUInt16LE(11),
        observedAt: Number(bytes.readBigInt64LE(13)),
        nonce: bytes.readBigUInt64LE(21),
      });
      riskStateData.writeUInt8(riskStateBump, 37);
      return "confirmed-signature";
    },
  };
  return {
    chain,
    vault,
    getSubmitted: () => submitted,
    getRiskStateData: () => riskStateData,
  };
}

describe("RiskState publisher boundary", () => {
  it("serializes the current Anchor instruction args and account metas", () => {
    const collateralMint = new PublicKey(new Uint8Array(32).fill(8));
    const [vault] = deriveVaultAddress(collateralMint);
    const instruction = buildUpdateRiskStateInstruction(vault, riskAuthority, {
      ...decision,
      nonce: 5n,
    });
    expect([...instruction.data.subarray(0, 8)]).toEqual([
      71, 227, 24, 202, 12, 22, 17, 96,
    ]);
    expect([...instruction.data.subarray(0, 8)]).toEqual([
      ...createHash("sha256")
        .update("global:update_risk_state")
        .digest()
        .subarray(0, 8),
    ]);
    expect(instruction.data.length).toBe(29);
    expect(instruction.data.readUInt8(8)).toBe(2);
    expect(instruction.data.readUInt8(10)).toBe(2);
    expect(instruction.data.readUInt16LE(11)).toBe(100);
    expect(instruction.data.readBigInt64LE(13)).toBe(
      BigInt(decision.observedAt),
    );
    expect(instruction.data.readBigUInt64LE(21)).toBe(5n);
    expect(instruction.keys).toHaveLength(4);
    expect(instruction.keys[0]!.isSigner).toBe(true);
    expect(instruction.keys[2]!.isWritable).toBe(true);
  });

  it("reads the chain nonce, submits exactly nonce plus one, and verifies confirmed state", async () => {
    const mock = makeChain(makeVaultData(), makeRiskStateData());
    const result = await publishRiskPolicy(
      mock.chain,
      mock.vault,
      riskAuthority,
      decision,
    );
    expect(result).toEqual({
      status: "published",
      nonce: 5n,
      signature: "confirmed-signature",
    });
    expect(decodeRiskState(mock.getRiskStateData())).toMatchObject({
      riskLevel: "high",
      riskScore: 60,
      contagionState: "DEVELOPING",
      maxLeverageX100: 100,
      observedAt: decision.observedAt,
      nonce: 5n,
    });
    expect(mock.getSubmitted()?.data.readBigUInt64LE(21)).toBe(5n);
  });

  it("rejects the wrong authority and older observations without submitting", async () => {
    const mock = makeChain(makeVaultData(), makeRiskStateData());
    await expect(
      publishRiskPolicy(mock.chain, mock.vault, PublicKey.default, decision),
    ).rejects.toThrow(/risk_authority/);
    await expect(
      publishRiskPolicy(mock.chain, mock.vault, riskAuthority, {
        ...decision,
        observedAt: 1_799_998_999,
      }),
    ).rejects.toThrow(/older than the on-chain observation/);
    expect(mock.getSubmitted()).toBeNull();
  });

  it("does not resubmit an already-current policy and rejects malformed account data", async () => {
    const current = makeRiskStateData({
      ...decision,
      nonce: 5n,
    });
    const mock = makeChain(makeVaultData(), current);
    expect(
      await publishRiskPolicy(mock.chain, mock.vault, riskAuthority, decision),
    ).toEqual({ status: "already-current", nonce: 5n });
    expect(mock.getSubmitted()).toBeNull();
    expect(() => decodeRiskState(Buffer.alloc(38))).toThrow(/discriminator/);
  });

  it("reports a concurrent nonce winner only when the exact policy was applied", async () => {
    const mock = makeChain(makeVaultData(), makeRiskStateData());
    const submit = mock.chain.submitAndConfirm.bind(mock.chain);
    mock.chain.submitAndConfirm = async (instruction) => {
      await submit(instruction);
      throw new Error("confirmation response was lost");
    };
    expect(
      await publishRiskPolicy(mock.chain, mock.vault, riskAuthority, decision),
    ).toEqual({ status: "already-current", nonce: 5n });
  });
});
