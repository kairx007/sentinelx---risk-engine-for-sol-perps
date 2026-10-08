import type { MarketState } from "@perps-risk/types";
import driftMarketState from "../../../tests/fixtures/market-state-drift.json";
import { describe, expect, it } from "vitest";
import { calculateFundingMetrics } from "../src/funding.js";
import { calculateLiquidationMetrics } from "../src/liquidation.js";
import { calculateLiquidityMetrics } from "../src/liquidity.js";
import { calculateOpenInterestMetrics } from "../src/open-interest.js";
import { calculateOracleMetrics } from "../src/oracle.js";
import { calculatePositioningMetrics } from "../src/positioning.js";
import { calculateVolatilityMetrics } from "../src/volatility.js";

const fixture = driftMarketState as MarketState;

function at(time: string, overrides: Partial<MarketState> = {}): MarketState {
  const state = structuredClone(fixture);
  state.price.observedAt = time;
  state.positioning.observedAt = time;
  state.funding.observedAt = time;
  state.liquidation.observedAt = time;
  state.oracle.observedAt = time;
  state.metadata.observedAt = time;
  state.metadata.sourceUpdatedAt = time;
  return { ...state, ...overrides };
}

describe("open-interest metrics", () => {
  it("calculates total, absolute/percentage change, and velocity", () => {
    const previous = at("2026-10-05T10:00:00.000Z");
    const current = at("2026-10-05T10:00:10.000Z");
    current.positioning.totalOpenInterest = 243007;

    expect(calculateOpenInterestMetrics(current, [previous])).toMatchObject({
      totalOpenInterest: 243007,
      unit: "base",
      change: 7,
      changePercent: (7 / 243000) * 100,
      velocityPerSecond: 0.7,
      elapsedSeconds: 10,
    });
  });

  it("leaves comparison metrics null for mismatched units or zero denominator", () => {
    const previous = at("2026-10-05T10:00:00.000Z");
    const current = at("2026-10-05T10:00:10.000Z");
    previous.positioning.openInterestUnit = "quote";
    expect(calculateOpenInterestMetrics(current, [previous]).change).toBeNull();

    previous.positioning.openInterestUnit = "base";
    previous.positioning.totalOpenInterest = 0;
    expect(
      calculateOpenInterestMetrics(current, [previous]).changePercent,
    ).toBeNull();
  });
});

describe("positioning metrics", () => {
  it("calculates side ratio, percentages, and signed imbalance", () => {
    const state = at("2026-10-05T10:00:00.000Z");
    state.positioning.longOpenInterest = 60;
    state.positioning.shortOpenInterest = 40;
    expect(calculatePositioningMetrics(state)).toEqual({
      longShortRatio: 1.5,
      longPercent: 60,
      shortPercent: 40,
      imbalance: 0.2,
    });
  });

  it("returns null for unavailable sides and zero short ratio denominator", () => {
    const state = at("2026-10-05T10:00:00.000Z");
    state.positioning.longOpenInterest = 10;
    state.positioning.shortOpenInterest = 0;
    expect(calculatePositioningMetrics(state)).toMatchObject({
      longShortRatio: null,
      longPercent: 100,
      shortPercent: 0,
      imbalance: 1,
    });
    state.positioning.shortOpenInterest = null;
    expect(calculatePositioningMetrics(state).imbalance).toBeNull();
  });
});

describe("liquidity metrics", () => {
  it("calculates spread, top-level depth, imbalance, effective depth, and touch impact", () => {
    const state = at("2026-10-05T10:00:00.000Z");
    const result = calculateLiquidityMetrics(state, {
      side: "buy",
      size: 100,
      unit: "base",
    });
    expect(result.spread).toBeCloseTo(0.03);
    expect(result.spreadPercent).toBeCloseTo((0.03 / 152.415) * 100);
    expect(result.bidDepth).toBe(8250);
    expect(result.askDepth).toBe(7900);
    expect(result.imbalance).toBeCloseTo(350 / 16150);
    expect(result.effectiveLiquidity).toBe(7900);
    expect(result.estimatedPriceImpactPercent).toBeCloseTo(
      (0.015 / 152.415) * 100,
    );
  });

  it("does not estimate impact beyond displayed top-of-book depth", () => {
    const state = at("2026-10-05T10:00:00.000Z");
    expect(
      calculateLiquidityMetrics(state, {
        side: "buy",
        size: 9000,
        unit: "base",
      }).estimatedPriceImpactPercent,
    ).toBeNull();
  });
});

