import type { MarketRisk } from "@perps-risk/risk";
import { MarketStateSchema, type MarketState } from "@perps-risk/types";
import { describe, expect, it } from "vitest";
import { buildRiskPolicyDecision } from "../src/policy.js";
import type {
  ContagionRisk,
  EcosystemRisk,
  VenueSnapshot,
} from "../src/types.js";

const TIMESTAMP = "2026-10-08T00:00:00.000Z";

function makeState(venue: "velocity" | "phoenix"): MarketState {
  return MarketStateSchema.parse({
    market: {
      venue,
      symbol: "SOL-PERP",
      marketId: "1",
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
      longOpenInterest: null,
      shortOpenInterest: null,
      totalOpenInterest: null,
      openInterestUnit: null,
      observedAt: null,
    },
    liquidity: {
      bestBidPrice: null,
      bestAskPrice: null,
      bidSize: null,
      askSize: null,
      availableLiquidity: null,
      liquidityUnit: null,
      observedAt: null,
    },
    funding: { rate: null, periodSeconds: null, observedAt: null },
    liquidation: {
      longVolume: null,
      shortVolume: null,
      totalVolume: null,
      volumeUnit: null,
      intervalSeconds: null,
      observedAt: null,
    },
    oracle: { price: null, source: null, observedAt: null },
    metadata: {
      source: `${venue}-policy-test`,
      observedAt: TIMESTAMP,
      collectedAt: TIMESTAMP,
      sourceUpdatedAt: TIMESTAMP,
      freshness: { sourceAgeMs: 1_000, staleAfterMs: 15_000 },
    },
  });
}

function makeRisk(score: number, timestamp = TIMESTAMP): MarketRisk {
  const level =
    score >= 76
      ? "critical"
      : score >= 51
        ? "high"
        : score >= 26
          ? "medium"
          : "low";
  return {
    overallScore: score,
    level,
    components: {},
    topDrivers: [],
    timestamp,
  };
}

function makeSnapshot(
  venue: "velocity" | "phoenix",
  score: number,
): VenueSnapshot {
  const state = makeState(venue);
  return {
    venue,
    symbol: state.market.symbol,
    state,
    risk: makeRisk(score),
    metrics: {
      price: null,
      oi: null,
      longOi: null,
      shortOi: null,
      funding: null,
      fundingPeriod: null,
      spread: null,
      liquidations: null,
    },
  };
}

function makeEcosystem(
  velocityScore = 10,
  phoenixScore = 10,
  ecosystemScore: number | null = null,
): EcosystemRisk {
  return {
    asset: "SOL",
    timestamp: TIMESTAMP,
    venueCount: 2,
    ecosystemScore,
    ecosystemLevel: ecosystemScore === null ? null : "low",
    venueSnapshots: [
      makeSnapshot("velocity", velocityScore),
      makeSnapshot("phoenix", phoenixScore),
    ],
    divergence: {
      price: null,
      funding: null,
      oiConcentration: null,
      liquiditySpread: null,
      liquidationConcentration: null,
    },
    riskDrivers: [],
  };
}

const contagion: ContagionRisk = {
  status: "NONE",
  severity: "low",
  affectedVenues: [],
  drivers: [],
  timestamp: TIMESTAMP,
};

