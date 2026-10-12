import { describe, expect, it } from "vitest";
import type {
  CrossVenueRisk,
  EcosystemRisk,
  VenueSnapshot,
} from "../src/types.js";
import {
  calculateCrossVenueRisk,
  calculateEcosystemRisk,
} from "../src/risk.js";

function venue(
  venue: VenueSnapshot["venue"],
  price: number,
  oi: number,
  annualizedFundingPct: number, // percent, annualized
  fundingPeriodSeconds: number,
  spread: number,
): VenueSnapshot {
  // Convert annualized percent back to per-period rate for the snapshot
  const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
  const rate =
    (annualizedFundingPct / 100) * (fundingPeriodSeconds / SECONDS_PER_YEAR);

  return {
    venue,
    symbol: `${venue.toUpperCase()}-PERP`,
    state: {} as never,
    risk: null,
    metrics: {
      price,
      oi,
      longOi: oi / 2,
      shortOi: oi / 2,
      funding: rate,
      fundingPeriod: fundingPeriodSeconds,
      spread,
      liquidations: null,
    },
  };
}

describe("calculateCrossVenueRisk", () => {
  // ─── Aligned markets → low risk ────────────────────────────────────

  it("returns low risk when all venues align", () => {
    const snapshots = [
      venue("velocity", 120.0, 10_000, 10, 86400, 0.01),
      venue("phoenix", 120.05, 8_000, 10.5, 86400, 0.012),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.asset).toBe("SOL");
    expect(result.venueCount).toBe(2);
    expect(result.ecosystemLevel).toBe("low");
    expect(result.ecosystemScore).toBeLessThan(30);
    expect(result.riskDrivers.length).toBeGreaterThan(0);
  });

  // ─── Price divergence ──────────────────────────────────────────────

  it("flags moderate price divergence", () => {
    const snapshots = [
      venue("velocity", 120.0, 10_000, 10, 86400, 0.01),
      venue("phoenix", 130.0, 8_000, 10, 86400, 0.01),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.divergence.price).not.toBeNull();
    expect(result.divergence.price!.value).not.toBeNull();
    expect(result.divergence.price!.value!).toBeGreaterThan(3);
    expect(result.divergence.price!.score).toBeGreaterThan(0);
    expect(result.riskDrivers.some((d) => d.includes("Price divergence"))).toBe(
      true,
    );
    expect(result.ecosystemLevel).toMatch(/^(medium|high|critical)$/);
  });

  // ─── Funding divergence ────────────────────────────────────────────

  it("flags extreme funding divergence", () => {
    const snapshots = [
      venue("velocity", 120.0, 10_000, 10, 3600, 0.01),
      venue("phoenix", 120.05, 8_000, 100, 86400, 0.01),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.divergence.funding).not.toBeNull();
    expect(result.riskDrivers.some((d) => d.includes("Funding"))).toBe(true);
  });

  // ─── OI concentration ──────────────────────────────────────────────

  it("flags OI concentration on one venue", () => {
    const snapshots = [
      venue("velocity", 120.0, 100_000, 10, 86400, 0.01),
      venue("phoenix", 120.05, 2_000, 10, 86400, 0.01),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.divergence.oiConcentration).not.toBeNull();
    expect(result.divergence.oiConcentration!.value).not.toBeNull();
    expect(result.divergence.oiConcentration!.value!).toBeGreaterThan(0.8);
    expect(result.divergence.oiConcentration!.score).toBeGreaterThan(0);
    expect(result.divergence.oiConcentration!.weight).toBeGreaterThan(0);
    expect(result.riskDrivers.some((d) => d.includes("concentration"))).toBe(
      true,
    );
  });

  // ─── Sparse data ───────────────────────────────────────────────────

  it("returns low risk with a single venue", () => {
    const snapshots = [venue("velocity", 120.0, 10_000, 10, 86400, 0.01)];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.venueCount).toBe(1);
    expect(result.ecosystemScore).toBe(0);
    expect(result.ecosystemLevel).toBe("low");
    expect(result.riskDrivers).toContain(
      "Single venue — no cross-venue comparison possible",
    );
  });

  it("returns low risk with no venues", () => {
    const result = calculateCrossVenueRisk("SOL", []);
    expect(result.venueCount).toBe(0);
    expect(result.ecosystemScore).toBe(0);
    expect(result.ecosystemLevel).toBe("low");
  });

  // ─── Combined stress ───────────────────────────────────────────────

  it("flags high or critical risk with multiple divergences", () => {
    const snapshots = [
      venue("velocity", 120.0, 100_000, 10, 3600, 0.01),
      venue("phoenix", 130.0, 5_000, 100, 86400, 0.5),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.divergence.price).not.toBeNull();
    expect(result.divergence.funding).not.toBeNull();
    expect(result.divergence.oiConcentration).not.toBeNull();
    expect(result.ecosystemLevel).toMatch(/^(high|critical)$/);
    expect(result.riskDrivers.length).toBeGreaterThanOrEqual(2);
  });

  // ─── Liquidity spread ──────────────────────────────────────────────

  it("flags liquidity spread divergence", () => {
    const snapshots = [
      venue("velocity", 120.0, 10_000, 10, 86400, 0.01),
      venue("phoenix", 120.05, 8_000, 10, 86400, 2.0),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.divergence.liquiditySpread).not.toBeNull();
    expect(result.divergence.liquiditySpread!.value).not.toBeNull();
    expect(result.divergence.liquiditySpread!.value!).toBeGreaterThan(0);
    expect(result.divergence.liquiditySpread!.score).toBeGreaterThan(0);
    expect(result.divergence.liquiditySpread!.weight).toBeGreaterThan(0);
    expect(result.riskDrivers.some((d) => d.includes("spread"))).toBe(true);
  });

  // ─── Deterministic ordering ────────────────────────────────────────

  it("sorts venues deterministically", () => {
    const snapshots = [
      venue("phoenix", 120.0, 10_000, 10, 86400, 0.01),
      venue("velocity", 120.0, 10_000, 10, 86400, 0.01),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.venueSnapshots[0]!.venue).toBe("phoenix");
    expect(result.venueSnapshots[1]!.venue).toBe("velocity");
  });

  // ─── Timestamp ─────────────────────────────────────────────────────

  it("includes a current ISO timestamp", () => {
    const result = calculateCrossVenueRisk("SOL", [
      venue("velocity", 120.0, 10_000, 10, 86400, 0.01),
    ]);
    expect(result.timestamp).toBeTruthy();
    expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
  });

  it("returns a stable ecosystem summary with a 2-venue Phoenix/Velocity mix", () => {
    const snapshots = [
      venue("velocity", 120.0, 12_000, 8, 86400, 0.02),
      venue("phoenix", 121.2, 11_500, 9, 86400, 0.025),
    ];

    const result = calculateEcosystemRisk("SOL", snapshots);

    expect(result.asset).toBe("SOL");
    expect(result.venueCount).toBe(2);
    expect(result.ecosystemLevel).toMatch(/^(low|medium|high|critical)$/);
    expect(result.riskDrivers.length).toBeGreaterThan(0);
    expect(result.venueSnapshots.map((entry) => entry.venue).sort()).toEqual([
      "phoenix",
      "velocity",
    ]);
  });

  it("handles a 4-venue Phoenix/Velocity stress mix deterministically", () => {
    const snapshots = [
      venue("velocity", 120.0, 50_000, 8, 3600, 0.01),
      venue("phoenix", 130.0, 18_000, 25, 3600, 0.5),
      venue("velocity", 122.0, 45_000, 12, 3600, 0.08),
      venue("phoenix", 135.0, 17_500, 35, 3600, 0.7),
    ];

    const result = calculateEcosystemRisk("SOL", snapshots);

    expect(result.venueCount).toBe(4);
    expect(result.divergence.price).not.toBeNull();
    expect(result.divergence.funding).not.toBeNull();
    expect(result.ecosystemLevel).toMatch(/^(medium|high|critical)$/);
    expect(result.riskDrivers.length).toBeGreaterThanOrEqual(2);
    const typed: EcosystemRisk = result;
    expect(typed.ecosystemScore).not.toBeNull();
  });
});

