import type { MarketState } from "@perps-risk/types";
import { isNonnegative } from "./history.js";

export interface LiquidationMetrics {
  /** Volume values use `volumeUnit` over `intervalSeconds`. */
  totalVolume: number | null;
  longVolume: number | null;
  shortVolume: number | null;
  volumeUnit: MarketState["liquidation"]["volumeUnit"];
  intervalSeconds: number | null;
  /** Fraction of current OI liquidated during the stated interval. */
  liquidationToOpenInterest: number | null;
}

export function calculateLiquidationMetrics(
  state: MarketState,
): LiquidationMetrics {
  const { totalVolume, longVolume, shortVolume, volumeUnit, intervalSeconds } =
    state.liquidation;
  const total = isNonnegative(totalVolume)
    ? totalVolume
    : isNonnegative(longVolume) && isNonnegative(shortVolume)
      ? longVolume + shortVolume
      : null;
  const openInterest = state.positioning.totalOpenInterest;
  const unitsMatch =
    volumeUnit !== null && volumeUnit === state.positioning.openInterestUnit;

  return {
    totalVolume: total,
    longVolume: isNonnegative(longVolume) ? longVolume : null,
    shortVolume: isNonnegative(shortVolume) ? shortVolume : null,
    volumeUnit,
    intervalSeconds,
    liquidationToOpenInterest:
      total !== null &&
      isNonnegative(openInterest) &&
      openInterest > 0 &&
      unitsMatch
        ? total / openInterest
        : null,
  };
}