describe("buildRiskPolicyDecision", () => {
  it.each([
    [10, "low", 300],
    [40, "medium", 200],
    [60, "high", 100],
    [90, "critical", 0],
  ] as const)(
    "maps score %i to %s policy leverage",
    (score, riskLevel, leverage) => {
      const decision = buildRiskPolicyDecision(
        makeEcosystem(score, score),
        "NONE",
      );
      expect(decision).toMatchObject({
        riskScore: score,
        riskLevel,
        maxLeverageX100: leverage,
      });
    },
  );

  it("uses the highest available venue/ecosystem score", () => {
    const decision = buildRiskPolicyDecision(makeEcosystem(34, 52, 61), "NONE");
    expect(decision).toMatchObject({
      riskScore: 61,
      riskLevel: "high",
      maxLeverageX100: 100,
    });
  });

  it("does not treat a null ecosystem score as zero or as a low ecosystem result", () => {
    const decision = buildRiskPolicyDecision(
      makeEcosystem(40, 30, null),
      "NONE",
    );
    expect(decision).toMatchObject({
      riskScore: 40,
      riskLevel: "medium",
      maxLeverageX100: 200,
    });
  });

  it.each([
    ["NONE", 300],
    ["ISOLATED", 300],
    ["DEVELOPING", 100],
    ["ACTIVE", 0],
  ] as const)(
    "preserves %s contagion and applies its policy cap",
    (status, leverage) => {
      const decision = buildRiskPolicyDecision(makeEcosystem(10, 10), status);
      expect(decision.contagionState).toBe(status);
      expect(decision.maxLeverageX100).toBe(leverage);
    },
  );

  it("uses the oldest contributing market-risk timestamp", () => {
    const ecosystem = makeEcosystem();
    const older = "2026-10-07T23:59:40.000Z";
    ecosystem.venueSnapshots[0]!.state.metadata.observedAt = older;
    ecosystem.venueSnapshots[0]!.state.metadata.sourceUpdatedAt = older;
    const decision = buildRiskPolicyDecision(ecosystem, "NONE");
    expect(decision.observedAt).toBe(Math.floor(Date.parse(older) / 1000));
  });

  it("maps identical inputs deterministically and rejects an asset mismatch", () => {
    const ecosystem = makeEcosystem(20, 40, 35);
    expect(buildRiskPolicyDecision(ecosystem, "DEVELOPING")).toEqual(
      buildRiskPolicyDecision(ecosystem, "DEVELOPING"),
    );
    ecosystem.asset = "BTC";
    expect(() => buildRiskPolicyDecision(ecosystem, "NONE")).toThrow(
      /asset does not match/,
    );
  });

  it("recovers leverage policy as fresh risk scores move from critical back to low", () => {
    const ecosystem = makeEcosystem(90, 20);
    const recovered = [
      [90, 0],
      [60, 100],
      [40, 200],
      [10, 300],
    ] as const;
    for (const [score, expectedCap] of recovered) {
      ecosystem.venueSnapshots[0]!.risk = makeRisk(score);
      expect(buildRiskPolicyDecision(ecosystem, "NONE").maxLeverageX100).toBe(
        expectedCap,
      );
    }
  });

  it.each(["velocity", "phoenix"] as const)(
    "rejects a missing %s result",
    (missingVenue) => {
      const ecosystem = makeEcosystem();
      ecosystem.venueSnapshots = ecosystem.venueSnapshots.filter(
        (snapshot) => snapshot.venue !== missingVenue,
      );
      expect(() => buildRiskPolicyDecision(ecosystem, "NONE")).toThrow(
        new RegExp(missingVenue),
      );
    },
  );

  it("rejects missing market risk or stale source data instead of producing permissive policy", () => {
    const noRisk = makeEcosystem();
    noRisk.venueSnapshots[0]!.risk = null;
    expect(() => buildRiskPolicyDecision(noRisk, "NONE")).toThrow(
      /risk is unavailable/,
    );

    const stale = makeEcosystem();
    stale.venueSnapshots[1]!.state.metadata.freshness.sourceAgeMs = 16_000;
    expect(() => buildRiskPolicyDecision(stale, "NONE")).toThrow(/stale/);

    const missingMarketId = makeEcosystem();
    missingMarketId.venueSnapshots[0]!.state.market.marketId = null;
    expect(() => buildRiskPolicyDecision(missingMarketId, "NONE")).toThrow(
      /market identity is invalid/,
    );
  });

  it("rejects invalid risk scores from the engine boundary", () => {
    const ecosystem = makeEcosystem();
    ecosystem.venueSnapshots[0]!.risk = makeRisk(101);
    expect(() => buildRiskPolicyDecision(ecosystem, "NONE")).toThrow(
      /valid range/,
    );

    ecosystem.venueSnapshots[0]!.risk = makeRisk(10.5);
    expect(() => buildRiskPolicyDecision(ecosystem, "NONE")).toThrow(
      /valid range/,
    );
  });
});
