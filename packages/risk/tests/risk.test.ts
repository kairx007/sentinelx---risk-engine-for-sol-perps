import driftFixture from "../../../tests/fixtures/market-state-drift.json";
import {
  calculateFundingMetrics,
  calculateLiquidationMetrics,
  calculateLiquidityMetrics,
  calculateOpenInterestMetrics,
  calculateOracleMetrics,
  calculatePositioningMetrics,
  calculateVolatilityMetrics,
  type FundingMetrics,
  type LiquidationMetrics,
  type LiquidityMetrics,
  type OpenInterestMetrics,
  type OracleMetrics,
  type PositioningMetrics,
  type VolatilityMetrics,
} from "@perps-risk/metrics";
import type { MarketState } from "@perps-risk/types";
import { describe, expect, it } from "vitest";
import {
  calculateLeverageRisk,
  calculateLiquidationRisk,
  calculateLiquidityRisk,
  calculateFundingRisk,
  calculateOracleRisk,
  calculatePositioningRisk,
  calculateVolatilityRisk,
  evaluateMarketRisk,
  scoreFromThresholds,
  scoreToLevel,
  weightedAverage,
  STALE_ORACLE_AGE_MS,
} from "@perps-risk/risk";

const fixture = driftFixture as MarketState;

const NOW = "2026-10-05T10:00:00Z";

function at(time: string, overrides: Partial<MarketState> = {}): MarketState {
  const state = structuredClone(fixture);
  state.price.observedAt = time;
  state.positioning.observedAt = time;
  state.funding.observedAt = time;
  state.liquidation.observedAt = time;
  state.oracle.observedAt = time;
  state.metadata.observedAt = time;
  state.metadata.sourceUpdatedAt = time;
  state.metadata.freshness.sourceAgeMs = 1_000;
  state.metadata.freshness.staleAfterMs = 30_000;
  return { ...state, ...overrides };
}

// ─── scoreFromThresholds ──────────────────────────────────────────────

describe("scoreFromThresholds", () => {
  it("returns the first score for values below the lowest threshold", () => {
    expect(scoreFromThresholds(0, [{ at: 10, score: 50 }])).toBe(50);
  });

  it("returns the last score for values above the highest threshold", () => {
    expect(scoreFromThresholds(100, [{ at: 10, score: 50 }])).toBe(50);
  });

  it("interpolates linearly between thresholds", () => {
    const table = [
      { at: 0, score: 0 },
      { at: 100, score: 100 },
    ];
    expect(scoreFromThresholds(50, table)).toBe(50);
    expect(scoreFromThresholds(25, table)).toBe(25);
  });

  it("handles descending at values by sorting", () => {
    const table = [
      { at: 100, score: 0 },
      { at: 0, score: 100 },
    ];
    expect(scoreFromThresholds(50, table)).toBe(50);
  });

  it("returns null for null value", () => {
    expect(scoreFromThresholds(null, [{ at: 0, score: 50 }])).toBeNull();
  });

  it("returns null for empty thresholds", () => {
    expect(scoreFromThresholds(50, [])).toBeNull();
  });
});

// ─── scoreToLevel ────────────────────────────────────────────────────

describe("scoreToLevel", () => {
  it("maps 0–25 to low", () => {
    expect(scoreToLevel(0)).toBe("low");
    expect(scoreToLevel(25)).toBe("low");
  });

  it("maps 26–50 to medium", () => {
    expect(scoreToLevel(26)).toBe("medium");
    expect(scoreToLevel(50)).toBe("medium");
  });

  it("maps 51–75 to high", () => {
    expect(scoreToLevel(51)).toBe("high");
    expect(scoreToLevel(75)).toBe("high");
  });

  it("maps 76–100 to critical", () => {
    expect(scoreToLevel(76)).toBe("critical");
    expect(scoreToLevel(100)).toBe("critical");
  });
});

// ─── weightedAverage ──────────────��──────────────────────────────────

