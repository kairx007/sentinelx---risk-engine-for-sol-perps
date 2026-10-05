import type { MarketState } from "@perps-risk/types";
import { isNonnegative } from "./history.js";

export interface PositioningMetrics {
  /** Long OI divided by short OI; null when short OI is zero. */
  longShortRatio: number | null;
  /** Long and short shares of their combined OI, on a 0–100 scale. */
  longPercent: number | null;
  shortPercent: number | null;
  /** (long OI − short OI) / combined OI, on a −1 to 1 scale. */
  imbalance: number | null;
}

export function calculatePositioningMetrics(
  state: MarketState,
): PositioningMetrics {
  const { longOpenInterest: long, shortOpenInterest: short } =
    state.positioning;
  if (!isNonnegative(long) || !isNonnegative(short)) {
    return {
      longShortRatio: null,
      longPercent: null,
      shortPercent: null,
      imbalance: null,
    };
  }
  const total = long + short;
  if (total === 0) {
    return {
      longShortRatio: short === 0 ? null : long / short,
      longPercent: null,
      shortPercent: null,
      imbalance: null,
    };
  }
  return {
    longShortRatio: short === 0 ? null : long / short,
    longPercent: (long / total) * 100,
    shortPercent: (short / total) * 100,
    imbalance: (long - short) / total,
  };
}
