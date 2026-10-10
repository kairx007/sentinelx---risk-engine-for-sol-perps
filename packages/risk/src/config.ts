import type { RiskThresholds, ComponentWeights } from "./types.js";

/** Shared freshness threshold: oracle age in ms before it counts as stale. */
export const STALE_ORACLE_AGE_MS = 30_000;

/** Freshness penalty added to any component score when data is stale. */
export const STALE_DATA_SCORE_PENALTY = 15;

/**
 * Maps a numeric score (0–100) to a risk level.
 * Ranges: 0–25 low, 26–50 medium, 51–75 high, 76–100 critical.
 */
export function scoreToLevel(
  score: number,
): "low" | "medium" | "high" | "critical" {
  if (score >= 76) return "critical";
  if (score >= 51) return "high";
  if (score >= 26) return "medium";
  return "low";
}

/**
 * Interpolates a risk score from a threshold table.
 *
 * Each entry is `{ at: metricValue, score: riskScore }`. The table must
 * contain at least one entry. Values are sorted by `at` ascending.
 *
 * - If `value` is below the first `at`, the first entry's score is returned.
 * - If `value` is above the last `at`, the last entry's score is returned.
 * - Otherwise, linear interpolation between the two bounding entries.
 * - If `value` is `null` (metric unavailable), returns `null`.
 */
export function scoreFromThresholds(
  value: number | null,
  thresholds: readonly { at: number; score: number }[],
): number | null {
  if (value === null || thresholds.length === 0) return null;

  const sorted = [...thresholds].sort((a, b) => a.at - b.at);

  if (value <= sorted[0]!.at) return sorted[0]!.score;
  if (value >= sorted.at(-1)!.at) return sorted.at(-1)!.score;

  for (let i = 0; i < sorted.length - 1; i++) {
    const lower = sorted[i]!;
    const upper = sorted[i + 1]!;
    if (value >= lower.at && value <= upper.at) {
      const ratio = (value - lower.at) / (upper.at - lower.at);
      return lower.score + ratio * (upper.score - lower.score);
    }
  }

  return sorted.at(-1)!.score;
}

/**
 * Averages weighted component scores into an overall 0–100 score.
 * Components with a `null` score are excluded from the average.
 */
export function weightedAverage(
  scores: Record<string, number | null>,
  weights: ComponentWeights,
): number | null {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [name, score] of Object.entries(scores)) {
    if (score === null) continue;
    const weight = weights[name] ?? 1;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;
  return Math.min(100, Math.max(0, weightedSum / totalWeight));
}

/**
 * Picks the top N drivers by score from component results.
 */