describe("weightedAverage", () => {
  it("computes weighted average of non-null scores", () => {
    expect(weightedAverage({ a: 20, b: 80 }, { a: 1, b: 1 })).toBe(50);
  });

  it("ignores null scores", () => {
    expect(weightedAverage({ a: 20, b: null }, { a: 1, b: 1 })).toBe(20);
  });

  it("returns null when all scores are null", () => {
    expect(weightedAverage({ a: null, b: null }, { a: 1, b: 1 })).toBeNull();
  });

  it("applies weights correctly", () => {
    expect(weightedAverage({ a: 100, b: 0 }, { a: 3, b: 1 })).toBe(75);
  });

  it("clamps result to 0–100", () => {
    expect(weightedAverage({ a: 150, b: -50 }, { a: 1, b: 1 })).toBe(50);
  });
});

// ─── Leverage Risk ───────────────────────────────────────────────────

describe("leverage risk", () => {
  it("returns low score for normal OI levels", () => {
    const state = at(NOW);
    const history = [at("2026-10-05T09:55:00Z")];
    const metrics = calculateOpenInterestMetrics(state, history);
    const result = calculateLeverageRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeLessThan(30);
    expect(result.level).toBe("low");
    expect(result.drivers.length).toBeGreaterThan(0);
  });

  it("returns high score for very high OI", () => {
    const state = at(NOW);
    state.positioning.totalOpenInterest = 10_000_000;
    const metrics = calculateOpenInterestMetrics(state, []);
    const result = calculateLeverageRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.level).toBe("high");
  });

  it("returns high score for fast OI growth", () => {
    const past = at("2026-10-05T09:59:50Z");
    past.positioning.totalOpenInterest = 100_000;
    const current = at("2026-10-05T10:00:00Z");
    current.positioning.totalOpenInterest = 500_000;
    const metrics = calculateOpenInterestMetrics(current, [past]);
    const result = calculateLeverageRisk(current, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThan(30);
    expect(result.drivers.some((d) => d.includes("rapidly"))).toBe(true);
  });

  it("penalizes stale data", () => {
    const state = at(NOW);
    state.metadata.freshness.sourceAgeMs = STALE_ORACLE_AGE_MS + 1000;
    state.metadata.freshness.staleAfterMs = 30_000;
    const metrics = calculateOpenInterestMetrics(state, []);
    const result = calculateLeverageRisk(state, metrics, new Date(NOW));
    expect(result.drivers.some((d) => d.includes("stale"))).toBe(true);
  });

  it("handles null OI gracefully", () => {
    const state = at(NOW);
    state.positioning.totalOpenInterest = null;
    const metrics = calculateOpenInterestMetrics(state, []);
    const result = calculateLeverageRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThan(100);
  });
});

// ─── Positioning Risk ────────────────────────────────────────────────

describe("positioning risk", () => {
  it("returns low score for balanced positioning", () => {
    const state = at(NOW);
    state.positioning.longOpenInterest = 50;
    state.positioning.shortOpenInterest = 50;
    const metrics = calculatePositioningMetrics(state);
    const result = calculatePositioningRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeLessThan(30);
    expect(result.level).toBe("low");
  });

  it("returns high score for extreme long skew", () => {
    const state = at(NOW);
    state.positioning.longOpenInterest = 95;
    state.positioning.shortOpenInterest = 5;
    const metrics = calculatePositioningMetrics(state);
    const result = calculatePositioningRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.drivers.some((d) => d.includes("Crowded long"))).toBe(true);
  });

  it("returns high score for extreme short skew", () => {
    const state = at(NOW);
    state.positioning.longOpenInterest = 5;
    state.positioning.shortOpenInterest = 95;
    const metrics = calculatePositioningMetrics(state);
    const result = calculatePositioningRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.drivers.some((d) => d.includes("Crowded short"))).toBe(true);
  });

  it("detects severe imbalance", () => {
    const state = at(NOW);
    state.positioning.longOpenInterest = 90;
    state.positioning.shortOpenInterest = 10;
    const metrics = calculatePositioningMetrics(state);
    const result = calculatePositioningRisk(state, metrics, new Date(NOW));
    expect(result.drivers.some((d) => d.includes("imbalance"))).toBe(true);
  });
});

