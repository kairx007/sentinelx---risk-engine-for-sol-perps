import type { MarketState, Venue } from "@perps-risk/types";
import type { MarketRisk, RiskLevel } from "@perps-risk/risk";

/** Identifies a venue in a cross-venue snapshot. */
export interface VenueSnapshot {
  venue: Venue;
  symbol: string;
  state: MarketState;
  risk: MarketRisk | null;
  /** Key metrics extracted for comparison. */
  metrics: {
    price: number | null;
    oi: number | null;
    longOi: number | null;
    shortOi: number | null;
    funding: number | null;
    fundingPeriod: number | null; // seconds
    spread: number | null; // percent
    liquidations: number | null;
  };
}

export interface DivergenceMetric {
  /** Raw observed value (e.g. price coefficient of variation in percent). */
  value: number | null;
  /** Normalized risk score (0–100) via threshold interpolation. */
  score: number | null;
  /** Configured weight used in the weighted-average aggregation. */
  weight: number;
  /**
   * This metric's contribution to the final ecosystem score.
   * Computed as (score × weight) / totalApplicableWeight.
   * Null when the score is unavailable.
   */
  contribution: number | null;
  /** Human-readable description of the divergence observation. */
  driver: string;
}

export interface CrossVenueDivergence {
  /** Coefficient of variation (std dev / mean) of prices, as percent. */
  price: DivergenceMetric | null;
  /** Std dev of funding rates across venues. */
  funding: DivergenceMetric | null;
  /** Herfindahl index of OI share (0 = even, 1 = single venue). */
  oiConcentration: DivergenceMetric | null;
  /** Spread range (max - min) across venues, in percent. */
  liquiditySpread: DivergenceMetric | null;
  /** Herfindahl index of liquidation share. */
  liquidationConcentration: DivergenceMetric | null;
}

export interface CrossVenueRisk {
  /** Normalized asset key (e.g. "SOL"). */
  asset: string;
  timestamp: string;
  /** Number of venues contributing data. */
  venueCount: number;
  ecosystemScore: number | null;
  ecosystemLevel: RiskLevel | null;
  venueSnapshots: VenueSnapshot[];
  divergence: CrossVenueDivergence;
  riskDrivers: string[];
}

export type ContagionStatus = "NONE" | "ISOLATED" | "DEVELOPING" | "ACTIVE";
export type ContagionSeverity = "low" | "medium" | "high" | "critical";

export interface ContagionRisk {
  status: ContagionStatus;
  severity: ContagionSeverity;
  affectedVenues: import("@perps-risk/types").Venue[];
  drivers: string[];
  timestamp: string;
}

/** Public ecosystem-level alias for the cross-venue result. */
export type EcosystemRisk = CrossVenueRisk;
