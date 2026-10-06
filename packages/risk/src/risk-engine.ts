import type { MarketState } from "@perps-risk/types";
import type {
  FundingMetrics,
  LiquidationMetrics,
  LiquidityMetrics,
  OpenInterestMetrics,
  OracleMetrics,
  PositioningMetrics,
  VolatilityMetrics,
} from "@perps-risk/metrics";
import type {
  ComponentWeights,
  MarketRisk,
  RiskComponentResult,
  RiskEngineInput,
  RiskEngineOptions,
} from "./types.js";
import { calculateLeverageRisk } from "./leverage-risk.js";
import { calculatePositioningRisk } from "./positioning-risk.js";
import { calculateLiquidityRisk } from "./liquidity-risk.js";
import { calculateLiquidationRisk } from "./liquidation-risk.js";
import { calculateFundingRisk } from "./funding-risk.js";
import { calculateOracleRisk } from "./oracle-risk.js";
import { calculateVolatilityRisk } from "./volatility-risk.js";
import { weightedAverage, defaultWeights } from "./config.js";

export { type RiskEngineInput, type RiskEngineOptions } from "./types.js";

export function evaluateMarketRisk(
  input: RiskEngineInput,
  options: RiskEngineOptions = {},
): MarketRisk {
  const weights = { ...defaultWeights, ...options.weights };
  const now = options.now ?? new Date();
  const { state } = input;

  const components: Record<string, RiskComponentResult> = {
    leverage: calculateLeverageRisk(state, input.openInterest, now),
    positioning: calculatePositioningRisk(state, input.positioning, now),
    liquidity: calculateLiquidityRisk(state, input.liquidity, now),
    liquidation: calculateLiquidationRisk(
      state,
      input.liquidation,
      input.openInterest,
      now,
    ),
    funding: calculateFundingRisk(state, input.funding, now),
    oracle: calculateOracleRisk(state, input.oracle, now),
    volatility: calculateVolatilityRisk(state, input.volatility, now),
  };

  const scores: Record<string, number | null> = {};
  for (const [name, component] of Object.entries(components)) {
    scores[name] = component.score;
  }

  const overallScore = weightedAverage(scores, weights) ?? 0;
  const level =
    overallScore >= 76
      ? "critical"
      : overallScore >= 51
        ? "high"
        : overallScore >= 26
          ? "medium"
          : "low";

  return {
    overallScore: Math.round(overallScore),
    level,
    components,
    topDrivers: collectTopDrivers(components),
    timestamp: state.metadata.collectedAt,
  };
}

function collectTopDrivers(components: Record<string, RiskComponentResult>): string[] {
  const entries = Object.entries(components);
  const scored: { driver: string; score: number }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const component = entries[i]![1];
    for (let j = 0; j < component.drivers.length; j++) {
      scored.push({ driver: component.drivers[j]!, score: component.score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.driver);
}
