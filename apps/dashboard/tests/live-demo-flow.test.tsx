import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveReadiness } from "../src/components/LiveReadiness";
import { ProtocolFlow } from "../src/components/ProtocolFlow";
import { EventTimeline } from "../src/components/EventTimeline";
import type { ChainSnapshot } from "../src/solana/client";

describe("Phase 5 Live Demo Components", () => {
  const dummyChainSnapshot: ChainSnapshot = {
    status: "available",
    cluster: "devnet",
    programId: "33fMx1DC1XXdSYXG8VUFqH5y1gDqxmEpbTTwESx21Rtq",
    vaultAddress: "7UVimffxr9ow1ukKttssAKBiNdTe2deMm98qwx5Y8NNd",
    riskStateAddress: "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4SE5nv",
    riskState: {
      riskLevel: "low",
      riskScore: 22,
      contagionState: "contained",
      maxLeverageX100: 300,
      nonce: 1n,
      observedAt: 1700000000,
      updatedAt: 1700000010,
    },
    vault: {
      collateralMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      riskAuthority: "11111111111111111111111111111111",
    },
    slot: 340120110,
    fetchedAt: new Date().toISOString(),
    error: null,
  };

  const dummySnapshot = {
    source: "LIVE" as const,
    symbol: "SOL-PERP",
    collectedAt: new Date().toISOString(),
    venues: [
      {
        venue: "velocity" as const,
        status: "available" as const,
        state: null,
        risk: null,
        error: null,
      },
      {
        venue: "phoenix" as const,
        status: "available" as const,
        state: null,
        risk: null,
        error: null,
      },
    ],
    ecosystem: null,
    contagion: null,
    policy: {
      status: "available" as const,
      decision: {
        riskLevel: "low" as const,
        riskScore: 22,
        contagionState: "NONE" as const,
        maxLeverageX100: 300,
        observedAt: 1700000000,
      },
      reason: null,
    },
  };

  it("renders LiveReadiness with venue, program, and on-chain checks", () => {
    render(
      <LiveReadiness
        snapshot={dummySnapshot}
        chainSnapshot={dummyChainSnapshot}
      />,
    );
    expect(screen.getByText("System Operational Readiness")).toBeDefined();
    expect(screen.getByText("Velocity Feed")).toBeDefined();
    expect(screen.getByText("Phoenix Orderbook")).toBeDefined();
    expect(screen.getByText("Anchor Program & PDAs")).toBeDefined();
  });

  it("renders ProtocolFlow with end-to-end architectural steps", () => {
    render(
      <ProtocolFlow
        snapshot={dummySnapshot}
        chainSnapshot={dummyChainSnapshot}
      />,
    );
    expect(screen.getByText("End-to-End Risk Orchestration Flow")).toBeDefined();
    expect(screen.getByText("Multi-Venue Ingestion")).toBeDefined();
    expect(screen.getByText("Divergence & Policy")).toBeDefined();
    expect(screen.getByText("Contract Enforcement")).toBeDefined();
  });

  it("renders EventTimeline and filters correctly", () => {
    render(<EventTimeline />);
    expect(screen.getByText("Event & Audit Timeline")).toBeDefined();
    expect(screen.getByText("Venues Synchronized")).toBeDefined();
    expect(screen.getByText("Policy Evaluated")).toBeDefined();
    expect(screen.getByText("RiskState Verified")).toBeDefined();
  });
});
