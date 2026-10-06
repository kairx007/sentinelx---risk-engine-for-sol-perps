import type { MarketState } from "@perps-risk/types";
import type { PositioningMetrics } from "@perps-risk/metrics";
import type { RiskComponentResult } from "./types.js";
import {
  scoreFromThresholds,
  scoreToLevel,
  STALE_DATA_SCORE_PENALTY,
  STALE_ORACLE_AGE_MS,
  positioningThresholds,
} from "./config.js";

function isStale(state: MarketState, now: Date): boolean {
  const ageMs = state.metadata.freshness.sourceAgeMs;
  if (ageMs === null || ageMs <= STALE_ORACLE_AGE_MS) return false;
  const staleAfterMs = state.metadata.freshness.staleAfterMs;
  if (staleAfterMs === null) return ageMs > STALE_ORACLE_AGE_MS;
  return ageMs > staleAfterMs;
}

export function calculatePositioningRisk(
  state: MarketState,
  metrics: PositioningMetrics,
  now: Date = new Date(),
): RiskComponentResult {
  const drivers: string[] = [];
  const scores: number[] = [];

  if (isStale(state, now)) {
    drivers.push("Market data is stale, increasing risk uncertainty");
  }

  const dominantShare =
    metrics.longPercent !== null && metrics.shortPercent !== null
      ? Math.max(metrics.longPercent, metrics.shortPercent)
      : null;

  const longShareTable = positioningThresholds.longShare;
  if (dominantShare !== null && longShareTable) {
    const shareScore = scoreFromThresholds(dominantShare, longShareTable);
    if (shareScore !== null) {
      scores.push(shareScore);
      const dominantSide =
        metrics.longPercent! >= metrics.shortPercent! ? "long" : "short";
      if (shareScore >= 60) {
        drivers.push(
          `Crowded ${dominantSide} positioning: ${dominantSide}s control ${dominantShare.toFixed(1)}% of open interest`,
        );
      } else if (shareScore >= 30) {
        drivers.push(
          `${dominantSide.charAt(0).toUpperCase() + dominantSide.slice(1)} bias at ${dominantShare.toFixed(1)}% of open interest`,
        );
      }
    }
  }

  const imbalanceTable = positioningThresholds.imbalance;
  const absImbalance = metrics.imbalance !== null ? Math.abs(metrics.imbalance) : null;
  if (absImbalance !== null && imbalanceTable) {
    const imbalanceScore = scoreFromThresholds(absImbalance, imbalanceTable);
    if (imbalanceScore !== null) {
      scores.push(imbalanceScore);
      if (imbalanceScore >= 60) {
        drivers.push(
          `Severe positioning imbalance (${metrics.imbalance! > 0 ? "long" : "short"}-heavy) increases liquidation cascade risk`,
        );
      }
    }
  }

  if (metrics.longPercent === null && metrics.shortPercent === null) {
    return { score: 0, level: "low", drivers: ["Positioning data (OI skew) not available from this data source"] };
  }

  const rawScore = scores.length > 0
    ? scores.reduce((acc, s) => acc + s, 0) / scores.length
    : 0;

  const penalty = isStale(state, now) ? STALE_DATA_SCORE_PENALTY : 0;
  const score = Math.min(100, Math.round(rawScore + penalty));

  if (drivers.length === 0) {
    drivers.push("Positioning is balanced with no extreme concentration");
  }

  return { score, level: scoreToLevel(score), drivers };
}