describe("funding metrics", () => {
  it("calculates same-period change and historical percentile", () => {
    const old = at("2026-10-05T09:00:00.000Z");
    const newer = at("2026-10-05T09:30:00.000Z");
    const current = at("2026-10-05T10:00:00.000Z");
    old.funding.rate = 0.0001;
    newer.funding.rate = 0.0003;
    current.funding.rate = 0.0002;
    const result = calculateFundingMetrics(current, [old, newer]);
    expect(result.currentFunding).toBe(0.0002);
    expect(result.periodSeconds).toBe(3600);
    expect(result.change).toBeCloseTo(-0.0001);
    expect(result.percentile).toBe(50);
  });

  it("does not compare incompatible funding periods", () => {
    const previous = at("2026-10-05T09:00:00.000Z");
    previous.funding.periodSeconds = 86400;
    const current = at("2026-10-05T10:00:00.000Z");
    expect(calculateFundingMetrics(current, [previous])).toMatchObject({
      change: null,
      percentile: null,
    });
  });
});

describe("liquidation metrics", () => {
  it("calculates volume and liquidation-to-OI only for matching units", () => {
    const state = at("2026-10-05T10:00:00.000Z");
    state.liquidation.longVolume = 120;
    state.liquidation.shortVolume = 80;
    state.liquidation.totalVolume = null;
    state.liquidation.volumeUnit = "base";
    state.positioning.totalOpenInterest = 1000;
    state.positioning.openInterestUnit = "base";
    expect(calculateLiquidationMetrics(state)).toMatchObject({
      totalVolume: 200,
      longVolume: 120,
      shortVolume: 80,
      liquidationToOpenInterest: 0.2,
    });
    state.liquidation.volumeUnit = "quote";
    expect(
      calculateLiquidationMetrics(state).liquidationToOpenInterest,
    ).toBeNull();
  });
});

describe("oracle metrics", () => {
  it("calculates oracle age and price deviations", () => {
    const state = at("2026-10-05T10:00:00.000Z");
    const result = calculateOracleMetrics(
      state,
      new Date("2026-10-05T10:00:01.000Z"),
    );
    expect(result.oracleAgeMs).toBe(1000);
    expect(result.markIndexDeviation).toBeCloseTo(0.03);
    expect(result.indexOracleDeviation).toBe(0);
  });

  it("returns null age for a future oracle timestamp", () => {
    const state = at("2026-10-05T10:00:02.000Z");
    expect(
      calculateOracleMetrics(state, new Date("2026-10-05T10:00:01.000Z"))
        .oracleAgeMs,
    ).toBeNull();
  });
});

describe("volatility metrics", () => {
  it("calculates window price change, realized volatility, and change from prior window", () => {
    const states = [
      at("2026-10-05T09:56:00.000Z"),
      at("2026-10-05T09:57:00.000Z"),
      at("2026-10-05T09:58:00.000Z"),
      at("2026-10-05T09:59:00.000Z"),
      at("2026-10-05T10:00:00.000Z"),
    ];
    [100, 101, 102, 104, 103].forEach((price, index) => {
      const state = states[index];
      if (state) state.price.markPrice = price;
    });
    const result = calculateVolatilityMetrics(states, 120);
    expect(result.priceSource).toBe("mark");
    expect(result.priceChangePercent).toBeCloseTo(((103 - 102) / 102) * 100);
    expect(result.realizedVolatilityPercent).not.toBeNull();
    expect(result.volatilityChangePercent).not.toBeNull();
  });

  it("returns null metrics for invalid windows and insufficient observations", () => {
    const state = at("2026-10-05T10:00:00.000Z");
    expect(
      calculateVolatilityMetrics([state], 0).realizedVolatilityPercent,
    ).toBeNull();
    expect(
      calculateVolatilityMetrics([state], 60).realizedVolatilityPercent,
    ).toBeNull();
  });
});
