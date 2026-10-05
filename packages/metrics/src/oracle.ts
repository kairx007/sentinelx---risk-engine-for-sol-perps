import type { MarketState } from "@perps-risk/types";
import { isPositive, observationTime } from "./history.js";

export interface OracleMetrics {
  /** Age in milliseconds; future or unavailable timestamps produce null. */
  oracleAgeMs: number | null;
  /** Absolute price difference, in quote units per base unit. */
  markIndexDeviation: number | null;
  /** Absolute deviation as percent of the second/reference price. */
  markIndexDeviationPercent: number | null;
  indexOracleDeviation: number | null;
  indexOracleDeviationPercent: number | null;
  markOracleDeviation: number | null;
  markOracleDeviationPercent: number | null;
}

function deviation(left: number | null, right: number | null) {
  if (!isPositive(left) || !isPositive(right)) return null;
  return Math.abs(left - right);
}

function deviationPercent(left: number | null, right: number | null) {
  const absolute = deviation(left, right);
  if (absolute === null || !isPositive(right)) return null;
  return (absolute / right) * 100;
}

export function calculateOracleMetrics(
  state: MarketState,
  now: Date = new Date(),
): OracleMetrics {
  const oracleTime = observationTime(state, state.oracle.observedAt);
  const age = oracleTime === null ? null : now.getTime() - oracleTime;
  const oracleAgeMs =
    age !== null && age >= 0 && Number.isFinite(age) ? age : null;

  return {
    oracleAgeMs,
    markIndexDeviation: deviation(
      state.price.markPrice,
      state.price.indexPrice,
    ),
    markIndexDeviationPercent: deviationPercent(
      state.price.markPrice,
      state.price.indexPrice,
    ),
    indexOracleDeviation: deviation(state.price.indexPrice, state.oracle.price),
    indexOracleDeviationPercent: deviationPercent(
      state.price.indexPrice,
      state.oracle.price,
    ),
    markOracleDeviation: deviation(state.price.markPrice, state.oracle.price),
    markOracleDeviationPercent: deviationPercent(
      state.price.markPrice,
      state.oracle.price,
    ),
  };
}