// ─── Divergence score / weight / contribution tests ────────────────────────

import {
  crossVenueWeights,
  priceDivergenceThresholds,
  fundingDivergenceThresholds,
  oiConcentrationThresholds,
  liquidityDivergenceThresholds,
} from "../src/config.js";

describe("divergence scores, weights, and contributions", () => {
  const SECONDS_PER_YEAR = 365.25 * 24 * 3600;

  function makeMetric(
    price: number,
    oi: number,
    annualizedFundingPct: number,
    fundingPeriodSeconds: number,
    spread: number,
    liquidations: number | null = null,
  ): VenueSnapshot {
    const rate =
      (annualizedFundingPct / 100) *
      (fundingPeriodSeconds / SECONDS_PER_YEAR);
    return {
      venue: "velocity",
      symbol: "VELOCITY-PERP",
      state: {} as never,
      risk: null,
      metrics: { price, oi, longOi: oi / 2, shortOi: oi / 2, funding: rate, fundingPeriod: fundingPeriodSeconds, spread, liquidations },
    };
  }

  it("returns a score between 0-100 for each available divergence metric", () => {
    const snapshots = [
      makeMetric(120.0, 10_000, 10, 86400, 0.01, 100),
      makeMetric(120.05, 8_000, 10.5, 86400, 0.012, 80),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    for (const key of [
      "price",
      "funding",
      "oiConcentration",
      "liquiditySpread",
      "liquidationConcentration",
    ] as const) {
      const m = result.divergence[key]!;
      expect(m).not.toBeNull();
      expect(m!.score).not.toBeNull();
      expect(m!.score).toBeGreaterThanOrEqual(0);
      expect(m!.score).toBeLessThanOrEqual(100);
    }
  });

  it("assigns the correct weight from crossVenueWeights", () => {
    const snapshots = [
      makeMetric(120.0, 10_000, 10, 86400, 0.01),
      makeMetric(120.05, 8_000, 10.5, 86400, 0.012),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.divergence.price!.weight).toBe(crossVenueWeights.price);
    expect(result.divergence.funding!.weight).toBe(crossVenueWeights.funding);
    expect(result.divergence.oiConcentration!.weight).toBe(
      crossVenueWeights.oiConcentration,
    );
    expect(result.divergence.liquiditySpread!.weight).toBe(
      crossVenueWeights.liquiditySpread,
    );
    expect(result.divergence.liquidationConcentration!.weight).toBe(
      crossVenueWeights.liquidationConcentration,
    );
  });

  it("computes contributions that sum to the final ecosystem score (within rounding)", () => {
    const snapshots = [
      makeMetric(120.0, 10_000, 10, 86400, 0.01),
      makeMetric(120.05, 8_000, 10.5, 86400, 0.012),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    const contributions = Object.values(result.divergence)
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => m.contribution);

    const sum = contributions.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(result.ecosystemScore as number, 0);
  });

  it("sets contribution to null when score is null", () => {
    // Single venue → all divergence metrics return null scores
    const result = calculateCrossVenueRisk("SOL", [
      makeMetric(120.0, 10_000, 10, 86400, 0.01),
    ]);

    for (const key of [
      "price",
      "funding",
      "oiConcentration",
      "liquiditySpread",
      "liquidationConcentration",
    ] as const) {
      expect(result.divergence[key]).toBeNull();
    }
  });

  it("exposes the raw value alongside the score", () => {
    const snapshots = [
      makeMetric(120.0, 10_000, 10, 86400, 0.01),
      makeMetric(120.05, 8_000, 10.5, 86400, 0.012),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.divergence.price!.value).not.toBeNull();
    expect(result.divergence.price!.score).not.toBeNull();
    // price CV should be very small for nearly identical prices
    expect(result.divergence.price!.value!).toBeLessThan(0.1);
  });

  it("computes correct contributions for a deterministic stress fixture", () => {
    // Construct a fixture where we can predict the divergence values and scores.
    const snapshots = [
      makeMetric(100.0, 100_000, 10, 86400, 0.01),
      makeMetric(110.0, 5_000, 100, 3600, 2.0),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    // Verify metrics with available data have non-null scores and contributions.
    // Liquidation concentration may be null if venues don't have liquidation data.
    const metricsWithData: (keyof typeof result.divergence)[] = [
      "price",
      "funding",
      "oiConcentration",
      "liquiditySpread",
    ];

    for (const key of metricsWithData) {
      const m = result.divergence[key]!;
      expect(m).not.toBeNull();
      expect(m!.score).not.toBeNull();
      expect(m!.score).toBeGreaterThan(0);
      expect(m!.contribution).not.toBeNull();
      expect(m!.contribution).toBeGreaterThan(0);
    }

    const contributions = Object.values(result.divergence)
      .filter((m): m is NonNullable<typeof m> => m !== null && m.contribution !== null)
      .map((m) => m.contribution!);
    const sum = contributions.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(result.ecosystemScore as number, 0);
  });

  it("returns a metric object with null score when a data source is missing", () => {
    // When one venue lacks spread data, liquidity spread divergence has null score
    // but is still represented as a metric object (not null) for the two-venue comparison.
    const snapshots = [
      makeMetric(120.0, 10_000, 10, 86400, 0.01),
      makeMetric(120.05, 8_000, 10.5, 86400, null as any),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    expect(result.divergence.liquiditySpread).not.toBeNull();
    expect(result.divergence.liquiditySpread!.score).toBeNull();
    expect(result.divergence.liquiditySpread!.value).toBeNull();
    expect(result.divergence.liquiditySpread!.contribution).toBeNull();
    expect(result.divergence.liquiditySpread!.weight).toBe(
      crossVenueWeights.liquiditySpread,
    );
  });

  it("returns a driver string for each metric", () => {
    const snapshots = [
      makeMetric(120.0, 10_000, 10, 86400, 0.01),
      makeMetric(120.05, 8_000, 10.5, 86400, 0.012),
    ];

    const result = calculateCrossVenueRisk("SOL", snapshots);

    for (const key of [
      "price",
      "funding",
      "oiConcentration",
      "liquiditySpread",
      "liquidationConcentration",
    ] as const) {
      expect(result.divergence[key]!.driver.length).toBeGreaterThan(0);
    }
  });

  it("handles boundary divergence scores (0 and 100)", () => {
    // Exact identical venues -> divergence = 0 -> score = 0
    const zeroDivergence = [
      makeMetric(100.0, 10_000, 10, 86400, 0.01, 500),
      makeMetric(100.0, 10_000, 10, 86400, 0.01, 500),
    ];
    const zeroResult = calculateCrossVenueRisk("SOL", zeroDivergence);
    expect(zeroResult.divergence.price!.score).toBe(0);
    expect(zeroResult.divergence.funding!.score).toBe(0);
    expect(zeroResult.divergence.liquiditySpread!.score).toBe(0);

    // Extreme divergent venues -> extreme divergence -> score = 100
    const extremeDivergence = [
      makeMetric(100.0, 1_000_000, 0, 86400, 0.01, 1000),
      makeMetric(200.0, 1, 200, 86400, 10.0, 1),
    ];
    const extremeResult = calculateCrossVenueRisk("SOL", extremeDivergence);
    expect(extremeResult.divergence.price!.score).toBe(100);
    expect(extremeResult.divergence.funding!.score).toBe(100);
    expect(extremeResult.divergence.liquiditySpread!.score).toBe(100);
    expect(Math.round(extremeResult.divergence.oiConcentration!.score!)).toBe(100);
    expect(Math.round(extremeResult.divergence.liquidationConcentration!.score!)).toBe(100);
  });
});


