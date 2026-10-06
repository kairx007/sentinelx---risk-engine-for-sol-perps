import type { MarketState } from "@perps-risk/types";
import type { LiquidationMetrics, OpenInterestMetrics } from "@perps-risk/metrics";
import type { RiskComponentResult } from "./types.js";
import {
  scoreFromThresholds,
  scoreToLevel,
  STALE_DATA_SCORE_PENALTY,
  STALE_ORACLE_AGE_MS,
  liquidationThresholds,
} from "./config.js";

function isStale(state: MarketState, now: Date): boolean {
  const ageMs = state.metadata.freshness.sourceAgeMs;
  if (ageMs === null || ageMs <= STALE_ORACLE_AGE_MS) return false;
  const staleAfterMs = state.metadata.freshness.staleAfterMs;
  if (staleAfterMs === null) return ageMs > STALE_ORACLE_AGE_MS;
  return ageMs > staleAfterMs;
}

export function calculateLiquidationRisk(
  state: MarketState,
  liquidation: LiquidationMetrics,
  openInterest: OpenInterestMetrics,
  now: Date = new Date(),
): RiskComponentResult {
  const drivers: string[] = [];
  const scores: number[] = [];

  if (isStale(state, now)) {
    drivers.push("Market data is stale, increasing risk uncertainty");
  }

  const liqToOiTable = liquidationThresholds.liquidationToOi;
  if (liquidation.liquidationToOpenInterest !== null && liqToOiTable) {
    const liqToOiScore = scoreFromThresholds(
      liquidation.liquidationToOpenInterest,
      liqToOiTable,
    );
    if (liqToOiScore !== null) {
      scores.push(liqToOiScore);
      if (liqToOiScore >= 50) {
        drivers.push(
          `Liquidation volume represents ${(liquidation.liquidationToOpenInterest! * 100).toFixed(1)}% of open interest`,
        );
      }
    }
  }

  if (liquidation.longVolume !== null && liquidation.shortVolume !== null) {
    const total = liquidation.longVolume + liquidation.shortVolume;
    if (total > 0) {
      const longShare = (liquidation.longVolume / total) * 100;
      const longShareTable = liquidationThresholds.longLiquidationShare;
      if (longShareTable) {
        const longShareScore = scoreFromThresholds(longShare, longShareTable);
        if (longShareScore !== null) {
          scores.push(longShareScore);
          if (longShareScore >= 60) {
            drivers.push(
              `Liquidation concentration on long side (${longShare.toFixed(1)}%)`,
            );
          } else if (longShareScore >= 30) {
            const dominant = longShare > 50 ? "long" : "short";
            drivers.push(
              `${dominant.charAt(0).toUpperCase() + dominant.slice(1)} liquidations dominate (${longShare.toFixed(1)}%)`,
            );
          }
        }
      }
    }
  }

  if (liquidation.totalVolume === null) {
    return { score: 0, level: "low", drivers: ["Liquidation data not available from this data source"] };
  }

  const rawScore = scores.length > 0
    ? scores.reduce((acc, s) => acc + s, 0) / scores.length
    : 0;

  const penalty = isStale(state, now) ? STALE_DATA_SCORE_PENALTY : 0;
  const score = Math.min(100, Math.round(rawScore + penalty));

  if (drivers.length === 0) {
    drivers.push("Liquidation activity is within normal ranges");
  }

  return { score, level: scoreToLevel(score), drivers };
}
