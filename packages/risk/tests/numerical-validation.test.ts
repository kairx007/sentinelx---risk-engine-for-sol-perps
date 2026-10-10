import {
  calculateFundingMetrics,
  calculateLiquidationMetrics,
  calculateLiquidityMetrics,
  calculateOpenInterestMetrics,
  calculateOracleMetrics,
  calculatePositioningMetrics,
  calculateVolatilityMetrics,
} from "@perps-risk/metrics";
import type { MarketRisk } from "@perps-risk/risk";
import { MarketStateSchema, type MarketState } from "@perps-risk/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateMarketRisk } from "../src/risk-engine.js";

const TIMESTAMP = "2026-10-08T00:00:00.000Z";
const NOW = new Date(TIMESTAMP);

const healthyState = MarketStateSchema.parse({
  market: {
    venue: "velocity",
    symbol: "SOL-PERP",
    marketId: "0",
    baseAsset: "SOL",
    quoteAsset: "USDC",
  },
  price: {
    lastPrice: 100,
    indexPrice: 100,
    markPrice: 100,
    observedAt: TIMESTAMP,
  },
  positioning: {
    longOpenInterest: 50_000,
    shortOpenInterest: 50_000,
    totalOpenInterest: 100_000,
    openInterestUnit: "quote",
    observedAt: TIMESTAMP,
  },
  liquidity: {
    bestBidPrice: 99.95,
    bestAskPrice: 100.05,
    bidSize: 50_000,
    askSize: 50_000,
    availableLiquidity: 100_000,
    liquidityUnit: "quote",
    observedAt: TIMESTAMP,
  },
  funding: {
    rate: 0.0001,
    periodSeconds: 28_800,
    observedAt: TIMESTAMP,
  },
  liquidation: {
    longVolume: 0,
    shortVolume: 0,
    totalVolume: 0,
    volumeUnit: "quote",
    intervalSeconds: 3_600,
    observedAt: TIMESTAMP,
  },
  oracle: { price: 100, source: "synthetic", observedAt: TIMESTAMP },
  metadata: {
    source: "synthetic-risk-test",
    observedAt: TIMESTAMP,
    collectedAt: TIMESTAMP,
    sourceUpdatedAt: TIMESTAMP,
    freshness: { sourceAgeMs: 1_000, staleAfterMs: 15_000 },
  },
});

function stateWith(update: (state: MarketState) => void): MarketState {
  const state = structuredClone(healthyState);
  update(state);
  return MarketStateSchema.parse(state);
}

const scenarios = {
  healthy: healthyState,
  priceShock: stateWith((state) => {
    state.price.markPrice = 120;
  }),
  fundingStress: stateWith((state) => {
    state.funding.rate = 0.01;
  }),
  oiStress: stateWith((state) => {
    state.positioning.longOpenInterest = 450_000;
    state.positioning.shortOpenInterest = 50_000;
    state.positioning.totalOpenInterest = 500_000;
  }),
  liquidityStress: stateWith((state) => {
    state.positioning.longOpenInterest = 250_000;
    state.positioning.shortOpenInterest = 250_000;
    state.positioning.totalOpenInterest = 500_000;
    state.liquidity.bestBidPrice = 99.9;
    state.liquidity.bestAskPrice = 100.1;
    state.liquidity.bidSize = 500;
    state.liquidity.askSize = 500;
    state.liquidity.availableLiquidity = 1_000;
  }),
  liquidationStress: stateWith((state) => {
    state.positioning.longOpenInterest = 250_000;
    state.positioning.shortOpenInterest = 250_000;
    state.positioning.totalOpenInterest = 500_000;
    state.liquidation.longVolume = 100_000;
    state.liquidation.shortVolume = 100_000;
    state.liquidation.totalVolume = 200_000;
  }),
  missingOracle: stateWith((state) => {
    state.oracle.price = null;
    state.oracle.observedAt = null;
  }),
  missingOptionalMetrics: stateWith((state) => {
    state.funding.rate = null;
    state.liquidation.longVolume = null;
    state.liquidation.shortVolume = null;
    state.liquidation.totalVolume = null;
    state.liquidity.availableLiquidity = null;
    state.oracle.price = null;
    state.oracle.observedAt = null;
  }),
  combinedStress: stateWith((state) => {
    state.price.markPrice = 125;
    state.positioning.longOpenInterest = 900_000;
    state.positioning.shortOpenInterest = 100_000;
    state.positioning.totalOpenInterest = 1_000_000;
    state.liquidity.bestBidPrice = 98;
    state.liquidity.bestAskPrice = 102;
    state.liquidity.bidSize = 500;
    state.liquidity.askSize = 500;
    state.liquidity.availableLiquidity = 1_000;
    state.funding.rate = 0.02;
    state.liquidation.longVolume = 200_000;
    state.liquidation.shortVolume = 200_000;
    state.liquidation.totalVolume = 400_000;
  }),
} satisfies Record<string, MarketState>;

function evaluate(state: MarketState) {
  const metrics = {
    openInterest: calculateOpenInterestMetrics(state),
    positioning: calculatePositioningMetrics(state),
    liquidity: calculateLiquidityMetrics(state),
    funding: calculateFundingMetrics(state),
    liquidation: calculateLiquidationMetrics(state),
    oracle: calculateOracleMetrics(state, NOW),
    volatility: calculateVolatilityMetrics([state], 300),
  };

  return {
    metrics,
    risk: evaluateMarketRisk({ state, ...metrics }, { now: NOW }),
  };
}

