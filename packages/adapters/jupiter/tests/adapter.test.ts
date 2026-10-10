import { MarketStateSchema } from "@perps-risk/types";
import { describe, expect, it, vi } from "vitest";
import { JupiterAdapter } from "../src/adapter.js";
import { createJupiterMarketReader } from "../src/reader.js";
import {
  JUPITER_PERP_MARKETS,
  type JupiterMarketReader,
} from "../src/types.js";

describe("JupiterAdapter", () => {
  it("maps documented stats and leaves absent fields unavailable", async () => {
    const marketReader: JupiterMarketReader = {
      readMarketStats: vi.fn().mockResolvedValue({
        price: "152.38",
        priceChange24H: "2.35",
        priceHigh24H: "154.00",
        priceLow24H: "148.00",
        volume: "1250000",
      }),
    };
    const adapter = new JupiterAdapter({
      readerFactory: () => marketReader,
      now: () => new Date("2026-10-05T10:00:00.000Z"),
    });

    const state = await adapter.getMarketState("sol-perp");

    expect(MarketStateSchema.safeParse(state).success).toBe(true);
    expect(state.market).toMatchObject({
      venue: "jupiter",
      symbol: "SOL-PERP",
      marketId: JUPITER_PERP_MARKETS.SOL,
      baseAsset: "SOL",
      quoteAsset: "USD",
    });
    expect(state.price).toEqual({
      lastPrice: 152.38,
      indexPrice: null,
      markPrice: null,
      observedAt: null,
    });
    expect(state.funding.rate).toBeNull();
    expect(state.positioning.totalOpenInterest).toBeNull();
    expect(state.liquidity.bestBidPrice).toBeNull();
    expect(state.liquidation.totalVolume).toBeNull();
    expect(state.metadata.freshness.sourceAgeMs).toBeNull();
    expect(marketReader.readMarketStats).toHaveBeenCalledWith(
      JUPITER_PERP_MARKETS.SOL,
    );
  });

  it("rejects unknown markets", async () => {
    const readMarketStats = vi.fn();
    const adapter = new JupiterAdapter({
      readerFactory: () => ({ readMarketStats }),
    });

    await expect(adapter.getMarketState("DOGE")).rejects.toThrow(
      'Jupiter perp market not found for symbol "DOGE"',
    );
    expect(readMarketStats).not.toHaveBeenCalled();
  });
});

describe("createJupiterMarketReader", () => {
  it("requests market-stats for the specified mint and validates the response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          price: "150",
          priceChange24H: "1",
          priceHigh24H: "151",
          priceLow24H: "148",
          volume: "1000",
        }),
        { status: 200 },
      ),
    );
    const reader = createJupiterMarketReader({
      apiUrl: "https://api.example.test/v2/",
      fetch: fetcher,
    });

    await expect(
      reader.readMarketStats(JUPITER_PERP_MARKETS.BTC),
    ).resolves.toMatchObject({
      price: "150",
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        `https://api.example.test/v2/market-stats?mint=${JUPITER_PERP_MARKETS.BTC}`,
      ),
    );
  });

  it("rejects malformed responses and non-success status", async () => {
    const malformed = createJupiterMarketReader({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ price: 100 }), { status: 200 }),
        ),
    });
    await expect(
      malformed.readMarketStats(JUPITER_PERP_MARKETS.SOL),
    ).rejects.toThrow("invalid market stats response");

    const failed = createJupiterMarketReader({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 503 })),
    });
    await expect(
      failed.readMarketStats(JUPITER_PERP_MARKETS.SOL),
    ).rejects.toThrow("request failed (503)");
  });
});