export function topDrivers(
  components: Record<string, { score: number | null; drivers: string[] }>,
  limit = 5,
): string[] {
  const entries = Object.entries(components);
  const scored: { driver: string; score: number }[] = [];

  for (const [name, component] of entries) {
    for (const driver of component.drivers) {
      scored.push({ driver, score: component.score ?? 0 });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.driver);
}

// ─── Default thresholds ───────────────────────────────────────────────

export const leverageThresholds: RiskThresholds = {
  totalOi: [
    { at: 0, score: 0 },
    { at: 50_000, score: 15 },
    { at: 500_000, score: 40 },
    { at: 5_000_000, score: 70 },
    { at: 50_000_000, score: 100 },
  ],
  oiVelocity: [
    { at: 0, score: 0 },
    { at: 100, score: 10 },
    { at: 1_000, score: 30 },
    { at: 10_000, score: 60 },
    { at: 100_000, score: 100 },
  ],
};

export const positioningThresholds: RiskThresholds = {
  longShare: [
    { at: 50, score: 0 },
    { at: 65, score: 20 },
    { at: 80, score: 50 },
    { at: 90, score: 80 },
    { at: 100, score: 100 },
  ],
  shortShare: [
    { at: 50, score: 0 },
    { at: 65, score: 20 },
    { at: 80, score: 50 },
    { at: 90, score: 80 },
    { at: 100, score: 100 },
  ],
  imbalance: [
    { at: 0, score: 0 },
    { at: 0.3, score: 20 },
    { at: 0.6, score: 50 },
    { at: 0.8, score: 75 },
    { at: 1.0, score: 100 },
  ],
};

export const liquidityThresholds: RiskThresholds = {
  spreadPercent: [
    { at: 0, score: 0 },
    { at: 0.05, score: 15 },
    { at: 0.2, score: 40 },
    { at: 1.0, score: 70 },
    { at: 5.0, score: 100 },
  ],
  effectiveLiquidity: [
    { at: Infinity, score: 0 },
    { at: 10_000, score: 15 },
    { at: 1_000, score: 40 },
    { at: 100, score: 70 },
    { at: 0, score: 100 },
  ],
  estimatedPriceImpact: [
    { at: 0, score: 0 },
    { at: 0.1, score: 15 },
    { at: 0.5, score: 40 },
    { at: 2.0, score: 70 },
    { at: 5.0, score: 100 },
  ],
};

export const liquidationThresholds: RiskThresholds = {
  liquidationToOi: [
    { at: 0, score: 0 },
    { at: 0.01, score: 15 },
    { at: 0.05, score: 40 },
    { at: 0.15, score: 70 },
    { at: 0.5, score: 100 },
  ],
  longLiquidationShare: [
    { at: 50, score: 0 },
    { at: 70, score: 20 },
    { at: 85, score: 50 },
    { at: 95, score: 80 },
    { at: 100, score: 100 },
  ],
};

export const fundingThresholds: RiskThresholds = {
  fundingRate: [
    { at: -0.01, score: 50 },
    { at: -0.001, score: 20 },
    { at: 0, score: 0 },
    { at: 0.001, score: 20 },
    { at: 0.01, score: 50 },
    { at: 0.05, score: 80 },
    { at: 0.1, score: 100 },
  ],
  fundingChange: [
    { at: 0, score: 0 },
    { at: 0.0005, score: 20 },
    { at: 0.005, score: 50 },
    { at: 0.02, score: 80 },
    { at: 0.05, score: 100 },
  ],
  fundingPercentile: [
    { at: 50, score: 0 },
    { at: 75, score: 25 },
    { at: 90, score: 50 },
    { at: 95, score: 75 },
    { at: 100, score: 100 },
  ],
};

export const oracleThresholds: RiskThresholds = {
  oracleAgeMs: [
    { at: 0, score: 0 },
    { at: 5_000, score: 10 },
    { at: 15_000, score: 30 },
    { at: 30_000, score: 60 },
    { at: 120_000, score: 100 },
  ],
  markIndexDeviationPercent: [
    { at: 0, score: 0 },
    { at: 0.01, score: 10 },
    { at: 0.05, score: 30 },
    { at: 0.2, score: 60 },
    { at: 1.0, score: 100 },
  ],
  oracleDeviationPercent: [
    { at: 0, score: 0 },
    { at: 0.01, score: 10 },
    { at: 0.05, score: 30 },
    { at: 0.2, score: 60 },
    { at: 1.0, score: 100 },
  ],
};

export const volatilityThresholds: RiskThresholds = {
  realizedVolatilityPercent: [
    { at: 0, score: 0 },
    { at: 0.5, score: 15 },
    { at: 2.0, score: 40 },
    { at: 5.0, score: 65 },
    { at: 10.0, score: 90 },
    { at: 20.0, score: 100 },
  ],
  priceChangePercent: [
    { at: 0, score: 0 },
    { at: 0.5, score: 10 },
    { at: 2.0, score: 30 },
    { at: 5.0, score: 60 },
    { at: 10.0, score: 85 },
    { at: 20.0, score: 100 },
  ],
  volatilityChangePercent: [
    { at: 0, score: 0 },
    { at: 25, score: 20 },
    { at: 100, score: 50 },
    { at: 300, score: 80 },
    { at: 1000, score: 100 },
  ],
};

export const defaultWeights: ComponentWeights = {
  leverage: 1.0,
  positioning: 1.0,
  liquidity: 1.0,
  liquidation: 1.0,
  funding: 1.0,
  oracle: 1.0,
  volatility: 1.0,
};