const results = new Map<string, ReturnType<typeof evaluate>>();

beforeAll(() => {
  for (const [name, state] of Object.entries(scenarios)) {
    results.set(name, evaluate(state));
  }
});

function result(name: keyof typeof scenarios): ReturnType<typeof evaluate> {
  const evaluation = results.get(name);
  if (!evaluation) throw new Error(`Missing evaluation for ${name}`);
  return evaluation;
}

function componentScore(risk: MarketRisk, name: string): number {
  const component = risk.components[name];
  if (!component) throw new Error(`Missing risk component ${name}`);
  return component.score;
}

afterAll(() => {
  const summary = Object.fromEntries(
    [...results].map(([name, { risk }]) => [
      name,
      {
        score: risk.overallScore,
        level: risk.level,
        topDrivers: risk.topDrivers,
      },
    ]),
  );
  console.info(
    "Risk numerical validation results:",
    JSON.stringify(summary, null, 2),
  );
});

describe("risk engine numerical validation", () => {
  it("scores a completely healthy market as low risk", () => {
    const { metrics, risk } = result("healthy");

    expect(risk.level).toBe("low");
    expect(risk.overallScore).toBeLessThan(26);
    expect(metrics.liquidity.spreadPercent).toBeCloseTo(0.1, 8);
    expect(componentScore(risk, "liquidation")).toBe(0);
    expect(componentScore(risk, "oracle")).toBe(0);
    expect(
      risk.topDrivers.some((driver) =>
        /extreme positive|crowded|severe|widening|low effective liquidity|price deviation|stale|very high open interest/i.test(
          driver,
        ),
      ),
    ).toBe(false);
  });

  it("raises risk and identifies the deviation for an extreme price shock", () => {
    const { risk } = result("priceShock");

    expect(risk.overallScore).toBeGreaterThan(
      result("healthy").risk.overallScore,
    );
    expect(risk.topDrivers.some((driver) => /deviation/i.test(driver))).toBe(
      true,
    );
  });

  it("raises funding risk and names funding as a driver", () => {
    const { risk } = result("fundingStress");

    expect(componentScore(risk, "funding")).toBeGreaterThan(
      componentScore(result("healthy").risk, "funding"),
    );
    expect(risk.overallScore).toBeGreaterThan(
      result("healthy").risk.overallScore,
    );
    expect(risk.topDrivers.some((driver) => /funding/i.test(driver))).toBe(
      true,
    );
  });

  it("raises leverage and positioning risk for high, skewed open interest", () => {
    const { risk } = result("oiStress");
    const healthy = result("healthy").risk;

    expect(componentScore(risk, "leverage")).toBeGreaterThan(
      componentScore(healthy, "leverage"),
    );
    expect(componentScore(risk, "positioning")).toBeGreaterThan(
      componentScore(healthy, "positioning"),
    );
    expect(risk.overallScore).toBeGreaterThan(healthy.overallScore);
    expect(risk.topDrivers.some((driver) => /positioning/i.test(driver))).toBe(
      true,
    );
  });

  it("raises liquidity risk and identifies constrained depth", () => {
    const { risk } = result("liquidityStress");

    expect(componentScore(risk, "liquidity")).toBeGreaterThan(
      componentScore(result("healthy").risk, "liquidity"),
    );
    expect(risk.overallScore).toBeGreaterThan(
      result("healthy").risk.overallScore,
    );
    expect(risk.topDrivers.some((driver) => /liquidity/i.test(driver))).toBe(
      true,
    );
  });

  it("raises liquidation risk and identifies liquidation volume", () => {
    const { risk } = result("liquidationStress");

    expect(componentScore(risk, "liquidation")).toBeGreaterThan(
      componentScore(result("healthy").risk, "liquidation"),
    );
    expect(risk.overallScore).toBeGreaterThan(
      result("healthy").risk.overallScore,
    );
    expect(risk.topDrivers.some((driver) => /liquidation/i.test(driver))).toBe(
      true,
    );
  });

  it("handles an unavailable oracle without replacing null with zero", () => {
    const state = scenarios.missingOracle;
    const { risk } = result("missingOracle");

    expect(state.oracle.price).toBeNull();
    expect(() => evaluate(state)).not.toThrow();
    expect(Number.isFinite(risk.overallScore)).toBe(true);
  });

  it("handles missing optional metrics without creating false stress", () => {
    const state = scenarios.missingOptionalMetrics;
    const { metrics, risk } = result("missingOptionalMetrics");

    expect(state.funding.rate).toBeNull();
    expect(state.liquidation.totalVolume).toBeNull();
    expect(state.liquidity.availableLiquidity).toBeNull();
    expect(state.oracle.price).toBeNull();
    expect(metrics.funding.currentFunding).toBeNull();
    expect(metrics.liquidation.totalVolume).toBeNull();
    expect(risk.overallScore).toBeLessThanOrEqual(
      result("healthy").risk.overallScore,
    );
    expect(Number.isFinite(risk.overallScore)).toBe(true);
  });

  it("scores maximum combined stress as medium or higher with multiple drivers", () => {
    const { risk } = result("combinedStress");
    const elevatedComponents = Object.values(risk.components).filter(
      (component) => component.score >= 50,
    );

    expect(risk.overallScore).toBeGreaterThan(
      result("healthy").risk.overallScore,
    );
    expect(["medium", "high", "critical"]).toContain(risk.level);
    expect(elevatedComponents.length).toBeGreaterThanOrEqual(3);
    expect(risk.topDrivers.length).toBeGreaterThanOrEqual(3);
  });
});
