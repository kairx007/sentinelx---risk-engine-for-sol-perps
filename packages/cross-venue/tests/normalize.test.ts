import { describe, expect, it } from "vitest";
import { assetKey } from "../src/normalize.js";
import type { MarketState } from "@perps-risk/types";

function makeState(overrides: Partial<MarketState> = {}): MarketState {
  return {
    market: {
      venue: "velocity",
      symbol: "SOL-PERP",
      marketId: "0",
      baseAsset: "SOL",
      quoteAsset: "USDT",
    },
    price: {
      lastPrice: null,
      indexPrice: 120.0,
      markPrice: 120.0,
      observedAt: "2026-10-05T10:00:00.000Z",
    },
    positioning: {
      longOpenInterest: 100,
      shortOpenInterest: 100,
      totalOpenInterest: 200,
      openInterestUnit: "base",
      observedAt: "2026-10-05T10:00:00.000Z",
    },
    liquidity: {
      bestBidPrice: 119.9,
      bestAskPrice: 120.1,
      bidSize: 10,
      askSize: 10,
      availableLiquidity: null,
      liquidityUnit: null,
      observedAt: "2026-10-05T10:00:00.000Z",
    },
    funding: {
      rate: 0.0001,
      periodSeconds: 3600,
      observedAt: "2026-10-05T10:00:00.000Z",
    },
    liquidation: {
      longVolume: null,
      shortVolume: null,
      totalVolume: null,
      volumeUnit: null,
      intervalSeconds: null,
      observedAt: null,
    },
    oracle: {
      price: 120.0,
      source: null,
      observedAt: "2026-10-05T10:00:00.000Z",
    },
    metadata: {
      source: "test",
      observedAt: "2026-10-05T10:00:00.000Z",
      collectedAt: "2026-10-05T10:00:01.000Z",
      sourceUpdatedAt: "2026-10-05T10:00:00.000Z",
      freshness: {
        sourceAgeMs: 1000,
        staleAfterMs: 30_000,
      },
    },
    ...overrides,
  };
}

describe("assetKey", () => {
  it("uses baseAsset when present", () => {
    const state = makeState({ market: { ...makeState().market, baseAsset: "BTC" } });
    expect(assetKey(state)).toBe("BTC");
  });

  it("falls back to symbol when baseAsset is empty", () => {
    const state = makeState({
      market: { ...makeState().market, baseAsset: "", symbol: "ETH-PERP" },
    });
    expect(assetKey(state)).toBe("ETH");
  });

  it("lowercases the result", () => {
    const state = makeState({ market: { ...makeState().market, baseAsset: "sol" } });
    expect(assetKey(state)).toBe("SOL");
  });
});
