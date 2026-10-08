import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContagionRisk, EcosystemRisk, VenueSnapshot } from "@perps-risk/cross-venue";
import type { MarketRisk } from "@perps-risk/risk";
import { MarketStateSchema, type MarketState } from "@perps-risk/types";
import { createApiApp } from "../src/app.js";
import { createMarketService } from "../src/market-service.js";

const marketRisk: MarketRisk = {
  overallScore: 12,
  level: "low",
  components: {},
  topDrivers: [],
  timestamp: "2026-10-08T00:00:00.000Z",
};

function makeState(venue: "velocity" | "phoenix", symbol = "SOL-PERP"): MarketState {
  return MarketStateSchema.parse({
    market: { venue, symbol, marketId: null, baseAsset: "SOL", quoteAsset: "USDC" },
    price: { lastPrice: 100, indexPrice: 100, markPrice: 100, observedAt: null },
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
      source: `${venue}-test`,
      observedAt: null,
      collectedAt: "2026-10-08T00:00:00.000Z",
      sourceUpdatedAt: null,
      freshness: { sourceAgeMs: null, staleAfterMs: 15_000 },
    },
  });
}

function makeSnapshot(state: MarketState): VenueSnapshot {
  return {
    venue: state.market.venue,
    symbol: state.market.symbol,
    state,
    risk: marketRisk,
    metrics: {
      price: state.price.markPrice,
      oi: state.positioning.totalOpenInterest,
      longOi: state.positioning.longOpenInterest,
      shortOi: state.positioning.shortOpenInterest,
      funding: state.funding.rate,
      fundingPeriod: state.funding.periodSeconds,
      spread: null,
      liquidations: state.liquidation.totalVolume,
    },
  };
}

