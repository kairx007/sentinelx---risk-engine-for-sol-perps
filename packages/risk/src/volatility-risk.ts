import type { MarketState } from "@perps-risk/types";
import type { VolatilityMetrics } from "@perps-risk/metrics";
import type { RiskComponentResult } from "./types.js";
import {
  scoreFromThresholds,
  scoreToLevel,
  STALE_DATA_SCORE_PENALTY,
  STALE_ORACLE_AGE_MS,
  volatilityThresholds,
} from "./config.js";

function isStale(state: MarketState, now: Date): boolean {
  const ageMs = state.metadata.freshness.sourceAgeMs;
  if (ageMs === null || ageMs <= STALE_ORACLE_AGE_MS) return false;
  const staleAfterMs = state.metadata.freshness.staleAfterMs;
  if (staleAfterMs === null) return ageMs > STALE_ORACLE_AGE_MS;
  return ageMs > staleAfterMs;
}

export function calculateVolatilityRisk(
  state: MarketState,
  metrics: VolatilityMetrics,
  now: Date = new Date(),
): RiskComponentResult {
  const drivers: string[] = [];
  const scores: number[] = [];

  if (isStale(state, now)) {
    drivers.push("Market data is stale, increasing risk uncertainty");
  }

  const volTable = volatilityThresholds.realizedVolatilityPercent;
  if (metrics.realizedVolatilityPercent !== null && volTable) {
    const volScore = scoreFromThresholds(
      metrics.realizedVolatilityPercent,
      volTable,
    );
    if (volScore !== null) {
      scores.push(volScore);
      if (volScore >= 50) {
        drivers.push(
          `High realized volatility (${metrics.realizedVolatilityPercent!.toFixed(2)}% over ${metrics.windowSeconds}s window)`,
        );
      }
    }
  }

  const priceChangeTable = volatilityThresholds.priceChangePercent;
  if (metrics.priceChangePercent !== null && priceChangeTable) {
    const priceScore = scoreFromThresholds(
      metrics.priceChangePercent,
      priceChangeTable,
    );
    if (priceScore !== null) {
      scores.push(priceScore);
      if (priceScore >= 40) {
        const direction = metrics.priceChangePercent! >= 0 ? "up" : "down";
        drivers.push(
          `Sharp price movement ${direction} (${Math.abs(metrics.priceChangePercent!).toFixed(2)}% in window)`,
        );
      }
    }
  }

  const volChangeTable = volatilityThresholds.volatilityChangePercent;
  if (metrics.volatilityChangePercent !== null && volChangeTable) {
    const volChangeScore = scoreFromThresholds(
      metrics.volatilityChangePercent,
      volChangeTable,
    );
    if (volChangeScore !== null) {
      scores.push(volChangeScore);
      if (volChangeScore >= 50) {
        const sign = metrics.volatilityChangePercent! >= 0 ? "" : "and fell ";
        drivers.push(
          `Volatility spiked ${sign}${Math.abs(metrics.volatilityChangePercent!).toFixed(0)}% vs prior window`,
        );
      }
    }
  }

  if (
    metrics.realizedVolatilityPercent === null &&
    metrics.priceChangePercent === null
  ) {
    return {
      score: 0,
      level: "low",
      drivers: ["Volatility data not available from this data source"],
    };
  }

  const rawScore =
    scores.length > 0
      ? scores.reduce((acc, s) => acc + s, 0) / scores.length
      : 0;

  const penalty = isStale(state, now) ? STALE_DATA_SCORE_PENALTY : 0;
  const score = Math.min(100, Math.round(rawScore + penalty));

  if (drivers.length === 0) {
    drivers.push("Volatility is within normal ranges");
  }

  return { score, level: scoreToLevel(score), drivers };
}
