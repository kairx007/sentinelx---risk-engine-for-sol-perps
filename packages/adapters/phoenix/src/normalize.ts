import { MarketStateSchema, type MarketState } from "@perps-risk/types";
import type { PhoenixMarketSnapshot } from "./types.js";

function positive(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Phoenix returned a nonpositive or non-finite price");
  }
  return value;
}

function nonnegative(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Phoenix returned a negative or non-finite quantity");
  }
  return value;
}

function timestamp(value: number | bigint) {
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new Error("Phoenix returned an invalid market observation timestamp");
  }
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
    if (rawLots === undefined) return null;
    throw new Error("Phoenix returned invalid open-interest lot precision");
  }
  let lots: bigint;
  try {
    lots = BigInt(rawLots);
  } catch {
    throw new Error("Phoenix returned malformed open-interest lots");
  }
  if (lots < 0n) throw new Error("Phoenix returned negative open interest");
  const value = Number(lots) / 10 ** decimals;
  if (!Number.isFinite(value))
    throw new Error(
      "Phoenix open interest is outside the supported numeric range",
    );
  return value;
}

export function normalizePhoenixMarketSnapshot(
  snapshot: PhoenixMarketSnapshot,
): MarketState {
  if (
    snapshot.stats.symbol.trim().toUpperCase() !==
      snapshot.market.symbol.trim().toUpperCase() ||
    snapshot.orderbook.symbol.trim().toUpperCase() !==
      snapshot.market.symbol.trim().toUpperCase()
  ) {
    throw new Error(
      "Phoenix market, stats, and orderbook identities do not match",
    );
  }
  if (
    !Number.isSafeInteger(snapshot.market.assetId) ||
    snapshot.market.assetId < 0
  ) {
    throw new Error("Phoenix returned an invalid market identifier");
  }
  if (
    !Number.isSafeInteger(snapshot.market.fundingPeriodSeconds) ||
    snapshot.market.fundingPeriodSeconds <= 0
  ) {
    throw new Error("Phoenix returned an invalid funding period");
  }
  const observedAt = timestamp(snapshot.stats.timestamp_ms);
  const canonicalSymbol = `${baseAsset(snapshot.market.symbol)}-PERP`;
  const totalOpenInterest = openInterestBase(snapshot);
  const bids = snapshot.orderbook.bids;
  const asks = snapshot.orderbook.asks;
  const bestBid = bids[0];
  const bestAsk = asks[0];
  const state: MarketState = {
    market: {
      venue: "phoenix",
      symbol: canonicalSymbol,
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
      rate: (() => {
        if (!Number.isFinite(snapshot.stats.current_funding_rate)) {
          throw new Error("Phoenix returned a non-finite funding rate");
        }
        return snapshot.stats.current_funding_rate;
      })(),
      periodSeconds: snapshot.market.fundingPeriodSeconds,
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
