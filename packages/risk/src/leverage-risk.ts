import type { MarketState } from "@perps-risk/types";
import type { OpenInterestMetrics } from "@perps-risk/metrics";
import type { RiskComponentResult } from "./types.js";
import {
  scoreFromThresholds,
  scoreToLevel,
  STALE_DATA_SCORE_PENALTY,
  STALE_ORACLE_AGE_MS,
  leverageThresholds,
} from "./config.js";

function isStale(state: MarketState, now: Date): boolean {
  const ageMs = state.metadata.freshness.sourceAgeMs;
  if (ageMs === null || ageMs <= STALE_ORACLE_AGE_MS) return false;
  // If data is actually old (older than staleAfterMs), it's stale
  const staleAfterMs = state.metadata.freshness.staleAfterMs;
  if (staleAfterMs === null) return ageMs > STALE_ORACLE_AGE_MS;
  return ageMs > staleAfterMs;
}

export function calculateLeverageRisk(
  state: MarketState,
  metrics: OpenInterestMetrics,
  now: Date = new Date(),
): RiskComponentResult {
  const drivers: string[] = [];
  const scores: number[] = [];

  if (isStale(state, now)) {
    drivers.push("Market data is stale, increasing risk uncertainty");
  }

  const totalOiTable = leverageThresholds.totalOi;
  if (metrics.totalOpenInterest !== null && totalOiTable) {
    const totalOiScore = scoreFromThresholds(
      metrics.totalOpenInterest,
      totalOiTable,
    );
    if (totalOiScore !== null) {
      scores.push(totalOiScore);
      if (totalOiScore >= 60) {
        drivers.push(
          `Very high open interest (${metrics.totalOpenInterest.toLocaleString()} ${metrics.unit}) indicates elevated leverage exposure`,
        );
      } else if (totalOiScore >= 30) {
        drivers.push(
          `Elevated open interest (${metrics.totalOpenInterest.toLocaleString()} ${metrics.unit}) warrants monitoring`,
        );
      }
    }
  }

  const velocityTable = leverageThresholds.oiVelocity;
  const velocityValue =
    metrics.velocityPerSecond !== null
      ? Math.abs(metrics.velocityPerSecond)
      : null;
  if (velocityValue !== null && velocityTable) {
    const velocityScore = scoreFromThresholds(velocityValue, velocityTable);
    if (velocityScore !== null) {
      scores.push(velocityScore);
      if (velocityScore >= 50) {
        const direction =
          (metrics.velocityPerSecond ?? 0) >= 0 ? "growing" : "shrinking";
        drivers.push(
          `Open interest is rapidly ${direction} (${metrics.velocityPerSecond!.toFixed(1)} ${metrics.unit}/s)`,
        );
      }
    }
  }

  if (
    metrics.totalOpenInterest === null &&
    metrics.velocityPerSecond === null
  ) {
    return {
      score: 0,
      level: "low",
      drivers: ["Open interest data not available from this data source"],
    };
  }

  const rawScore =
    scores.length > 0
      ? scores.reduce((acc, s) => acc + s, 0) / scores.length
      : 0;

  const penalty = isStale(state, now) ? STALE_DATA_SCORE_PENALTY : 0;
  const score = Math.min(100, Math.round(rawScore + penalty));

  if (drivers.length === 0) {
    drivers.push("Open interest levels and velocity are within normal ranges");
  }

  return { score, level: scoreToLevel(score), drivers };
}