// ─── Liquidity Risk ──────────────────────────────────────────────────

describe("liquidity risk", () => {
  it("returns low score for tight spreads and deep liquidity", () => {
    const state = at(NOW);
    const metrics = calculateLiquidityMetrics(state);
    const result = calculateLiquidityRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeLessThan(30);
  });

  it("returns high score for wide spreads", () => {
    const state = at(NOW);
    state.liquidity.bestBidPrice = 150;
    state.liquidity.bestAskPrice = 155;
    const metrics = calculateLiquidityMetrics(state);
    const result = calculateLiquidityRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThan(30);
    expect(result.drivers.some((d) => d.includes("Widening spread"))).toBe(true);
  });

  it("returns high score for low effective liquidity", () => {
    const state = at(NOW);
    state.liquidity.bidSize = 10;
    state.liquidity.askSize = 5;
    const metrics = calculateLiquidityMetrics(state);
    const result = calculateLiquidityRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThan(30);
    expect(result.drivers.some((d) => d.includes("Low effective liquidity"))).toBe(
      true,
    );
  });

  it("flags slippage risk when price impact is within depth", () => {
    const state = at(NOW);
    const metrics = calculateLiquidityMetrics(state, {
      side: "buy",
      size: 5000,
      unit: "base",
    });
    const result = calculateLiquidityRisk(state, metrics, new Date(NOW));
    expect(metrics.estimatedPriceImpactPercent).not.toBeNull();
    expect(result.score).toBeGreaterThan(0);
  });
});

// ─── Liquidation Risk ────────────────────────────────────────────────

describe("liquidation risk", () => {
  it("returns low score when no liquidations", () => {
    const state = at(NOW);
    state.liquidation.totalVolume = null;
    state.liquidation.longVolume = null;
    state.liquidation.shortVolume = null;
    const liqMetrics = calculateLiquidationMetrics(state);
    const oiMetrics = calculateOpenInterestMetrics(state, []);
    const result = calculateLiquidationRisk(state, liqMetrics, oiMetrics, new Date(NOW));
    expect(result.score).toBeLessThan(30);
  });

  it("returns high score for high liquidation/OI ratio", () => {
    const state = at(NOW);
    state.liquidation.longVolume = 500;
    state.liquidation.shortVolume = 300;
    state.liquidation.totalVolume = null;
    state.liquidation.volumeUnit = "base";
    state.positioning.totalOpenInterest = 1000;
    state.positioning.openInterestUnit = "base";
    const liqMetrics = calculateLiquidationMetrics(state);
    const oiMetrics = calculateOpenInterestMetrics(state, []);
    const result = calculateLiquidationRisk(state, liqMetrics, oiMetrics, new Date(NOW));
    expect(result.score).toBeGreaterThan(30);
    expect(result.drivers.some((d) => d.includes("% of open interest"))).toBe(true);
  });

  it("detects liquidation concentration", () => {
    const state = at(NOW);
    state.liquidation.longVolume = 900;
    state.liquidation.shortVolume = 100;
    state.liquidation.totalVolume = null;
    state.liquidation.volumeUnit = "base";
    state.positioning.totalOpenInterest = 2000;
    state.positioning.openInterestUnit = "base";
    const liqMetrics = calculateLiquidationMetrics(state);
    const oiMetrics = calculateOpenInterestMetrics(state, []);
    const result = calculateLiquidationRisk(state, liqMetrics, oiMetrics, new Date(NOW));
    expect(result.drivers.some((d) => d.includes("concentration"))).toBe(true);
  });
});

// ─── Funding Risk ────────────────────────────────────────────────────

