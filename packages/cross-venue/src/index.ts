import type { CrossVenueRisk, EcosystemRisk, VenueSnapshot } from "./types.js";
import type { MarketState } from "@perps-risk/types";
import type { MarketRisk } from "@perps-risk/risk";
import { evaluateMarketRisk } from "@perps-risk/risk";
import {
  calculatePositioningMetrics,
  calculateLiquidityMetrics,
  calculateFundingMetrics,
  calculateLiquidationMetrics,
  calculateOracleMetrics,
  calculateOpenInterestMetrics,
  calculateVolatilityMetrics,
} from "@perps-risk/metrics";
import { calculateCrossVenueRisk, calculateEcosystemRisk } from "./risk.js";
import { assetKey } from "./normalize.js";
export { assetKey } from "./normalize.js";
export { calculateCrossVenueRisk, calculateEcosystemRisk } from "./risk.js";
export { calculateContagionRisk } from "./contagion.js";
export type {
  CrossVenueRisk,
  EcosystemRisk,
  VenueSnapshot,
  ContagionRisk,
  ContagionStatus,
  ContagionSeverity,
} from "./types.js";

/**
 * Runs the full risk pipeline on a raw `MarketState` and returns a
 * `VenueSnapshot` ready for cross-venue analysis.
 */
export function buildVenueSnapshot(state: MarketState): VenueSnapshot {
  const positioning = calculatePositioningMetrics(state);
  const liquidity = calculateLiquidityMetrics(state);
  const funding = calculateFundingMetrics(state);
  const liquidation = calculateLiquidationMetrics(state);
  const oracle = calculateOracleMetrics(state);
  const openInterest = calculateOpenInterestMetrics(state);
  const volatility = calculateVolatilityMetrics([state], 300);

  const risk: MarketRisk = evaluateMarketRisk({
    state,
    openInterest,
    positioning,
    liquidity,
    funding,
    liquidation,
    oracle,
    volatility,
  });

  // Compute spread from best bid/ask if not already in metrics
  let spread: number | null = liquidity.spreadPercent;
  if (spread === null && state.liquidity.bestBidPrice && state.liquidity.bestAskPrice) {
    const mid = (state.liquidity.bestBidPrice + state.liquidity.bestAskPrice) / 2;
    if (mid > 0) {
      spread = ((state.liquidity.bestAskPrice - state.liquidity.bestBidPrice) / mid) * 100;
    }
  }

  return {
    venue: state.market.venue,
    symbol: state.market.symbol,
    state,
    risk,
    metrics: {
      price: state.price.markPrice,
      oi: state.positioning.totalOpenInterest,
      longOi: state.positioning.longOpenInterest,
      shortOi: state.positioning.shortOpenInterest,
      funding: funding.currentFunding,
      fundingPeriod: state.funding.periodSeconds,
      spread,
      liquidations: liquidation.totalVolume,
    },
  };
}

/**
 * Groups snapshots by asset key and computes cross-venue risk for each.
 *
 * @param snapshots - Raw `MarketState[]` from any combination of adapters.
 * @returns Map of asset → `CrossVenueRisk`
 */
export function analyzeCrossVenue(snapshots: MarketState[]): Map<string, CrossVenueRisk> {
  const groups = new Map<string, VenueSnapshot[]>();

  for (const state of snapshots) {
    const key = assetKey(state);
    const venueSnap = buildVenueSnapshot(state);
    const group = groups.get(key) ?? [];
    group.push(venueSnap);
    groups.set(key, group);
  }

  const results = new Map<string, CrossVenueRisk>();
  for (const [asset, venueSnaps] of groups) {
    results.set(asset, calculateCrossVenueRisk(asset, venueSnaps));
  }
  return results;
}
