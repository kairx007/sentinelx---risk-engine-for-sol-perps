import {
  MarketStateSchema,
  type MarketState,
  type Venue,
} from "@perps-risk/types";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { calculateCurrentPolicy } from "./pipeline.js";
import {
  buildUpdateRiskStateInstruction,
  deriveRiskStateAddress,
  deriveVaultAddress,
} from "./risk-state.js";

function marketState(venue: Venue): MarketState {
  const observedAt = "2026-10-08T00:00:00.000Z";
  return MarketStateSchema.parse({
    market: {
      venue,
      symbol: "SOL-PERP",
      marketId: "1",
      baseAsset: "SOL",
      quoteAsset: "USDC",
    },
    price: { lastPrice: null, indexPrice: 100, markPrice: 100, observedAt },
    positioning: {
      longOpenInterest: 500,
      shortOpenInterest: 500,
      totalOpenInterest: 1_000,
      openInterestUnit: "base",
      observedAt,
    },
    liquidity: {
      bestBidPrice: 99.99,
      bestAskPrice: 100.01,
      bidSize: 100,
      askSize: 100,
      availableLiquidity: null,
      liquidityUnit: "base",
      observedAt,
    },
    funding: { rate: 0, periodSeconds: 28_800, observedAt },
    liquidation: {
      longVolume: 0,
      shortVolume: 0,
      totalVolume: 0,
      volumeUnit: "base",
      intervalSeconds: 60,
      observedAt,
    },
    oracle: { price: 100, source: `${venue}-test-oracle`, observedAt },
    metadata: {
      source: `${venue}-integration-test`,
      observedAt,
      collectedAt: observedAt,
      sourceUpdatedAt: observedAt,
      freshness: { sourceAgeMs: 1_000, staleAfterMs: 15_000 },
    },
  });
}

describe("Velocity/Phoenix policy pipeline", () => {
  it("uses both canonical venue states and emits a policy timestamped from source observations", async () => {
    const result = await calculateCurrentPolicy(
      {
        velocity: { getMarketState: async () => marketState("velocity") },
        phoenix: { getMarketState: async () => marketState("phoenix") },
      },
      "SOL-PERP",
      () => {},
    );
    expect(result.snapshots.map((snapshot) => snapshot.venue).sort()).toEqual([
      "phoenix",
      "velocity",
    ]);
    expect(result.asset).toBe("SOL");
    expect(result.decision.observedAt).toBe(
      Date.parse("2026-10-08T00:00:00.000Z") / 1000,
    );
    expect(result.decision.maxLeverageX100).toBeGreaterThanOrEqual(0);
    const collateralMint = new PublicKey(new Uint8Array(32).fill(9));
    const [vault] = deriveVaultAddress(collateralMint);
    const instruction = buildUpdateRiskStateInstruction(
      vault,
      PublicKey.default,
      {
        ...result.decision,
        nonce: 1n,
      },
    );
    const [expectedRiskState] = deriveRiskStateAddress(vault);
    expect(instruction.keys[2]!.pubkey.equals(expectedRiskState)).toBe(true);
    expect(instruction.data.readUInt8(9)).toBe(result.decision.riskScore);
    expect(instruction.data.readBigInt64LE(13)).toBe(
      BigInt(result.decision.observedAt),
    );
  });

  it("does not publish a permissive policy if either venue collection fails", async () => {
    const events: string[] = [];
    await expect(
      calculateCurrentPolicy(
        {
          velocity: { getMarketState: async () => marketState("velocity") },
          phoenix: {
            getMarketState: async () => {
              throw new Error("provider unavailable");
            },
          },
        },
        "SOL-PERP",
        (event) => events.push(event),
      ),
    ).rejects.toThrow(/partial policy/);
    expect(events).toContain("market_collection_failed");
  });

  it("fails closed when Velocity collection is unavailable", async () => {
    await expect(
      calculateCurrentPolicy(
        {
          velocity: {
            getMarketState: async () => {
              throw new Error("RPC unavailable");
            },
          },
          phoenix: { getMarketState: async () => marketState("phoenix") },
        },
        "SOL-PERP",
        () => {},
      ),
    ).rejects.toThrow(/partial policy/);
  });

  it("rejects canonical states whose venue or market identity does not match the adapter", async () => {
    await expect(
      calculateCurrentPolicy(
        {
          velocity: { getMarketState: async () => marketState("phoenix") },
          phoenix: { getMarketState: async () => marketState("phoenix") },
        },
        "SOL-PERP",
        () => {},
      ),
    ).rejects.toThrow(/canonical market identity/);
  });
});