describe("API", () => {
  let server: Server;
  let baseUrl: string;
  let velocityState: MarketState;
  let phoenixState: MarketState;
  let velocityGet: ReturnType<typeof vi.fn>;
  let phoenixGet: ReturnType<typeof vi.fn>;
  let buildSnapshot: ReturnType<typeof vi.fn>;
  let ecosystemCalculation: ReturnType<typeof vi.fn>;
  let contagionCalculation: ReturnType<typeof vi.fn>;
  let ecosystemResult: EcosystemRisk;
  let contagionResult: ContagionRisk;
  let internalErrorLog: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(async () => {
    velocityState = makeState("velocity");
    phoenixState = makeState("phoenix");
    velocityGet = vi.fn(async () => velocityState);
    phoenixGet = vi.fn(async () => phoenixState);
    buildSnapshot = vi.fn((state: MarketState) => makeSnapshot(state));
    ecosystemResult = {
      asset: "SOL",
      timestamp: "2026-10-08T00:00:00.000Z",
      venueCount: 2,
      ecosystemScore: 12,
      ecosystemLevel: "low",
      venueSnapshots: [makeSnapshot(velocityState), makeSnapshot(phoenixState)],
      divergence: {
        price: null,
        funding: null,
        oiConcentration: null,
        liquiditySpread: null,
        liquidationConcentration: null,
      },
      riskDrivers: [],
    };
    contagionResult = {
      status: "NONE",
      severity: "low",
      affectedVenues: [],
      drivers: [],
      timestamp: "2026-10-08T00:00:00.000Z",
    };
    ecosystemCalculation = vi.fn((_asset: string, snapshots: VenueSnapshot[]) => ({
      ...ecosystemResult,
      venueSnapshots: snapshots,
    }));
    contagionCalculation = vi.fn(() => contagionResult);

    const service = createMarketService({
      adapters: {
        velocity: { getMarketState: velocityGet },
        phoenix: { getMarketState: phoenixGet },
      },
      engine: {
        buildVenueSnapshot: buildSnapshot,
        calculateEcosystemRisk: ecosystemCalculation,
        calculateContagionRisk: contagionCalculation,
      },
    });
    server = createApiApp(service).listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    internalErrorLog?.mockRestore();
    internalErrorLog = undefined;
  });

  it("returns health without fetching venue data", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(velocityGet).not.toHaveBeenCalled();
    expect(phoenixGet).not.toHaveBeenCalled();
  });

  it("rejects /markets without venue", async () => {
    expect((await fetch(`${baseUrl}/markets?symbol=SOL-PERP`)).status).toBe(400);
  });

  it("rejects /markets without symbol", async () => {
    expect((await fetch(`${baseUrl}/markets?venue=velocity`)).status).toBe(400);
  });

  it("rejects unsupported API venues", async () => {
    const response = await fetch(`${baseUrl}/markets?venue=drift&symbol=SOL-PERP`);
    expect(response.status).toBe(400);
    expect(velocityGet).not.toHaveBeenCalled();
  });

  it("returns exactly one canonical state from the selected venue", async () => {
    const response = await fetch(`${baseUrl}/markets?venue=velocity&symbol=SOL-PERP`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([velocityState]);
    expect(velocityGet).toHaveBeenCalledWith("SOL-PERP");
    expect(phoenixGet).not.toHaveBeenCalled();
  });

  it("returns one valid canonical state for the Phoenix query endpoint", async () => {
    const response = await fetch(`${baseUrl}/markets?venue=phoenix&symbol=SOL-PERP`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(1);
    expect(MarketStateSchema.safeParse(body[0]).success).toBe(true);
    expect(body).toEqual([phoenixState]);
    expect(phoenixGet).toHaveBeenCalledWith("SOL-PERP");
    expect(velocityGet).not.toHaveBeenCalled();
  });

  it("returns a canonical state for the path market endpoint", async () => {
    const response = await fetch(`${baseUrl}/markets/phoenix/SOL-PERP`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(phoenixState);
    expect(phoenixGet).toHaveBeenCalledWith("SOL-PERP");
  });

  it("returns MarketRisk through buildVenueSnapshot", async () => {
    const response = await fetch(`${baseUrl}/markets/velocity/SOL-PERP/risk`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(marketRisk);
    expect(buildSnapshot).toHaveBeenCalledWith(velocityState);
  });

  it("fetches both venues and delegates ecosystem risk", async () => {
    const response = await fetch(`${baseUrl}/ecosystem/risk?symbol=SOL-PERP`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ asset: "SOL", venueCount: 2 });
    expect(velocityGet).toHaveBeenCalledWith("SOL-PERP");
    expect(phoenixGet).toHaveBeenCalledWith("SOL-PERP");
    expect(buildSnapshot).toHaveBeenCalledTimes(2);
    expect(ecosystemCalculation).toHaveBeenCalledWith("SOL", [
      makeSnapshot(velocityState),
      makeSnapshot(phoenixState),
    ]);
  });

  it("fetches both venues and delegates contagion risk", async () => {
    const response = await fetch(`${baseUrl}/ecosystem/contagion?symbol=SOL-PERP`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(contagionResult);
    expect(contagionCalculation).toHaveBeenCalledWith("SOL", [
      makeSnapshot(velocityState),
      makeSnapshot(phoenixState),
    ]);
  });

  it("preserves null optional metrics", async () => {
    const response = await fetch(`${baseUrl}/markets/phoenix/SOL-PERP`);
    expect(response.status).toBe(200);
    expect((await response.json()).liquidation.totalVolume).toBeNull();
  });

  it("returns 503 when a venue fetch fails", async () => {
    velocityGet.mockRejectedValueOnce(new Error("RPC unavailable"));
    const response = await fetch(`${baseUrl}/ecosystem/risk?symbol=SOL-PERP`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "VENUE_UNAVAILABLE" } });
    expect(buildSnapshot).not.toHaveBeenCalled();
  });

  it("returns 404 when a market is not found", async () => {
    velocityGet.mockRejectedValueOnce(new Error('Velocity perp market not found for symbol "NOPE"'));
    const response = await fetch(`${baseUrl}/markets/velocity/NOPE`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "MARKET_NOT_FOUND" } });
  });

  it("returns a safe 500 response for unexpected calculation errors", async () => {
    buildSnapshot.mockImplementationOnce(() => {
      throw new Error("private internal detail");
    });
    internalErrorLog = vi.spyOn(console, "error").mockImplementation(() => { });
    const response = await fetch(`${baseUrl}/markets/velocity/SOL-PERP/risk`);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "Internal server error." },
    });
    expect(JSON.stringify(body)).not.toContain("private internal detail");
  });

  it("returns JSON 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/unknown`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
