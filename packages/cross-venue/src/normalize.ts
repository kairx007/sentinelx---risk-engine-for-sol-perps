import type { MarketState } from "@perps-risk/types";

/** Normalizes a `baseAsset` field into a canonical asset key. */
export function assetKey(state: MarketState): string {
  const base = state.market.baseAsset.trim().toUpperCase();
  if (base.length > 0) return base;
  // Fallback: strip known suffixes from symbol.
  return state.market.symbol
    .replace(/[-/]?(PERP|USD[TC]?|USDT|USDC|PERPETUAL)$/i, "")
    .trim()
    .toUpperCase();
}
