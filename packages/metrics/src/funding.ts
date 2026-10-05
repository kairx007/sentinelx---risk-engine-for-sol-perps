import type { MarketState } from "@perps-risk/types";
import { observationTime, sameMarket } from "./history.js";

export interface FundingMetrics {
  /** Signed decimal rate fraction for `periodSeconds`. */
  currentFunding: number | null;
  periodSeconds: number | null;
  /** Absolute rate-fraction change since the prior compatible observation. */
  change: number | null;
  /** Empirical percentile among supplied compatible historical rates, 0–100. */
  percentile: number | null;
}

export function calculateFundingMetrics(
  current: MarketState,
  history: readonly MarketState[] = [],
): FundingMetrics {
  const rate = current.funding.rate;
  const periodSeconds = current.funding.periodSeconds;
  const currentTime = observationTime(current, current.funding.observedAt);
  const validRate = rate !== null && Number.isFinite(rate) ? rate : null;
  const compatible = history
    .filter((state) => sameMarket(state, current))
    .filter(
      (state) =>
        periodSeconds !== null &&
        state.funding.periodSeconds === periodSeconds &&
        state.funding.rate !== null &&
        Number.isFinite(state.funding.rate) &&
        observationTime(state, state.funding.observedAt) !== null &&
        (currentTime === null ||
          (observationTime(state, state.funding.observedAt) ?? Infinity) <
            currentTime),
    )
    .sort(
      (left, right) =>
        (observationTime(right, right.funding.observedAt) ?? 0) -
        (observationTime(left, left.funding.observedAt) ?? 0),
    );
  const previousRate = compatible[0]?.funding.rate ?? null;
  const historicalRates = compatible.map(
    (state) => state.funding.rate as number,
  );

  return {
    currentFunding: validRate,
    periodSeconds,
    change:
      validRate !== null && previousRate !== null
        ? validRate - previousRate
        : null,
    percentile:
      validRate !== null && historicalRates.length > 0
        ? (historicalRates.filter(
            (historicalRate) => historicalRate <= validRate,
          ).length /
            historicalRates.length) *
          100
        : null,
  };
}
