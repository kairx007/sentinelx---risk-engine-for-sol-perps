import { describe, expect, it } from "vitest";
import { DashboardSnapshotSchema } from "../src/dashboard.js";

const marketState = (venue: "velocity" | "phoenix") => ({
  market: {
    venue,
    symbol: "SOL-PERP",
    marketId: venue,
    baseAsset: "SOL",
    quoteAsset: "USDC",
  },
  price: { lastPrice: 100, indexPrice: 100, markPrice: 100, observedAt: null },
  positioning: {
    longOpenInterest: 0,
    shortOpenInterest: null,
    totalOpenInterest: 0,
    openInterestUnit: "quote",
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
    source: venue,
    observedAt: "2026-10-09T00:00:00.000Z",
    collectedAt: "2026-10-09T00:00:00.000Z",
    sourceUpdatedAt: null,
    freshness: { sourceAgeMs: 0, staleAfterMs: 15_000 },
  },
});

const risk = {
  overallScore: 0,
  level: "low",
  components: {},
  topDrivers: [],
  timestamp: "2026-10-09T00:00:00.000Z",
};
const validSnapshot = () => ({
  source: "LIVE",
  symbol: "SOL-PERP",
  collectedAt: "2026-10-09T00:00:00.000Z",
  venues: ["velocity", "phoenix"].map((venue) => ({
    venue,
    status: "available",
    state: marketState(venue as "velocity" | "phoenix"),
    risk,
    error: null,
  })),
  ecosystem: null,
  contagion: null,
  policy: {
    status: "unavailable",
    decision: null,
    reason: "Incomplete inputs.",
  },
});

describe("dashboard snapshot contract", () => {
  it("accepts nullable metrics and preserves legitimate zero values", () => {
    const parsed = DashboardSnapshotSchema.parse(validSnapshot());
    expect(parsed.venues[0]?.state?.positioning.totalOpenInterest).toBe(0);
    expect(parsed.venues[0]?.state?.funding.rate).toBeNull();
  });

  it("requires both supported venues exactly once", () => {
    const snapshot = validSnapshot();
    snapshot.venues.pop();
    expect(DashboardSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it("rejects an unavailable venue that contains data or lacks an error", () => {
    const snapshot = validSnapshot();
    expect(
      DashboardSnapshotSchema.safeParse({
        ...snapshot,
        venues: [
          {
            venue: "velocity",
            status: "unavailable",
            state: marketState("velocity"),
            risk: null,
            error: null,
          },
          snapshot.venues[1],
        ],
      }).success,
    ).toBe(false);
  });

  it("requires an explicit LIVE source", () => {
    const snapshot = validSnapshot();
    snapshot.source = "DEMO";
    expect(DashboardSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});
