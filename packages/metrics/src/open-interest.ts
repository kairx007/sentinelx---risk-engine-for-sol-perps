import type { MarketState } from "@perps-risk/types";
import { isNonnegative, observationTime, sameMarket } from "./history.js";

export interface OpenInterestMetrics {
  /** Latest total in the unit declared by `unit`. */
  totalOpenInterest: number | null;
  unit: MarketState["positioning"]["openInterestUnit"];
  /** Absolute change in `unit` since the prior valid observation. */
  change: number | null;
  /** Percent change relative to the prior observation. */
  changePercent: number | null;
  /** Change in `unit` per elapsed second. */
  velocityPerSecond: number | null;
  elapsedSeconds: number | null;
}

export function calculateOpenInterestMetrics(
  current: MarketState,
  history: readonly MarketState[] = [],
): OpenInterestMetrics {
  const currentValue = current.positioning.totalOpenInterest;
  const unit = current.positioning.openInterestUnit;
  const currentTime = observationTime(current, current.positioning.observedAt);
  const base = {
    totalOpenInterest: isNonnegative(currentValue) ? currentValue : null,
    unit,
    change: null,
    changePercent: null,
    velocityPerSecond: null,
    elapsedSeconds: null,
  } satisfies OpenInterestMetrics;
  if (!isNonnegative(currentValue) || unit === null || currentTime === null)
    return base;

  const previous = history
    .filter((state) => sameMarket(state, current))
    .map((state) => ({
      value: state.positioning.totalOpenInterest,
      unit: state.positioning.openInterestUnit,
      time: observationTime(state, state.positioning.observedAt),
    }))
    .filter(
      (entry) =>
        entry.time !== null &&
        entry.time < currentTime &&
        isNonnegative(entry.value) &&
        entry.unit === unit,
    )
    .sort((left, right) => (right.time ?? 0) - (left.time ?? 0))[0];

  if (!previous || previous.time === null || !isNonnegative(previous.value))
    return base;
  const elapsedSeconds = (currentTime - previous.time) / 1000;
  if (elapsedSeconds <= 0) return base;
  const change = currentValue - previous.value;
  return {
    ...base,
    change,
    changePercent:
      previous.value === 0 ? null : (change / previous.value) * 100,
    velocityPerSecond: change / elapsedSeconds,
    elapsedSeconds,
  };
}
