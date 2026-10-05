import { MarketStateSchema, type MarketState } from "@perps-risk/types";
import type { JupiterMarketSnapshot } from "./types.js";

function parsePositive(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeJupiterMarketSnapshot(
  snapshot: JupiterMarketSnapshot,
): MarketState {
  const state: MarketState = {
    market: {
      venue: "jupiter",
      symbol: `${snapshot.symbol}-PERP`,
      marketId: snapshot.mint,
      baseAsset: snapshot.symbol,
      quoteAsset: "USD",
    },
    price: {
      lastPrice: parsePositive(snapshot.stats.price),
      indexPrice: null,
      markPrice: null,
      observedAt: null,
    },
    positioning: {
      longOpenInterest: null,
      shortOpenInterest: null,
      totalOpenInterest: null,
      openInterestUnit: null,
      observedAt: null,
    },
    liquidity: {
      bestBidPrice: null,
      bestAskPrice: null,
      bidSize: null,
      askSize: null,
      availableLiquidity: null,
      liquidityUnit: null,
      observedAt: null,
    },
    funding: { rate: null, periodSeconds: null, observedAt: null },
    liquidation: {
      longVolume: null,
      shortVolume: null,
      totalVolume: null,
      volumeUnit: null,
      intervalSeconds: null,
      observedAt: null,
    },
    oracle: { price: null, source: null, observedAt: null },
    metadata: {
      source: "Jupiter Perps market-stats API",
      observedAt: null,
      collectedAt: snapshot.collectedAt.toISOString(),
      sourceUpdatedAt: null,
      freshness: { sourceAgeMs: null, staleAfterMs: snapshot.staleAfterMs },
    },
  };
  return MarketStateSchema.parse(state);
}
