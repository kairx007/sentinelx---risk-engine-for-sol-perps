import {
  BASE_PRECISION,
  convertToNumber,
  FUNDING_RATE_PRECISION,
  PRICE_PRECISION,
} from "@drift-labs/sdk";
import type { BN } from "@drift-labs/sdk";
import { MarketStateSchema, type MarketState } from "@perps-risk/types";
import type { DriftMarketSnapshot } from "./types.js";

function convertFinite(value: BN | null, precision: BN): number | null {
  if (value === null) return null;
  const converted = convertToNumber(value, precision);
  return Number.isFinite(converted) ? converted : null;
}

function convertPositive(value: BN | null, precision: BN): number | null {
  const converted = convertFinite(value, precision);
  return converted !== null && converted > 0 ? converted : null;
}

function convertNonNegative(value: BN, precision: BN): number | null {
  const converted = convertFinite(value.abs(), precision);
  return converted !== null && converted >= 0 ? converted : null;
}

function toSafeInteger(value: BN): number | null {
  const converted = Number(value.toString());
  return Number.isSafeInteger(converted) ? converted : null;
}

function toIsoTimestamp(unixSeconds: BN): string | null {
  const seconds = toSafeInteger(unixSeconds);
  if (seconds === null || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function freshnessAgeMs(collectedAt: Date, sourceUpdatedAt: Date | null) {
  if (sourceUpdatedAt === null) return null;
  const age = collectedAt.getTime() - sourceUpdatedAt.getTime();
  return Number.isSafeInteger(age) && age >= 0 ? age : null;
}

/** Maps SDK account values into the venue-independent contract. */
export function normalizeDriftMarketSnapshot(
  snapshot: DriftMarketSnapshot,
): MarketState {
  const collectedAt = snapshot.collectedAt.toISOString();
  const sourceUpdatedAt = snapshot.sourceUpdatedAt?.toISOString() ?? null;
  const observedAt = sourceUpdatedAt;
  const longOpenInterest = convertNonNegative(
    snapshot.amm.baseAssetAmountLong,
    BASE_PRECISION,
  );
  const shortOpenInterest = convertNonNegative(
    snapshot.amm.baseAssetAmountShort,
    BASE_PRECISION,
  );
  const totalOpenInterest =
    longOpenInterest === null || shortOpenInterest === null
      ? null
      : longOpenInterest + shortOpenInterest;
  const fundingPeriodSeconds = toSafeInteger(snapshot.amm.fundingPeriod);
  const fundingObservedAt = toIsoTimestamp(snapshot.amm.lastFundingRateTs);

  const state: MarketState = {
    market: {
      venue: "drift",
      symbol: snapshot.market.symbol,
      marketId: String(snapshot.market.marketIndex),
      baseAsset: snapshot.market.baseAssetSymbol,
      // Drift v2 perpetual markets in the SDK are USDC-quoted.
      quoteAsset: "USDC",
    },
    price: {
      // The SDK market account does not expose a last-trade price snapshot.
      lastPrice: null,
      indexPrice: convertPositive(
        snapshot.oracle?.price ?? null,
        PRICE_PRECISION,
      ),
      markPrice: convertPositive(snapshot.markPrice, PRICE_PRECISION),
      observedAt,
    },
    positioning: {
      longOpenInterest,
      shortOpenInterest,
      totalOpenInterest,
      openInterestUnit: "base",
      observedAt,
    },
    liquidity: {
      bestBidPrice: convertPositive(snapshot.bidPrice, PRICE_PRECISION),
      bestAskPrice: convertPositive(snapshot.askPrice, PRICE_PRECISION),
      // The AMM pricing helpers do not provide executable size/depth.
      bidSize: null,
      askSize: null,
      availableLiquidity: null,
      liquidityUnit: null,
      observedAt,
    },
    funding: {
      rate: convertFinite(snapshot.amm.lastFundingRate, FUNDING_RATE_PRECISION),
      periodSeconds:
        fundingPeriodSeconds !== null && fundingPeriodSeconds > 0
          ? fundingPeriodSeconds
          : null,
      observedAt: fundingObservedAt,
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
      price: convertPositive(snapshot.oracle?.price ?? null, PRICE_PRECISION),
      source: snapshot.market.oracle.toBase58(),
      observedAt,
    },
    metadata: {
      source: "drift-typescript-sdk",
      observedAt,
      collectedAt,
      sourceUpdatedAt,
      freshness: {
        sourceAgeMs: freshnessAgeMs(
          snapshot.collectedAt,
          snapshot.sourceUpdatedAt,
        ),
        staleAfterMs: snapshot.staleAfterMs,
      },
    },
  };

  return MarketStateSchema.parse(state);
}
