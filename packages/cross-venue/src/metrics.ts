import type { VenueSnapshot } from "./types.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function herfindahl(shares: number[]): number {
  // shares should sum to 1 (or close to it due to rounding)
  return shares.reduce((sum, s) => sum + s ** 2, 0);
}

// ─── Metric extractors ────────────────────────────────────────────────

/** Extracts the comparable price from a venue snapshot. */
function extractPrice(s: VenueSnapshot): number | null {
  return s.metrics.price;
}

/** Converts any per-period funding rate to annualized percent. */
function extractAnnualizedFundingPct(s: VenueSnapshot): number | null {
  const rate = s.metrics.funding;
  const period = s.metrics.fundingPeriod;
  if (rate === null || period === null || period <= 0) return null;
  const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
  return (rate * SECONDS_PER_YEAR / period) * 100; // as percent annualized
}

/** Extracts spread percentage. */
function extractSpread(s: VenueSnapshot): number | null {
  return s.metrics.spread;
}

// ─── Divergence calculations ─────────────────────────────────────────

export interface DivergenceResult {
  value: number | null;
  driver: string;
}

/**
 * Price divergence: coefficient of variation (std dev / mean) as percent.
 */
export function priceDivergence(snapshots: VenueSnapshot[]): DivergenceResult {
  const prices = snapshots.map(extractPrice).filter((v): v is number => v !== null);
  if (prices.length < 2) {
    return { value: null, driver: "Insufficient price data for cross-venue comparison" };
  }
  const m = mean(prices);
  if (m <= 0) return { value: null, driver: "Invalid price reference" };
  const cv = (stdDev(prices) / m) * 100;
  const [minP, maxP] = [Math.min(...prices), Math.max(...prices)];
  const spreadPct = ((maxP - minP) / m) * 100;
  return {
    value: cv,
    driver: `Price divergence: ${spreadPct.toFixed(2)}% spread across venues (${minP.toFixed(2)} – ${maxP.toFixed(2)})`,
  };
}

/**
 * Funding divergence: std dev of annualized percent rates.
 */
export function fundingDivergence(snapshots: VenueSnapshot[]): DivergenceResult {
  const rates = snapshots.map(extractAnnualizedFundingPct).filter((v): v is number => v !== null);
  if (rates.length < 2) {
    return { value: null, driver: "Insufficient funding data for cross-venue comparison" };
  }
  const deviation = stdDev(rates);
  return {
    value: deviation,
    driver: `Funding rate divergence: ${deviation.toFixed(1)}% annualized std dev across venues`,
  };
}

/**
 * OI concentration: Herfindahl index of each venue's share of total OI.
 * 0 = perfectly even, 1 = all OI on one venue.
 */
export function oiConcentration(snapshots: VenueSnapshot[]): DivergenceResult {
  const withOi = snapshots.filter((s) => s.metrics.oi !== null && s.metrics.oi > 0);
  if (withOi.length < 2) {
    return { value: null, driver: "Insufficient OI data for cross-venue comparison" };
  }
  const totalOi = withOi.reduce((sum, s) => sum + (s.metrics.oi ?? 0), 0);
  if (totalOi <= 0) return { value: null, driver: "Zero total open interest" };
  const shares = withOi.map((s) => (s.metrics.oi ?? 0) / totalOi);
  const hhi = herfindahl(shares);
  const topVenue = withOi[0]!;
  const topShare = (shares[0]! * 100).toFixed(1);
  return {
    value: hhi,
    driver: `OI concentration: ${topVenue.venue} holds ${topShare}% of cross-venue open interest`,
  };
}

/**
 * Liquidity spread divergence: range of spread percentages across venues.
 */
export function liquiditySpreadDivergence(
  snapshots: VenueSnapshot[],
): DivergenceResult {
  const spreads = snapshots.map(extractSpread).filter((v): v is number => v !== null);
  if (spreads.length < 2) {
    return { value: null, driver: "Insufficient liquidity data for cross-venue comparison" };
  }
  const min = Math.min(...spreads);
  const max = Math.max(...spreads);
  const range = max - min;
  return {
    value: range,
    driver: `Liquidity spread divergence: ${range.toFixed(4)}% range across venues (${min.toFixed(4)}% – ${max.toFixed(4)}%)`,
  };
}

/**
 * Liquidation concentration: Herfindahl index of liquidation share per venue.
 */
export function liquidationConcentration(
  snapshots: VenueSnapshot[],
): DivergenceResult {
  const withLiq = snapshots.filter(
    (s) => s.metrics.liquidations !== null && s.metrics.liquidations > 0,
  );
  if (withLiq.length < 2) {
    return { value: null, driver: "Insufficient liquidation data for cross-venue comparison" };
  }
  const total = withLiq.reduce((sum, s) => sum + (s.metrics.liquidations ?? 0), 0);
  if (total <= 0) return { value: null, driver: "Zero liquidation volume" };
  const shares = withLiq.map((s) => (s.metrics.liquidations ?? 0) / total);
  const hhi = herfindahl(shares);
  return {
    value: hhi,
    driver: `Liquidation concentration: HHI=${hhi.toFixed(3)} across venues`,
  };
}
