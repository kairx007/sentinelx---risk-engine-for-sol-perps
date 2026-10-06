export {
  evaluateMarketRisk,
  type RiskEngineInput,
  type RiskEngineOptions,
} from "./risk-engine.js";

export { calculateLeverageRisk } from "./leverage-risk.js";
export { calculatePositioningRisk } from "./positioning-risk.js";
export { calculateLiquidityRisk } from "./liquidity-risk.js";
export { calculateLiquidationRisk } from "./liquidation-risk.js";
export { calculateFundingRisk } from "./funding-risk.js";
export { calculateOracleRisk } from "./oracle-risk.js";
export { calculateVolatilityRisk } from "./volatility-risk.js";

export type {
  MarketRisk,
  RiskComponentResult,
  RiskLevel,
  RiskThresholds,
  RiskThreshold,
  ComponentWeights,
} from "./types.js";

export {
  scoreFromThresholds,
  scoreToLevel,
  weightedAverage,
  STALE_ORACLE_AGE_MS,
  STALE_DATA_SCORE_PENALTY,
  defaultWeights,
} from "./config.js";

export {
  leverageThresholds,
  positioningThresholds,
  liquidityThresholds,
  liquidationThresholds,
  fundingThresholds,
  oracleThresholds,
  volatilityThresholds,
} from "./config.js";
