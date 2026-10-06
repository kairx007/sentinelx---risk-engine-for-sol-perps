import {
  BASE_PRECISION,
  convertToNumber,
  FUNDING_RATE_PRECISION,
  PRICE_PRECISION,
} from "@velocity-exchange/sdk";
import type { BN } from "@velocity-exchange/sdk";
import { MarketStateSchema, type MarketState } from "@perps-risk/types";
import type { VelocityMarketSnapshot } from "./types.js";

function numberOrNull(value: BN | null, precision: BN, positive = false) {
  if (value === null) return null;
  const result = convertToNumber(value, precision);
  if (!Number.isFinite(result) || (positive && result <= 0)) return null;
  return result;
}

function safeInteger(value: BN) {
  const result = Number(value.toString());
  return Number.isSafeInteger(result) ? result : null;
}

function isoTimestamp(seconds: BN) {
  const value = safeInteger(seconds);
  if (value === null || value <= 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeVelocityMarketSnapshot(
  snapshot: VelocityMarketSnapshot,
): MarketState {
  const collectedAt = snapshot.collectedAt.toISOString();
  const sourceUpdatedAt = snapshot.sourceUpdatedAt?.toISOString() ?? null;
  const longOpenInterest = numberOrNull(
    snapshot.marketAccount.baseAssetAmountLong.abs(),
    BASE_PRECISION,
  );
  const shortOpenInterest = numberOrNull(
    snapshot.marketAccount.baseAssetAmountShort.abs(),
    BASE_PRECISION,
  );
  const state: MarketState = {
    market: {
      venue: "velocity",
      symbol: snapshot.market.symbol,
      marketId: String(snapshot.market.marketIndex),
      baseAsset: snapshot.market.baseAssetSymbol,
      // Velocity mainnet uses USDT; devnet uses its dUSDT placeholder.
      quoteAsset: snapshot.quoteAsset,
    },
    price: {
      // This contract shares one timestamp across all price fields. Keep the
      // last fill null rather than pairing its trade time with oracle time.
      lastPrice: null,
      indexPrice: numberOrNull(
        snapshot.oracle?.price ?? null,
        PRICE_PRECISION,
        true,
      ),
      markPrice: numberOrNull(snapshot.markPrice, PRICE_PRECISION, true),
      observedAt: sourceUpdatedAt,
    },
    positioning: {
      longOpenInterest,
      shortOpenInterest,
      totalOpenInterest:
        longOpenInterest === null || shortOpenInterest === null
          ? null
          : longOpenInterest + shortOpenInterest,
      openInterestUnit: "base",
      observedAt: sourceUpdatedAt,
    },
    liquidity: {
      bestBidPrice: numberOrNull(snapshot.bidPrice, PRICE_PRECISION, true),
      bestAskPrice: numberOrNull(snapshot.askPrice, PRICE_PRECISION, true),
      bidSize: null,
      askSize: null,
      availableLiquidity: null,
      liquidityUnit: null,
      observedAt: sourceUpdatedAt,
    },
    funding: {
      rate: (() => {
        const rawRate = numberOrNull(
          snapshot.marketAccount.lastFundingRate,
          FUNDING_RATE_PRECISION,
        );
        // lastFundingRate is quote-per-base (USDT per SOL/BTC/etc), not a
        // percentage.  Divide by the mark price to get a true rate.
        if (rawRate === null || rawRate === 0) return null;
        const mark = numberOrNull(snapshot.markPrice, PRICE_PRECISION);
        if (mark === null || mark <= 0) return null;
        return rawRate / mark;
      })(),
      periodSeconds: (() => {
        const period = safeInteger(
          snapshot.marketAccount.marketStats.fundingPeriod,
        );
        return period !== null && period > 0 ? period : null;
      })(),
      observedAt: isoTimestamp(snapshot.marketAccount.lastFundingRateTs),
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
      price: numberOrNull(
        snapshot.oracle?.price ?? null,
        PRICE_PRECISION,
        true,
      ),
      source: snapshot.market.oracle.toBase58(),
      observedAt: sourceUpdatedAt,
    },
    metadata: {
      source: "velocity-typescript-sdk",
      observedAt: sourceUpdatedAt,
      collectedAt,
      sourceUpdatedAt,
      freshness: {
        sourceAgeMs:
          sourceUpdatedAt === null
            ? null
            : Math.max(
                0,
                snapshot.collectedAt.getTime() -
                  new Date(sourceUpdatedAt).getTime(),
              ),
        staleAfterMs: snapshot.staleAfterMs,
      },
    },
  };
  return MarketStateSchema.parse(state);
}
