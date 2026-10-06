import type {
  FundingMetrics,
  LiquidationMetrics,
  LiquidityMetrics,
  OpenInterestMetrics,
  OracleMetrics,
  PositioningMetrics,
  VolatilityMetrics,
} from "@perps-risk/metrics";
import type { MarketState } from "@perps-risk/types";

/** Shared types for the risk scoring engine. */

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskComponentResult {
  score: number;
  level: RiskLevel;
  drivers: string[];
}

export interface RiskThreshold {
  /** Metric value at which this threshold applies. */
  at: number;
  /** Risk score contribution for this value. */
  score: number;
}

/** Per-dimension threshold table for scoring interpolation. */
export type RiskThresholds = Record<string, readonly RiskThreshold[]>;

export interface ComponentWeights {
  [component: string]: number;
}

export interface MarketRisk {
  overallScore: number;
  level: RiskLevel;
  components: Record<string, RiskComponentResult>;
  topDrivers: string[];
  timestamp: string;
}

export interface RiskEngineInput {
  state: MarketState;
  openInterest: OpenInterestMetrics;
  positioning: PositioningMetrics;
  liquidity: LiquidityMetrics;
  funding: FundingMetrics;
  liquidation: LiquidationMetrics;
  oracle: OracleMetrics;
  volatility: VolatilityMetrics;
}

export interface RiskEngineOptions {
  weights?: ComponentWeights;
  now?: Date;
}
