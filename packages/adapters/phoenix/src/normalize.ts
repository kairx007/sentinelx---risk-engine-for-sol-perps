import { MarketStateSchema, type MarketState } from "@perps-risk/types";
import type { PhoenixMarketSnapshot } from "./types.js";

function positive(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function nonnegative(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

function timestamp(value: number | bigint) {
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function baseAsset(symbol: string) {
  return symbol.replace(/[-/]?(PERP|USD[TC]?)$/i, "").toUpperCase();
}

function openInterestBase(snapshot: PhoenixMarketSnapshot) {
  const rawLots = snapshot.market.statsSnapshot?.openInterestBaseLots;
  const decimals = snapshot.market.baseLotsDecimals;
  if (
    rawLots === undefined ||
    !Number.isSafeInteger(decimals) ||
    decimals < 0
  ) {
    return null;
  }
  try {
    const value = Number(BigInt(rawLots)) / 10 ** decimals;
    return nonnegative(value);
  } catch {
    return null;
  }
}

export function normalizePhoenixMarketSnapshot(
  snapshot: PhoenixMarketSnapshot,
): MarketState {
  const observedAt = timestamp(snapshot.stats.timestamp_ms);
  const totalOpenInterest = openInterestBase(snapshot);
  const bids = snapshot.orderbook.bids;
  const asks = snapshot.orderbook.asks;
  const bestBid = bids[0];
  const bestAsk = asks[0];
  const state: MarketState = {
    market: {
      venue: "phoenix",
      symbol: snapshot.market.symbol,
      marketId: String(snapshot.market.assetId),
      baseAsset: baseAsset(snapshot.market.symbol),
      // Phoenix perp markets settle in the exchange's canonical USDC quote asset.
      quoteAsset: "USDC",
    },
    price: {
      lastPrice: null,
      indexPrice: positive(snapshot.stats.oracle_price),
      markPrice: positive(snapshot.stats.mark_price),
      observedAt,
    },
    positioning: {
      longOpenInterest: null,
      shortOpenInterest: null,
      totalOpenInterest,
      openInterestUnit: totalOpenInterest === null ? null : "base",
      observedAt,
    },
    liquidity: {
      bestBidPrice: positive(bestBid?.[0]),
      bestAskPrice: positive(bestAsk?.[0]),
      bidSize: nonnegative(bestBid?.[1]),
      askSize: nonnegative(bestAsk?.[1]),
      availableLiquidity: null,
      liquidityUnit: "base",
      observedAt,
    },
    funding: {
      rate: Number.isFinite(snapshot.stats.current_funding_rate)
        ? snapshot.stats.current_funding_rate
        : null,
      periodSeconds:
        Number.isSafeInteger(snapshot.market.fundingPeriodSeconds) &&
        snapshot.market.fundingPeriodSeconds > 0
          ? snapshot.market.fundingPeriodSeconds
          : null,
      observedAt,
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
      price: positive(snapshot.stats.oracle_price),
      source: "Phoenix market stats oracle_price",
      observedAt,
    },
    metadata: {
      source: "Phoenix Rise HTTP API",
      observedAt,
      collectedAt: snapshot.collectedAt.toISOString(),
      sourceUpdatedAt: observedAt,
      freshness: {
        sourceAgeMs:
          observedAt === null
            ? null
            : Math.max(
                0,
                snapshot.collectedAt.getTime() - Date.parse(observedAt),
              ),
        staleAfterMs: snapshot.staleAfterMs,
      },
    },
  };
  return MarketStateSchema.parse(state);
}
