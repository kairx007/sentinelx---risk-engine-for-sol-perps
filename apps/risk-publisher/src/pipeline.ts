import { PhoenixAdapter } from "@perps-risk/adapter-phoenix";
import { VelocityAdapter } from "@perps-risk/adapter-velocity";
import {
  assetKey,
  buildRiskPolicyDecision,
  buildVenueSnapshot,
  calculateContagionRisk,
  calculateEcosystemRisk,
} from "@perps-risk/cross-venue";
import type {
  RiskPolicyDecision,
  VenueSnapshot,
} from "@perps-risk/cross-venue";
import type { MarketState } from "@perps-risk/types";

export interface MarketReaders {
  velocity: { getMarketState(symbol: string): Promise<MarketState> };
  phoenix: { getMarketState(symbol: string): Promise<MarketState> };
}

export interface PipelineResult {
  asset: string;
  snapshots: VenueSnapshot[];
  decision: RiskPolicyDecision;
}

export type StructuredLogger = (
  event: string,
  fields: Record<string, unknown>,
) => void;

export async function calculateCurrentPolicy(
  readers: MarketReaders,
  symbol: string,
  log: StructuredLogger = (event, fields) =>
    console.log(JSON.stringify({ event, ...fields })),
): Promise<PipelineResult> {
  const venues = ["velocity", "phoenix"] as const;
  const results = await Promise.allSettled(
    venues.map((venue) => readers[venue].getMarketState(symbol)),
  );
  const states: MarketState[] = [];
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    const venue = venues[index]!;
    if (result.status === "rejected") {
      log("market_collection_failed", {
        venue,
        symbol,
        error: String(result.reason),
      });
      throw new Error(
        `${venue} market collection failed; refusing to publish a partial policy`,
        { cause: result.reason },
      );
    }
    const state = result.value;
    if (
      state.market.venue !== venue ||
      state.market.symbol.trim().length === 0 ||
      !state.market.marketId
    ) {
      log("market_state_rejected", {
        venue,
        symbol,
        reason: "invalid market identity",
      });
      throw new Error(`${venue} returned an invalid canonical market identity`);
    }
    states.push(state);
  }

  const [velocity, phoenix] = states;
  if (!velocity || !phoenix || assetKey(velocity) !== assetKey(phoenix)) {
    throw new Error(
      "Velocity and Phoenix states do not identify the same base asset",
    );
  }

  const asset = assetKey(velocity);
  let snapshots: VenueSnapshot[];
  let decision: RiskPolicyDecision;
  try {
    snapshots = states.map(buildVenueSnapshot);
    const ecosystem = calculateEcosystemRisk(asset, snapshots);
    const contagion = calculateContagionRisk(asset, snapshots);
    decision = buildRiskPolicyDecision(ecosystem, contagion.status);
  } catch (error) {
    log("risk_calculation_failed", {
      asset,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  log("risk_policy_generated", {
    asset,
    riskLevel: decision.riskLevel,
    riskScore: decision.riskScore,
    contagionState: decision.contagionState,
    maxLeverageX100: decision.maxLeverageX100,
    observedAt: decision.observedAt,
  });
  return { asset, snapshots, decision };
}

export function createDefaultMarketReaders(options: {
  marketRpcUrl: string;
  phoenixApiUrl?: string;
}): MarketReaders {
  return {
    velocity: new VelocityAdapter({
      rpcUrl: options.marketRpcUrl,
      env: "mainnet-beta",
    }),
    phoenix: new PhoenixAdapter(
      options.phoenixApiUrl ? { apiUrl: options.phoenixApiUrl } : {},
    ),
  };
}
