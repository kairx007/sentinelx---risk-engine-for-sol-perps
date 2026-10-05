import type { MarketState } from "@perps-risk/types";

export function sameMarket(left: MarketState, right: MarketState) {
  return (
    left.market.venue === right.market.venue &&
    left.market.symbol === right.market.symbol &&
    left.market.marketId === right.market.marketId
  );
}

export function observationTime(state: MarketState, observedAt: string | null) {
  const value =
    observedAt ?? state.metadata.sourceUpdatedAt ?? state.metadata.observedAt;
  if (value === null) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isNonnegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

export function isPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}