describe("funding risk", () => {
  it("returns low score for normal funding", () => {
    const old1 = at("2026-10-05T08:00:00Z");
    old1.funding.rate = 0.0001;
    const old2 = at("2026-10-05T09:00:00Z");
    old2.funding.rate = 0.0003;
    const current = at("2026-10-05T10:00:00Z");
    current.funding.rate = 0.0002;
    const metrics = calculateFundingMetrics(current, [old1, old2]);
    const result = calculateFundingRisk(current, metrics, new Date(NOW));
    expect(result.score).toBeLessThan(30);
  });

  it("returns high score for extreme positive funding", () => {
    const state = at(NOW);
    state.funding.rate = 0.05;
    const metrics = calculateFundingMetrics(state, []);
    const result = calculateFundingRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThan(30);
    expect(result.drivers.some((d) => d.includes("Extreme"))).toBe(true);
  });

  it("returns high score for extreme negative funding", () => {
    const state = at(NOW);
    state.funding.rate = -0.05;
    const metrics = calculateFundingMetrics(state, []);
    const result = calculateFundingRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThan(30);
    expect(result.drivers.some((d) => d.includes("Extreme"))).toBe(true);
  });

  it("flags rapid funding changes", () => {
    const old = at("2026-10-05T09:00:00Z");
    old.funding.rate = 0.0001;
    const current = at("2026-10-05T10:00:00Z");
    current.funding.rate = 0.02;
    const metrics = calculateFundingMetrics(current, [old]);
    const result = calculateFundingRisk(current, metrics, new Date(NOW));
    expect(result.drivers.some((d) => d.includes("rapidly"))).toBe(true);
  });
});

// ─── Oracle Risk ─────────────────────────────────────────────────────

