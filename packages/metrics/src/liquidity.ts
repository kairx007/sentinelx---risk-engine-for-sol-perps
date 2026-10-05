import type { MarketState } from "@perps-risk/types";
import { isNonnegative, isPositive } from "./history.js";

export interface PriceImpactRequest {
  side: "buy" | "sell";
  size: number;
  unit: "base" | "quote";
}

export interface LiquidityMetrics {
  /** Ask minus bid, in quote units per base unit. */
  spread: number | null;
  /** Spread divided by midpoint, on a 0–100 percentage scale. */
  spreadPercent: number | null;
  midpoint: number | null;
  /** Displayed top-of-book sizes, in `depthUnit`. */
  bidDepth: number | null;
  askDepth: number | null;
  depthUnit: "base" | "quote" | null;
  /** (bid depth − ask depth) / combined depth, on a −1 to 1 scale. */
  imbalance: number | null;
  /** Conservative two-sided depth: the smaller displayed top-level size. */
  effectiveLiquidity: number | null;
  /** Top-of-book execution price versus midpoint, in percent. */
  estimatedPriceImpactPercent: number | null;
}

export function calculateLiquidityMetrics(
  state: MarketState,
  impactRequest?: PriceImpactRequest,
): LiquidityMetrics {
  const {
    bestBidPrice: bid,
    bestAskPrice: ask,
    bidSize,
    askSize,
    liquidityUnit,
  } = state.liquidity;
  const validBid = isPositive(bid) ? bid : null;
  const validAsk = isPositive(ask) ? ask : null;
  const midpoint =
    validBid !== null && validAsk !== null ? (validBid + validAsk) / 2 : null;
  const spread =
    validBid !== null && validAsk !== null ? validAsk - validBid : null;
  const validBidSize = isNonnegative(bidSize) ? bidSize : null;
  const validAskSize = isNonnegative(askSize) ? askSize : null;
  const sameUnit = liquidityUnit !== null;
  const depthTotal =
    validBidSize !== null && validAskSize !== null
      ? validBidSize + validAskSize
      : null;
  let estimatedPriceImpactPercent: number | null = null;

  if (
    impactRequest &&
    impactRequest.size >= 0 &&
    Number.isFinite(impactRequest.size) &&
    impactRequest.unit === liquidityUnit &&
    midpoint !== null
  ) {
    const touchSize =
      impactRequest.side === "buy" ? validAskSize : validBidSize;
    const touchPrice = impactRequest.side === "buy" ? validAsk : validBid;
    if (
      touchSize !== null &&
      touchPrice !== null &&
      impactRequest.size <= touchSize
    ) {
      estimatedPriceImpactPercent =
        (Math.abs(touchPrice - midpoint) / midpoint) * 100;
    }
  }

  return {
    spread,
    spreadPercent:
      spread !== null && midpoint !== null && midpoint > 0
        ? (spread / midpoint) * 100
        : null,
    midpoint,
    bidDepth: validBidSize,
    askDepth: validAskSize,
    depthUnit: liquidityUnit,
    imbalance:
      sameUnit &&
      validBidSize !== null &&
      validAskSize !== null &&
      depthTotal !== null &&
      depthTotal > 0
        ? (validBidSize - validAskSize) / depthTotal
        : null,
    effectiveLiquidity:
      sameUnit && validBidSize !== null && validAskSize !== null
        ? Math.min(validBidSize, validAskSize)
        : null,
    estimatedPriceImpactPercent,
  };
}
