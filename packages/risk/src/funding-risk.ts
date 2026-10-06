import type { MarketState } from "@perps-risk/types";
import type { FundingMetrics } from "@perps-risk/metrics";
import type { RiskComponentResult } from "./types.js";
import {
  scoreFromThresholds,
  scoreToLevel,
  STALE_DATA_SCORE_PENALTY,
  STALE_ORACLE_AGE_MS,
  fundingThresholds,
} from "./config.js";

function isStale(state: MarketState, now: Date): boolean {
  const ageMs = state.metadata.freshness.sourceAgeMs;
  if (ageMs === null || ageMs <= STALE_ORACLE_AGE_MS) return false;
  const staleAfterMs = state.metadata.freshness.staleAfterMs;
  if (staleAfterMs === null) return ageMs > STALE_ORACLE_AGE_MS;
  return ageMs > staleAfterMs;
}

export function calculateFundingRisk(
  state: MarketState,
  metrics: FundingMetrics,
  now: Date = new Date(),
): RiskComponentResult {
  const drivers: string[] = [];
  const scores: number[] = [];

  if (isStale(state, now)) {
    drivers.push("Market data is stale, increasing risk uncertainty");
  }

  const rateTable = fundingThresholds.fundingRate;
  const absRate = metrics.currentFunding !== null
    ? Math.abs(metrics.currentFunding)
    : null;
  if (absRate !== null && rateTable) {
    const rateScore = scoreFromThresholds(absRate, rateTable);
    if (rateScore !== null) {
      scores.push(rateScore);
      if (rateScore >= 50) {
        const direction = metrics.currentFunding! >= 0 ? "positive" : "negative";
        drivers.push(
          `Extreme ${direction} funding rate (${(metrics.currentFunding! * 100).toFixed(4)}%)`,
        );
      }
    }
  }

  const changeTable = fundingThresholds.fundingChange;
  const absChange = metrics.change !== null ? Math.abs(metrics.change) : null;
  if (absChange !== null && changeTable) {
    const changeScore = scoreFromThresholds(absChange, changeTable);
    if (changeScore !== null) {
      scores.push(changeScore);
      if (changeScore >= 40) {
        const direction = metrics.change! >= 0 ? "increasing" : "decreasing";
        drivers.push(
          `Funding rate is rapidly ${direction} (${(metrics.change! * 100).toFixed(4)}% change)`,
        );
      }
    }
  }

  const percentileTable = fundingThresholds.fundingPercentile;
  if (metrics.percentile !== null && percentileTable) {
    const percentileScore = scoreFromThresholds(metrics.percentile, percentileTable);
    if (percentileScore !== null) {
      scores.push(percentileScore);
      if (percentileScore >= 70) {
        drivers.push(
          `Current funding rate is in the ${metrics.percentile.toFixed(0)}th historical percentile`,
        );
      }
    }
  }

  if (metrics.currentFunding === null) {
    return { score: 0, level: "low", drivers: ["Funding rate data not available from this data source"] };
  }

  const rawScore = scores.length > 0
    ? scores.reduce((acc, s) => acc + s, 0) / scores.length
    : 0;

  const penalty = isStale(state, now) ? STALE_DATA_SCORE_PENALTY : 0;
  const score = Math.min(100, Math.round(rawScore + penalty));

  if (drivers.length === 0) {
    drivers.push("Funding rate is within normal ranges");
  }

  return { score, level: scoreToLevel(score), drivers };
}