describe("oracle risk", () => {
  it("returns low score for fresh aligned prices", () => {
    const state = at(NOW);
    state.price.markPrice = 152.41;
    state.price.indexPrice = 152.38;
    state.oracle.price = 152.39;
    const now = new Date(NOW);
    const metrics = calculateOracleMetrics(state, now);
    const result = calculateOracleRisk(state, metrics, now);
    expect(result.score).toBeLessThan(30);
  });

  it("returns high score for stale oracle", () => {
    const state = at(NOW);
    state.oracle.observedAt = "2026-10-05T09:59:00Z";
    state.metadata.freshness.sourceAgeMs = 1000;
    const metrics = calculateOracleMetrics(state);
    const result = calculateOracleRisk(state, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThan(30);
    expect(result.drivers.some((d) => d.includes("old"))).toBe(true);
  });

  it("flags large mark/index deviation", () => {
    const state = at(NOW);
    state.price.markPrice = 160;
    state.price.indexPrice = 150;
    const metrics = calculateOracleMetrics(state);
    const result = calculateOracleRisk(state, metrics, new Date(NOW));
    expect(result.drivers.some((d) => d.includes("deviation"))).toBe(true);
  });
});

// ─── Volatility Risk ─────────────────────────────────────────────────

describe("volatility risk", () => {
  it("returns low score for stable prices", () => {
    const states = [
      at("2026-10-05T09:58:00Z"),
      at("2026-10-05T09:59:00Z"),
      at(NOW),
    ];
    states.forEach((s) => (s.price.markPrice = 152.4));
    const metrics = calculateVolatilityMetrics(states, 120);
    const result = calculateVolatilityRisk(states.at(-1)!, metrics, new Date(NOW));
    expect(result.score).toBeLessThan(20);
  });

  it("returns high score for volatile prices", () => {
    const states = [
      at("2026-10-05T09:55:00Z"),
      at("2026-10-05T09:56:00Z"),
      at("2026-10-05T09:57:00Z"),
      at("2026-10-05T09:58:00Z"),
      at("2026-10-05T09:59:00Z"),
      at(NOW),
    ];
    const prices = [100, 105, 95, 110, 90, 115];
    prices.forEach((price, i) => {
      states[i]!.price.markPrice = price;
    });
    const metrics = calculateVolatilityMetrics(states, 300);
    const result = calculateVolatilityRisk(states.at(-1)!, metrics, new Date(NOW));
    expect(result.score).toBeGreaterThan(30);
    expect(result.drivers.some((d) => d.includes("High realized volatility"))).toBe(
      true,
    );
  });

  it("flags sharp price movements", () => {
    const states = [
      at("2026-10-05T09:58:00Z"),
      at("2026-10-05T09:59:00Z"),
      at(NOW),
    ];
    states[0]!.price.markPrice = 100;
    states[1]!.price.markPrice = 105;
    states[2]!.price.markPrice = 120;
    const metrics = calculateVolatilityMetrics(states, 120);
    const result = calculateVolatilityRisk(states.at(-1)!, metrics, new Date(NOW));
    expect(result.drivers.some((d) => d.includes("Sharp price movement"))).toBe(true);
  });
});

// ─── Risk Engine ─────────────────────────────────────────────────────

function buildMetrics(state: MarketState, history: MarketState[] = []) {
  return {
    openInterest: calculateOpenInterestMetrics(state, history),
    positioning: calculatePositioningMetrics(state),
    liquidity: calculateLiquidityMetrics(state),
    funding: calculateFundingMetrics(state, history),
    liquidation: calculateLiquidationMetrics(state),
    oracle: calculateOracleMetrics(state, new Date(NOW)),
    volatility: calculateVolatilityMetrics(history.length > 0 ? history : [state], 120),
  };
}

describe("risk engine", () => {
  it("produces a MarketRisk with all seven components", () => {
    const state = at(NOW);
    const metrics = buildMetrics(state);
    const result = evaluateMarketRisk({ state, ...metrics });
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.level).toBe(scoreToLevel(result.overallScore));
    expect(Object.keys(result.components)).toHaveLength(7);
    expect(result.topDrivers.length).toBeLessThanOrEqual(5);
    expect(result.timestamp).toBe(state.metadata.collectedAt);
  });

  it("returns low risk for a calm market", () => {
    const state = at(NOW);
    state.positioning.longOpenInterest = 50;
    state.positioning.shortOpenInterest = 50;
    state.liquidity.bestBidPrice = 152.4;
    state.liquidity.bestAskPrice = 152.43;
    const metrics = buildMetrics(state);
    const result = evaluateMarketRisk({ state, ...metrics });
    expect(result.overallScore).toBeLessThan(40);
    expect(result.level).toBe("low");
  });

  it("returns elevated risk when one component is stressed", () => {
    const state = at(NOW);
    state.positioning.longOpenInterest = 999;
    state.positioning.shortOpenInterest = 1;
    const metrics = buildMetrics(state);
    const result = evaluateMarketRisk({ state, ...metrics });
    // positioning component is stressed (score >= 50)
    expect(result.components["positioning"]!.score).toBeGreaterThanOrEqual(50);
    expect(result.topDrivers.length).toBeGreaterThan(0);
  });

  it("returns high/critical risk for multiple stressed components", () => {
    const state = at(NOW);
    state.positioning.longOpenInterest = 999;
    state.positioning.shortOpenInterest = 1;
    state.liquidity.bestBidPrice = 145;
    state.liquidity.bestAskPrice = 160;
    state.liquidity.bidSize = 10;
    state.liquidity.askSize = 5;
    state.funding.rate = 0.05;
    const metrics = buildMetrics(state);
    const result = evaluateMarketRisk({ state, ...metrics });
    // Multiple components are stressed, overall is elevated
    expect(result.overallScore).toBeGreaterThan(20);
    expect(result.topDrivers.length).toBeGreaterThan(0);
  });

  it("limits topDrivers to 5 entries", () => {
    const state = at(NOW);
    state.positioning.longOpenInterest = 95;
    state.positioning.shortOpenInterest = 5;
    state.liquidity.bestBidPrice = 145;
    state.liquidity.bestAskPrice = 160;
    state.funding.rate = 0.05;
    const metrics = buildMetrics(state);
    const result = evaluateMarketRisk({ state, ...metrics });
    expect(result.topDrivers.length).toBeLessThanOrEqual(5);
  });

  it("accepts custom weights", () => {
    const state = at(NOW);
    state.positioning.longOpenInterest = 90;
    state.positioning.shortOpenInterest = 10;
    const metrics = buildMetrics(state);
    const result = evaluateMarketRisk(
      { state, ...metrics },
      { weights: { positioning: 5, liquidity: 0.1 } },
    );
    expect(result.overallScore).toBeGreaterThan(0);
  });
});
