import type { MarketState } from "@perps-risk/types";
import type { LiquidityMetrics } from "@perps-risk/metrics";
import type { RiskComponentResult } from "./types.js";
import {
  scoreFromThresholds,
  scoreToLevel,
  STALE_DATA_SCORE_PENALTY,
  STALE_ORACLE_AGE_MS,
  liquidityThresholds,
} from "./config.js";

function isStale(state: MarketState, now: Date): boolean {
  const ageMs = state.metadata.freshness.sourceAgeMs;
  if (ageMs === null || ageMs <= STALE_ORACLE_AGE_MS) return false;
  const staleAfterMs = state.metadata.freshness.staleAfterMs;
  if (staleAfterMs === null) return ageMs > STALE_ORACLE_AGE_MS;
  return ageMs > staleAfterMs;
}

export function calculateLiquidityRisk(
  state: MarketState,
  metrics: LiquidityMetrics,
  now: Date = new Date(),
): RiskComponentResult {
  const drivers: string[] = [];
  const scores: number[] = [];

  if (isStale(state, now)) {
    drivers.push("Market data is stale, increasing risk uncertainty");
  }

  const spreadTable = liquidityThresholds.spreadPercent;
  if (metrics.spreadPercent !== null && spreadTable) {
    const spreadScore = scoreFromThresholds(metrics.spreadPercent, spreadTable);
    if (spreadScore !== null) {
      scores.push(spreadScore);
      if (spreadScore >= 50) {
        drivers.push(
          `Widening spread at ${metrics.spreadPercent.toFixed(3)}% signals deteriorating liquidity`,
        );
      }
    }
  }

  const effectiveTable = liquidityThresholds.effectiveLiquidity;
  if (metrics.effectiveLiquidity !== null && effectiveTable) {
    const effectiveScore = scoreFromThresholds(
      metrics.effectiveLiquidity,
      effectiveTable,
    );
    if (effectiveScore !== null) {
      scores.push(effectiveScore);
      if (effectiveScore >= 50) {
        drivers.push(
          `Low effective liquidity (${metrics.effectiveLiquidity.toLocaleString()} ${metrics.depthUnit}) constrains order execution`,
        );
      }
    }
  }

  const impactTable = liquidityThresholds.estimatedPriceImpact;
  if (metrics.estimatedPriceImpactPercent !== null && impactTable) {
    const impactScore = scoreFromThresholds(
      metrics.estimatedPriceImpactPercent,
      impactTable,
    );
    if (impactScore !== null) {
      scores.push(impactScore);
      if (impactScore >= 50) {
        drivers.push(
          `Estimated price impact of ${metrics.estimatedPriceImpactPercent.toFixed(3)}% indicates slippage risk`,
        );
      }
    }
  }

  if (metrics.spreadPercent === null && metrics.effectiveLiquidity === null && metrics.estimatedPriceImpactPercent === null) {
    return { score: 0, level: "low", drivers: ["Orderbook liquidity data not available from this data source"] };
  }

  const rawScore = scores.length > 0
    ? scores.reduce((acc, s) => acc + s, 0) / scores.length
    : 0;

  const penalty = isStale(state, now) ? STALE_DATA_SCORE_PENALTY : 0;
  const score = Math.min(100, Math.round(rawScore + penalty));

  if (drivers.length === 0) {
    drivers.push("Liquidity conditions are healthy with tight spreads and adequate depth");
  }

  return { score, level: scoreToLevel(score), drivers };
}
