import type { MarketState } from "@perps-risk/types";
import type { OracleMetrics } from "@perps-risk/metrics";
import type { RiskComponentResult } from "./types.js";
import {
  scoreFromThresholds,
  scoreToLevel,
  STALE_DATA_SCORE_PENALTY,
  STALE_ORACLE_AGE_MS,
  oracleThresholds,
} from "./config.js";

function isStale(state: MarketState, now: Date): boolean {
  const ageMs = state.metadata.freshness.sourceAgeMs;
  if (ageMs === null || ageMs <= STALE_ORACLE_AGE_MS) return false;
  const staleAfterMs = state.metadata.freshness.staleAfterMs;
  if (staleAfterMs === null) return ageMs > STALE_ORACLE_AGE_MS;
  return ageMs > staleAfterMs;
}

export function calculateOracleRisk(
  state: MarketState,
  metrics: OracleMetrics,
  now: Date = new Date(),
): RiskComponentResult {
  const drivers: string[] = [];
  const scores: number[] = [];

  if (isStale(state, now)) {
    drivers.push("Market data is stale, increasing risk uncertainty");
  }

  const ageTable = oracleThresholds.oracleAgeMs;
  if (metrics.oracleAgeMs !== null && ageTable) {
    const ageScore = scoreFromThresholds(metrics.oracleAgeMs, ageTable);
    if (ageScore !== null) {
      scores.push(ageScore);
      if (ageScore >= 40) {
        const seconds = (metrics.oracleAgeMs / 1000).toFixed(1);
        drivers.push(
          `Oracle price is ${seconds}s old, reducing confidence in price discovery`,
        );
      }
    }
  }

  const devTable = oracleThresholds.markIndexDeviationPercent;
  if (metrics.markIndexDeviationPercent !== null && devTable) {
    const deviationScore = scoreFromThresholds(
      metrics.markIndexDeviationPercent,
      devTable,
    );
    if (deviationScore !== null) {
      scores.push(deviationScore);
      if (deviationScore >= 40) {
        drivers.push(
          `Mark/index price deviation of ${metrics.markIndexDeviationPercent!.toFixed(3)}%`,
        );
      }
    }
  }

  const oracleDevTable = oracleThresholds.oracleDeviationPercent;
  if (metrics.indexOracleDeviationPercent !== null && oracleDevTable) {
    const oracleDevScore = scoreFromThresholds(
      metrics.indexOracleDeviationPercent,
      oracleDevTable,
    );
    if (oracleDevScore !== null) {
      scores.push(oracleDevScore);
      if (oracleDevScore >= 40) {
        drivers.push(
          `Index/oracle deviation of ${metrics.indexOracleDeviationPercent!.toFixed(3)}%`,
        );
      }
    }
  }

  if (metrics.oracleAgeMs === null && metrics.markIndexDeviationPercent === null && metrics.indexOracleDeviationPercent === null) {
    return { score: 0, level: "low", drivers: ["Oracle data not available from this data source"] };
  }

  const rawScore = scores.length > 0
    ? scores.reduce((acc, s) => acc + s, 0) / scores.length
    : 0;

  const penalty = isStale(state, now) ? STALE_DATA_SCORE_PENALTY : 0;
  const score = Math.min(100, Math.round(rawScore + penalty));

  if (drivers.length === 0) {
    drivers.push("Oracle prices are fresh and aligned with mark prices");
  }

  return { score, level: scoreToLevel(score), drivers };
}
