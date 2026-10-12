import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "../src/App";

const snapshot = {
  source: "LIVE",
  symbol: "SOL-PERP",
  collectedAt: new Date().toISOString(),
  venues: (["velocity", "phoenix"] as const).map((venue) => ({
    venue,
    status: "unavailable",
    state: null,
    risk: null,
    error: "Feed offline.",
  })),
  ecosystem: null,
  contagion: null,
  policy: {
    status: "unavailable",
    decision: null,
    reason: "Feeds unavailable.",
  },
};

function useFixtureResponse() {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(snapshot), { status: 200 }),
      ),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dashboard", () => {
  it("renders the live ecosystem overview and supported venues", async () => {
    useFixtureResponse();
    render(<App />);
    expect(screen.getByText("Sentinel")).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Ecosystem overview" }),
    ).toBeDefined();
    expect(await screen.findByText("Combined risk unavailable")).toBeDefined();
    expect(screen.getAllByText("Velocity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Phoenix").length).toBeGreaterThan(0);
  });

  it("navigates to the selected market detail view", () => {
    useFixtureResponse();
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Market" })[0]);
    expect(screen.getByRole("heading", { name: /SOL-PERP/ })).toBeDefined();
    expect(screen.getByText("Risk components")).toBeDefined();
    expect(screen.getByText("Top risk drivers")).toBeDefined();
  });

  it("navigates to contagion and shows unavailable state without inventing events", () => {
    useFixtureResponse();
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Contagion" })[0]);
    expect(
      screen.getByRole("heading", { name: "Contagion monitor" }),
    ).toBeDefined();
    expect(screen.getByText("Venue observations")).toBeDefined();
    expect(screen.getByText("Contagion assessment unavailable")).toBeDefined();
  });

  it("opens and closes market search", () => {
    useFixtureResponse();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open market search" }));
    expect(
      screen.getByPlaceholderText("Search markets, venues…"),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open market search" }));
    expect(screen.queryByPlaceholderText("Search markets, venues…")).toBeNull();
  });

  it("marks the active dashboard view accessibly", () => {
    useFixtureResponse();
    render(<App />);
    expect(
      screen.getByRole("navigation", { name: "Dashboard views" }),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole("button", { name: "Ecosystem" })
        .some((button) => button.getAttribute("aria-current") === "page"),
    ).toBe(true);
  });

  it("renders ecosystem risk explanations, divergence breakdown, and methodology with real data", async () => {
    const liveSnapshot = {
      source: "LIVE",
      symbol: "SOL-PERP",
      collectedAt: new Date().toISOString(),
      venues: [
        {
          venue: "velocity",
          status: "available",
          state: {
            market: {
              venue: "velocity",
              symbol: "SOL-PERP",
              marketId: "vel-sol",
              baseAsset: "SOL",
              quoteAsset: "USDC",
            },
            price: {
              lastPrice: 150,
              indexPrice: 150,
              markPrice: 150,
              observedAt: new Date().toISOString(),
            },
            positioning: {
              totalOpenInterest: 50000,
              openInterestUnit: "base",
              longOpenInterest: 25000,
              shortOpenInterest: 25000,
              observedAt: null,
            },
            liquidity: {
              availableLiquidity: 1000000,
              bidSize: 500000,
              askSize: 500000,
              liquidityUnit: "quote",
              bestBidPrice: 149.9,
              bestAskPrice: 150.1,
              observedAt: null,
            },
            funding: { rate: 0.0001, periodSeconds: 3600, observedAt: null },
            liquidation: {
              totalVolume: 12000,
              volumeUnit: "quote",
              intervalSeconds: 3600,
              longVolume: 6000,
              shortVolume: 6000,
              observedAt: null,
            },
            oracle: { price: 150, source: "pyth", observedAt: null },
            metadata: {
              source: "velocity",
              observedAt: new Date().toISOString(),
              collectedAt: new Date().toISOString(),
              sourceUpdatedAt: new Date().toISOString(),
              freshness: { sourceAgeMs: 500, staleAfterMs: 30000 },
            },
          },
          risk: {
            overallScore: 35,
            level: "medium",
            components: {},
            topDrivers: ["Spread elevation"],
            timestamp: new Date().toISOString(),
          },
          error: null,
        },
        {
          venue: "phoenix",
          status: "available",
          state: {
            market: {
              venue: "phoenix",
              symbol: "SOL-PERP",
              marketId: "phx-sol",
              baseAsset: "SOL",
              quoteAsset: "USDC",
            },
            price: {
              lastPrice: 150.2,
              indexPrice: 150,
              markPrice: 150.1,
              observedAt: new Date().toISOString(),
            },
            positioning: {
              totalOpenInterest: 30000,
              openInterestUnit: "base",
              longOpenInterest: 15000,
              shortOpenInterest: 15000,
              observedAt: null,
            },
            liquidity: {
              availableLiquidity: 800000,
              bidSize: 400000,
              askSize: 400000,
              liquidityUnit: "quote",
              bestBidPrice: 149.8,
              bestAskPrice: 150.2,
              observedAt: null,
            },
            funding: { rate: 0.00012, periodSeconds: 3600, observedAt: null },
            liquidation: {
              totalVolume: 5000,
              volumeUnit: "quote",
              intervalSeconds: 3600,
              longVolume: 2500,
              shortVolume: 2500,
              observedAt: null,
            },
            oracle: { price: 150, source: "pyth", observedAt: null },
            metadata: {
              source: "phoenix",
              observedAt: new Date().toISOString(),
              collectedAt: new Date().toISOString(),
              sourceUpdatedAt: new Date().toISOString(),
              freshness: { sourceAgeMs: 500, staleAfterMs: 30000 },
            },
          },
          risk: {
            overallScore: 20,
            level: "low",
            components: {},
            topDrivers: ["Orderbook depth healthy"],
            timestamp: new Date().toISOString(),
          },
          error: null,
        },
      ],
      ecosystem: {
        asset: "SOL",
        timestamp: new Date().toISOString(),
        venueCount: 2,
        ecosystemScore: 28,
        ecosystemLevel: "medium",
        venueSnapshots: [],
        divergence: {
          price: {
            value: 0.13,
            score: 15,
            weight: 1.0,
            contribution: 6,
            driver: "Price divergence: 0.13% CV",
          },
          funding: {
            value: 1.5,
            score: 22,
            weight: 1.0,
            contribution: 9,
            driver: "Funding rate divergence: 1.5% std dev",
          },
          oiConcentration: {
            value: 0.62,
            score: 40,
            weight: 1.2,
            contribution: 13,
            driver: "OI concentration: Velocity holds 62.5%",
          },
          liquiditySpread: {
            value: 0.02,
            score: 10,
            weight: 0.8,
            contribution: 4,
            driver: "Liquidity spread divergence: 0.02%",
          },
          liquidationConcentration: null,
        },
        riskDrivers: ["OI concentration on Velocity", "Funding divergence"],
      },
      contagion: {
        status: "NONE",
        severity: "low",
        affectedVenues: [],
        drivers: [],
        timestamp: new Date().toISOString(),
      },
      policy: {
        status: "available",
        decision: {
          riskLevel: "medium",
          riskScore: 35,
          contagionState: "NONE",
          maxLeverageX100: 200,
          observedAt: 1700000000,
        },
        reason: null,
      },
    };

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(liveSnapshot), { status: 200 }),
        ),
    );

    render(<App />);

    // 1. Ecosystem Risk Explanation & why scores differ
    expect(
      await screen.findByText(/Understanding Ecosystem Risk vs. Market Risk/),
    ).toBeDefined();
    expect(screen.getByText(/Why the scores differ:/)).toBeDefined();
    expect(
      screen.getAllByText(/Effective policy risk:/).length,
    ).toBeGreaterThan(0);

    // 2. Per-venue market risk comparison with real scores and classifications
    expect(await screen.findByText("Per-venue market risk")).toBeDefined();
    expect(screen.getAllByText("35").length).toBeGreaterThan(0);
    expect(screen.getAllByText("20").length).toBeGreaterThan(0);

    // 3. Cross-venue divergence breakdown with all 5 metrics
    expect(
      screen.getByText("Cross-venue divergence breakdown"),
    ).toBeDefined();
    expect(screen.getByText("Price divergence")).toBeDefined();
    expect(
      screen.getAllByText("Funding divergence").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("OI concentration")).toBeDefined();
    expect(screen.getByText("Liquidity spread")).toBeDefined();
    expect(screen.getByText("Liquidation concentration")).toBeDefined();

    // Verify drivers and structured metric fields
    expect(screen.getByText("Price divergence: 0.13% CV")).toBeDefined();
    expect(
      screen.getByText("OI concentration: Velocity holds 62.5%"),
    ).toBeDefined();

    // 4. Missing data handling (Liquidation concentration is null -> displays N/A)
    const liquidationHeading = screen.getByText("Liquidation concentration");
    const row = liquidationHeading.closest(".divergence-row");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("N/A");

    // 5. Calculation Methodology
    expect(
      screen.getByText("Calculation methodology & weighting"),
    ).toBeDefined();
    expect(screen.getByText("Threshold Interpolation")).toBeDefined();
    expect(screen.getByText("Weighted-Average Aggregation")).toBeDefined();
    expect(screen.getByText("Configured Weights")).toBeDefined();
  });
});
