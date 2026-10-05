import type { ExchangeMarketConfig } from "@ellipsis-labs/rise";
import { MarketStateSchema } from "@perps-risk/types";
import { describe, expect, it, vi } from "vitest";
import { PhoenixAdapter } from "./adapter.js";
import type { PhoenixMarketReader } from "./types.js";

const market = {
  symbol: "SOL-PERP",
  assetId: 7,
  fundingPeriodSeconds: 3600,
  baseLotsDecimals: 2,
  statsSnapshot: { openInterestBaseLots: "12500" },
} as ExchangeMarketConfig;

function reader(): PhoenixMarketReader {
  return {
    getMarkets: vi.fn().mockResolvedValue([market]),
    readSnapshot: vi.fn().mockResolvedValue({
      market,
      stats: {
        symbol: "SOL-PERP",
        timestamp_ms: 1_791_194_400_000n,
        mark_price: 152.41,
        oracle_price: 152.38,
        prev_day_mark_price: 150,
        open_interest: 1000,
        day_volume_usd: 1_000_000,
        day_volume_base: 6500,
        current_funding_rate: 0.0001,
        eight_hour_funding_rate: 0.0008,
        annualized_funding_rate: 0.1095,
      },
      orderbook: {
        slot: 10,
        symbol: "SOL-PERP",
        bids: [[152.4, 8]],
        asks: [[152.43, 9]],
      },
    }),
  };
}

describe("PhoenixAdapter", () => {
  it("maps fresh Rise market data into the canonical schema", async () => {
    const marketReader = reader();
    const adapter = new PhoenixAdapter({
      readerFactory: () => marketReader,
      now: () => new Date("2026-10-05T10:00:01.000Z"),
    });

    const state = await adapter.getMarketState("sol");

    expect(MarketStateSchema.safeParse(state).success).toBe(true);
    expect(state.market).toMatchObject({
      venue: "phoenix",
      symbol: "SOL-PERP",
      marketId: "7",
      baseAsset: "SOL",
      quoteAsset: "USDC",
    });
    expect(state.price).toMatchObject({
      lastPrice: null,
      indexPrice: 152.38,
      markPrice: 152.41,
    });
    expect(state.liquidity).toMatchObject({
      bestBidPrice: 152.4,
      bestAskPrice: 152.43,
      bidSize: 8,
      askSize: 9,
      liquidityUnit: "base",
    });
    expect(state.funding).toMatchObject({
      rate: 0.0001,
      periodSeconds: 3600,
      observedAt: "2026-10-05T10:00:00.000Z",
    });
    expect(state.positioning).toMatchObject({
      totalOpenInterest: 125,
      openInterestUnit: "base",
      longOpenInterest: null,
      shortOpenInterest: null,
    });
    expect(state.liquidation.totalVolume).toBeNull();
    expect(state.metadata.freshness.sourceAgeMs).toBe(1000);
    expect(marketReader.readSnapshot).toHaveBeenCalledWith("SOL-PERP");
  });

  it("rejects unlisted market symbols", async () => {
    const marketReader = reader();
    const adapter = new PhoenixAdapter({ readerFactory: () => marketReader });

    await expect(adapter.getMarketState("BTC")).rejects.toThrow(
      'Phoenix perp market not found for symbol "BTC"',
    );
    expect(marketReader.readSnapshot).not.toHaveBeenCalled();
  });

  it("rejects invalid staleness configuration", () => {
    expect(() => new PhoenixAdapter({ staleAfterMs: 0 })).toThrow(
      "staleAfterMs must be a positive safe integer",
    );
  });
});
