import { BN, PerpMarkets, type OraclePriceData } from "@drift-labs/sdk";
import { PublicKey } from "@solana/web3.js";
import { MarketStateSchema } from "@perps-risk/types";
import driftSnapshotFixture from "../../../../tests/fixtures/drift-market-snapshot.json";
import { DriftAdapter } from "../src/index.js";
import type { DriftMarketSnapshot, DriftReaderFactory } from "../src/index.js";
import { describe, expect, it, vi } from "vitest";

function makeSnapshot(): Omit<DriftMarketSnapshot, "staleAfterMs"> {
  const market = PerpMarkets["mainnet-beta"].find(
    (candidate) => candidate.marketIndex === driftSnapshotFixture.marketIndex,
  );
  if (!market) throw new Error("Drift fixture market is missing from the SDK");

  const oracle: OraclePriceData = {
    price: new BN(driftSnapshotFixture.oraclePriceRaw),
    slot: new BN(driftSnapshotFixture.oracleSlot),
    confidence: new BN(1000),
    hasSufficientNumberOfDataPoints: true,
  };

  return {
    market: {
      ...market,
      symbol: driftSnapshotFixture.marketSymbol,
      baseAssetSymbol: driftSnapshotFixture.baseAssetSymbol,
      oracle: new PublicKey(driftSnapshotFixture.oracleAddress),
    },
    amm: {
      baseAssetAmountLong: new BN(driftSnapshotFixture.longOpenInterestRaw),
      baseAssetAmountShort: new BN(driftSnapshotFixture.shortOpenInterestRaw),
      fundingPeriod: new BN(driftSnapshotFixture.fundingPeriodSeconds),
      lastFundingRate: new BN(driftSnapshotFixture.fundingRateRaw),
      lastFundingRateTs: new BN(
        driftSnapshotFixture.lastFundingRateTimestampSeconds,
      ),
    },
    oracle,
    markPrice: new BN(driftSnapshotFixture.markPriceRaw),
    bidPrice: new BN(driftSnapshotFixture.bidPriceRaw),
    askPrice: new BN(driftSnapshotFixture.askPriceRaw),
    sourceUpdatedAt: new Date(driftSnapshotFixture.sourceUpdatedAt),
    collectedAt: new Date(driftSnapshotFixture.collectedAt),
  };
}

describe("DriftAdapter", () => {
  it("maps an SDK snapshot into a validated canonical MarketState", async () => {
    const snapshot = makeSnapshot();
    const readerFactory: DriftReaderFactory = () => ({
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
      readSnapshot: vi.fn().mockResolvedValue(snapshot),
    });
    const adapter = new DriftAdapter({
      rpcUrl: "https://rpc.example.invalid",
      env: "mainnet-beta",
      readerFactory,
      now: () => new Date(driftSnapshotFixture.collectedAt),
    });

    const state = await adapter.getMarketState("sol");

    expect(MarketStateSchema.safeParse(state).success).toBe(true);
    expect(state.market).toMatchObject({
      venue: "drift",
      symbol: "SOL-PERP",
      marketId: "0",
      baseAsset: "SOL",
      quoteAsset: "USDC",
    });
    expect(state.price).toMatchObject({
      lastPrice: null,
      indexPrice: 152.38,
      markPrice: 152.41,
    });
    expect(state.positioning).toMatchObject({
      longOpenInterest: 125,
      shortOpenInterest: 118,
      totalOpenInterest: 243,
      openInterestUnit: "base",
    });
    expect(state.liquidity).toMatchObject({
      bestBidPrice: 152.4,
      bestAskPrice: 152.43,
      bidSize: null,
      askSize: null,
      availableLiquidity: null,
    });
    expect(state.funding).toMatchObject({
      rate: 0.0001,
      periodSeconds: 3600,
      observedAt: "2026-10-05T10:00:00.000Z",
    });
    expect(state.liquidation.totalVolume).toBeNull();
    expect(state.metadata.freshness.sourceAgeMs).toBe(1000);
  });

  it("always unsubscribes after a snapshot read failure", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const readerFactory: DriftReaderFactory = () => ({
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe,
      readSnapshot: vi.fn().mockRejectedValue(new Error("RPC read failed")),
    });
    const adapter = new DriftAdapter({
      rpcUrl: "https://rpc.example.invalid",
      readerFactory,
    });

    await expect(adapter.getMarketState("SOL-PERP")).rejects.toThrow(
      "RPC read failed",
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects unknown markets before opening an SDK subscription", async () => {
    const readerFactory = vi.fn<DriftReaderFactory>();
    const adapter = new DriftAdapter({
      rpcUrl: "https://rpc.example.invalid",
      readerFactory,
    });

    await expect(adapter.getMarketState("UNKNOWN-PERP")).rejects.toThrow(
      'Drift perp market not found for symbol "UNKNOWN-PERP"',
    );
    expect(readerFactory).not.toHaveBeenCalled();
  });

  it("requires an HTTP(S) RPC URL and a positive freshness threshold", () => {
    expect(
      () => new DriftAdapter({ rpcUrl: "ws://rpc.example.invalid" }),
    ).toThrow("Drift adapter RPC URL must use HTTP or HTTPS");
    expect(
      () =>
        new DriftAdapter({
          rpcUrl: "https://rpc.example.invalid",
          staleAfterMs: 0,
        }),
    ).toThrow("staleAfterMs must be a positive safe integer");
  });
});
