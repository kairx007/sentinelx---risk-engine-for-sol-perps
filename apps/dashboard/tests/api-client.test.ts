import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardApiError, fetchDashboardSnapshot } from "../src/api/client";

const state = (venue: "velocity" | "phoenix") => ({
  market: {
    venue,
    symbol: "SOL-PERP",
    marketId: venue,
    baseAsset: "SOL",
    quoteAsset: "USDC",
  },
  price: { lastPrice: 100, indexPrice: 100, markPrice: 100, observedAt: null },
  positioning: {
    longOpenInterest: null,
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
    freshness: { sourceAgeMs: 0, staleAfterMs: 15000 },
  },
});
const snapshot = {
  source: "LIVE",
  symbol: "SOL-PERP",
  collectedAt: "2026-10-09T00:00:00.000Z",
  venues: (["velocity", "phoenix"] as const).map((venue) => ({
    venue,
    status: "available",
    state: state(venue),
    risk: {
      overallScore: 0,
      level: "low",
      components: {},
      topDrivers: [],
      timestamp: "2026-10-09T00:00:00.000Z",
    },
    error: null,
  })),
  ecosystem: null,
  contagion: null,
  policy: { status: "unavailable", decision: null, reason: "Unavailable" },
};

afterEach(() => vi.unstubAllGlobals());

describe("dashboard API client", () => {
  it("encodes the requested symbol and validates a snapshot response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(snapshot), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const result = await fetchDashboardSnapshot(
      "SOL / PERP",
      controller.signal,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/dashboard/snapshot?symbol=SOL%20%2F%20PERP",
    );
    expect(result.source).toBe("LIVE");
    expect(result.venues[0]?.state?.positioning.totalOpenInterest).toBe(0);
  });

  it("rejects a malformed snapshot instead of rendering unvalidated data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response('{"source":"DEMO"}', { status: 200 })),
    );
    await expect(
      fetchDashboardSnapshot("SOL-PERP", new AbortController().signal),
    ).rejects.toThrow(/expected snapshot format/i);
  });

  it("surfaces the API error message for non-success responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "Venue unavailable." } }),
            { status: 503 },
          ),
        ),
    );
    await expect(
      fetchDashboardSnapshot("SOL-PERP", new AbortController().signal),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DashboardApiError>>({
        message: "Venue unavailable.",
        status: 503,
      }),
    );
  });
});
