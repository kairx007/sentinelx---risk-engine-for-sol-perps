import type { RiskThresholds } from "@perps-risk/risk";

/**
 * Threshold tables for cross-venue divergence metrics.
 *
 * Each table maps a metric value to a risk score contribution.
 * Higher divergence = higher risk.
 */

/** Price coefficient of variation (%) → score. */
export const priceDivergenceThresholds: RiskThresholds = {
  priceDivergence: [
    { at: 0, score: 0 },
    { at: 0.1, score: 5 },
    { at: 0.5, score: 20 },
    { at: 1.0, score: 40 },
    { at: 2.0, score: 65 },
    { at: 5.0, score: 90 },
    { at: 10.0, score: 100 },
  ],
};

/** Std dev of annualized funding rates (%) → score. */
export const fundingDivergenceThresholds: RiskThresholds = {
  fundingDivergence: [
    { at: 0, score: 0 },
    { at: 1, score: 10 },
    { at: 5, score: 30 },
    { at: 20, score: 55 },
    { at: 50, score: 80 },
    { at: 100, score: 100 },
  ],
};

/** OI Herfindahl index → score (0 = even, 1 = concentrated). */
export const oiConcentrationThresholds: RiskThresholds = {
  oiConcentration: [
    { at: 0, score: 0 },
    { at: 0.4, score: 20 },
    { at: 0.6, score: 50 },
    { at: 0.8, score: 75 },
    { at: 0.9, score: 90 },
    { at: 1.0, score: 100 },
  ],
};

/** Spread range across venues (max - min, %) → score. */
export const liquidityDivergenceThresholds: RiskThresholds = {
  liquidityDivergence: [
    { at: 0, score: 0 },
    { at: 0.01, score: 10 },
    { at: 0.05, score: 30 },
    { at: 0.1, score: 50 },
    { at: 0.5, score: 75 },
    { at: 1.0, score: 100 },
  ],
};

/** Component weights for cross-venue score. */
export const crossVenueWeights = {
  price: 1.0,
  funding: 1.0,
  oiConcentration: 1.2,
  liquiditySpread: 0.8,
  liquidationConcentration: 1.0,
};
