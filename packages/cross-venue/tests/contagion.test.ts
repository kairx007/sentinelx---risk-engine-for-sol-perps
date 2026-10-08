import { describe, expect, it } from "vitest";
import type { VenueSnapshot } from "../src/types.js";
import { calculateContagionRisk } from "../src/contagion.js";

type RiskLevel = "low" | "medium" | "high" | "critical";

function makeSnapshot(
  venue: VenueSnapshot["venue"],
  level: RiskLevel,
  score: number,
  metrics: Partial<VenueSnapshot["metrics"]>,
): VenueSnapshot {
  return {
    venue,
    symbol: `${venue.toUpperCase()}-PERP`,
    state: {} as never,
    risk: {
      overallScore: score,
      level,
      components: {} as never,
      topDrivers: ["stress"],
      timestamp: "2026-10-08T00:00:00.000Z",
    },
    metrics: {
      price: 120,
      oi: 10000,
      longOi: 5000,
      shortOi: 5000,
      funding: 0.0001,
      fundingPeriod: 86400,
      spread: 0.02,
      liquidations: 100,
      ...metrics,
    },
  };
}

describe("calculateContagionRisk", () => {
  it("returns NONE when both venues are normal", () => {
    const snapshots = [
      makeSnapshot("velocity", "low", 12, { price: 120, spread: 0.01, oi: null }),
      makeSnapshot("phoenix", "low", 15, { price: 120.1, spread: 0.015, oi: null }),
    ];

    const result = calculateContagionRisk("SOL", snapshots);

    expect(result.status).toBe("NONE");
    expect(result.severity).toBe("low");
  });

  it("returns ISOLATED when Velocity is stressed and Phoenix is normal", () => {
    const snapshots = [
      makeSnapshot("velocity", "high", 65, {
        price: 120,
        spread: 0.01,
        oi: null,
        liquidations: null,
      }),
      makeSnapshot("phoenix", "low", 18, {
        price: 120,
        spread: 0.01,
        oi: null,
        liquidations: null,
      }),
    ];

    const result = calculateContagionRisk("SOL", snapshots);

    expect(result.status).toBe("ISOLATED");
    expect(result.affectedVenues).toContain("velocity");
    expect(result.affectedVenues).not.toContain("phoenix");
  });

  it("returns ISOLATED when Phoenix is stressed and Velocity is normal", () => {
    const snapshots = [
      makeSnapshot("velocity", "low", 18, {
        price: 120,
        spread: 0.01,
        oi: null,
        liquidations: null,
      }),
      makeSnapshot("phoenix", "high", 68, {
        price: 120,
        spread: 0.01,
        oi: null,
        liquidations: null,
      }),
    ];

    const result = calculateContagionRisk("SOL", snapshots);

    expect(result.status).toBe("ISOLATED");
    expect(result.affectedVenues).toContain("phoenix");
  });

  it("returns DEVELOPING when one venue is stressed and the other is medium with a single spread signal", () => {
    const snapshots = [
      makeSnapshot("velocity", "high", 70, {
        price: 120,
        spread: 0.8,
        oi: null,
        liquidations: null,
      }),
      makeSnapshot("phoenix", "medium", 40, {
        price: 120.1,
        spread: 0.01,
        oi: null,
        liquidations: null,
      }),
    ];

    const result = calculateContagionRisk("SOL", snapshots);

    expect(result.status).toBe("DEVELOPING");
    expect(result.affectedVenues).toEqual(
      expect.arrayContaining(["velocity", "phoenix"]),
    );
  });

  it("returns ACTIVE when both venues are stressed", () => {
    const snapshots = [
      makeSnapshot("velocity", "high", 72, { price: 120, spread: 0.4, oi: 18000 }),
      makeSnapshot("phoenix", "critical", 85, { price: 135, spread: 0.8, oi: 22000 }),
    ];

    const result = calculateContagionRisk("SOL", snapshots);

    expect(result.status).toBe("ACTIVE");
    expect(result.severity).toMatch(/^(high|critical)$/);
    expect(result.affectedVenues).toEqual(expect.arrayContaining(["velocity", "phoenix"]));
  });

  it("returns ACTIVE when one venue is stressed and two divergence signals are material", () => {
    const snapshots = [
      makeSnapshot("velocity", "high", 71, {
        price: 120,
        spread: 0.8,
        funding: 0.02,
        oi: 18000,
        liquidations: 1000,
      }),
      makeSnapshot("phoenix", "low", 24, {
        price: 140,
        spread: 0.01,
        funding: 0.002,
        oi: 5000,
        liquidations: 50,
      }),
    ];

    const result = calculateContagionRisk("SOL", snapshots);

    expect(result.status).toBe("ACTIVE");
  });

  it("ignores missing liquidation or liquidity data and avoids false contagion signal", () => {
    const snapshots = [
      makeSnapshot("velocity", "high", 60, {
        liquidations: null,
        spread: null,
        oi: null,
      }),
      makeSnapshot("phoenix", "low", 22, {
        liquidations: null,
        spread: null,
        oi: null,
      }),
    ];

    const result = calculateContagionRisk("SOL", snapshots);

    expect(result.status).toBe("ISOLATED");
  });

  it("returns NONE for aligned markets", () => {
    const snapshots = [
      makeSnapshot("velocity", "low", 12, { price: 120, spread: 0.01, oi: null }),
      makeSnapshot("phoenix", "low", 14, { price: 120.05, spread: 0.012, oi: null }),
    ];

    const result = calculateContagionRisk("SOL", snapshots);

    expect(result.status).toBe("NONE");
  });
});
