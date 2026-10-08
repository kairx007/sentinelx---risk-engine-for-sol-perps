import { describe, expect, it } from "vitest";
import type { CrossVenueRisk, EcosystemRisk, VenueSnapshot } from "../src/types.js";
import { calculateCrossVenueRisk, calculateEcosystemRisk } from "../src/risk.js";

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
  const rate = (annualizedFundingPct / 100) * (fundingPeriodSeconds / SECONDS_PER_YEAR);

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
    expect(result.divergence.price!).toBeGreaterThan(3);
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
    expect(result.divergence.oiConcentration!).toBeGreaterThan(0.8);
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
    expect(result.divergence.liquiditySpread!).toBeGreaterThan(0);
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
