import { PhoenixAdapter } from "@perps-risk/adapter-phoenix";
import { VelocityAdapter } from "@perps-risk/adapter-velocity";
import {
  assetKey,
  buildVenueSnapshot,
  calculateContagionRisk,
  calculateEcosystemRisk,
  buildRiskPolicyDecision,
} from "@perps-risk/cross-venue";
import type {
  ContagionRisk,
  EcosystemRisk,
  VenueSnapshot,
} from "@perps-risk/cross-venue";
import type { MarketRisk } from "@perps-risk/risk";
import type { MarketState } from "@perps-risk/types";
import type { DashboardSnapshot } from "../../../packages/api-contracts/src/dashboard.js";
import { MarketRiskSchema } from "../../../packages/api-contracts/src/market.js";
import { ApiError } from "./errors.js";

export type ApiVenue = "velocity" | "phoenix";

// Perpetual prices quoted in dollar-pegged assets are compared in nominal USD.
const usdQuotedAssets = new Set(["USD", "USDC", "USDT"]);

function comparableQuoteAsset(asset: string): string {
  const quote = asset.trim().toUpperCase();
  return usdQuotedAssets.has(quote) ? "USD" : quote;
}

export interface MarketStateReader {
  getMarketState(symbol: string): Promise<MarketState>;
}

export interface RiskEngine {
  buildVenueSnapshot: typeof buildVenueSnapshot;
  calculateEcosystemRisk: typeof calculateEcosystemRisk;
  calculateContagionRisk: typeof calculateContagionRisk;
  buildRiskPolicyDecision?: typeof buildRiskPolicyDecision;
}

export interface MarketServiceDependencies {
  adapters: Record<ApiVenue, MarketStateReader>;
  engine?: RiskEngine;
}

export interface MarketService {
  getMarketState(venue: ApiVenue, symbol: string): Promise<MarketState>;
  getMarketRisk(venue: ApiVenue, symbol: string): Promise<MarketRisk>;
  getEcosystemRisk(symbol: string): Promise<EcosystemRisk>;
  getContagionRisk(symbol: string): Promise<ContagionRisk>;
  getDashboardSnapshot(symbol: string): Promise<DashboardSnapshot>;
}

const defaultEngine: RiskEngine = {
  buildVenueSnapshot,
  calculateEcosystemRisk,
  calculateContagionRisk,
  buildRiskPolicyDecision,
};

function createDefaultAdapters(): Record<ApiVenue, MarketStateReader> {
  const rpcUrl =
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const phoenixApiUrl = process.env.PHOENIX_API_URL;

  return {
    velocity: new VelocityAdapter({ rpcUrl, env: "mainnet-beta" }),
    phoenix: new PhoenixAdapter(phoenixApiUrl ? { apiUrl: phoenixApiUrl } : {}),
  };
}

function isMarketNotFound(error: unknown): boolean {
  return error instanceof Error && /market not found/i.test(error.message);
}

export function createMarketService(
  dependencies: MarketServiceDependencies,
): MarketService {
  const engine = dependencies.engine ?? defaultEngine;

  async function fetchState(
    venue: ApiVenue,
    symbol: string,
  ): Promise<MarketState> {
    try {
      return await dependencies.adapters[venue].getMarketState(symbol);
    } catch (error) {
      if (isMarketNotFound(error)) {
        throw new ApiError(
          404,
          "MARKET_NOT_FOUND",
          `Market ${symbol} was not found on ${venue}.`,
        );
      }
      throw new ApiError(
        503,
        "VENUE_UNAVAILABLE",
        `${venue} market data is unavailable.`,
      );
    }
  }

  async function fetchBoth(
    symbol: string,
  ): Promise<[MarketState, MarketState]> {
    const [velocity, phoenix] = await Promise.all([
      fetchState("velocity", symbol),
      fetchState("phoenix", symbol),
    ]);
    return [velocity, phoenix];
  }

  async function getDashboardSnapshot(
    symbol: string,
  ): Promise<DashboardSnapshot> {
    const venues = await Promise.all(
      (["velocity", "phoenix"] as const).map(async (venue) => {
        try {
          const state =
            await dependencies.adapters[venue].getMarketState(symbol);
          const snapshot = engine.buildVenueSnapshot(state);
          if (!snapshot.risk) throw new Error("Venue risk is unavailable.");
          if (!MarketRiskSchema.safeParse(snapshot.risk).success) {
            return {
              venue,
              status: "invalid" as const,
              state: null,
              risk: null,
              error: "Venue risk result failed validation.",
              snapshot: null,
            };
          }
          const identityValid =
            state.market.venue === venue &&
            state.market.symbol.trim().toUpperCase() ===
              symbol.trim().toUpperCase() &&
            Boolean(state.market.marketId?.trim()) &&
            Boolean(state.market.baseAsset.trim()) &&
            Boolean(state.market.quoteAsset.trim()) &&
            state.metadata.observedAt !== null &&
            Number.isFinite(Date.parse(state.metadata.observedAt));
          if (!identityValid) {
            return {
              venue,
              status: "invalid" as const,
              state,
              risk: snapshot.risk,
              error:
                "Venue market identity or observation timestamp is invalid.",
              snapshot,
            };
          }
          const { sourceAgeMs, staleAfterMs } = state.metadata.freshness;
          const isFresh =
            sourceAgeMs !== null &&
            staleAfterMs !== null &&
            sourceAgeMs <= staleAfterMs;
          return {
            venue,
            status: isFresh ? ("available" as const) : ("stale" as const),
            state,
            risk: snapshot.risk,
            error: isFresh
              ? null
              : "Source observation is stale or freshness is unknown.",
            snapshot,
          };
        } catch (error) {
          const message = isMarketNotFound(error)
            ? `Market ${symbol} was not found on ${venue}.`
            : `${venue} market data is unavailable.`;
          return {
            venue,
            status: "unavailable" as const,
            state: null,
            risk: null,
            error: message,
            snapshot: null,
          };
        }
      }),
    );
    const bothAvailable = venues.every(({ status }) => status === "available");
    const sameMarket =
      venues[0]!.state !== null &&
      venues[1]!.state !== null &&
      venues[0]!.state.market.baseAsset.trim().toUpperCase() ===
        venues[1]!.state.market.baseAsset.trim().toUpperCase() &&
      comparableQuoteAsset(venues[0]!.state.market.quoteAsset) ===
        comparableQuoteAsset(venues[1]!.state.market.quoteAsset);
    const statesFresh = bothAvailable && sameMarket;
    let ecosystem: EcosystemRisk | null = null;
    let contagion: ContagionRisk | null = null;
    let policy: DashboardSnapshot["policy"] = {
      status: "unavailable",
      decision: null,
      reason: venues.some(({ status }) => status === "unavailable")
        ? "One or more venue feeds are unavailable."
        : venues.some(({ status }) => status === "invalid")
          ? "One or more venue observations failed identity or schema validation."
          : venues.some(({ status }) => status === "stale")
            ? "Venue observations are stale or freshness is unknown."
            : !sameMarket
              ? "Venue market identities do not match."
              : "Combined risk inputs are unavailable.",
    };

    if (statesFresh) {
      const snapshots = venues.map(({ snapshot }) => snapshot!);
      const asset = assetKey(snapshots[0]!.state);
      ecosystem = engine.calculateEcosystemRisk(asset, snapshots);
      contagion = engine.calculateContagionRisk(asset, snapshots);
      try {
        if (!engine.buildRiskPolicyDecision)
          throw new Error("Policy calculation is unavailable.");
        policy = {
          status: "available",
          decision: engine.buildRiskPolicyDecision(ecosystem, contagion.status),
          reason: null,
        };
      } catch (error) {
        policy = {
          status: "unavailable",
          decision: null,
          reason:
            error instanceof Error
              ? error.message
              : "Policy inputs are unavailable.",
        };
      }
    }

    return {
      source: "LIVE",
      symbol,
      collectedAt: new Date().toISOString(),
      venues: venues.map(({ venue, status, state, risk, error }) => ({
        venue,
        status,
        state,
        risk,
        error,
      })),
      ecosystem,
      contagion,
      policy,
    };
  }

  function buildSnapshots(states: MarketState[]): VenueSnapshot[] {
    return states.map((state) => engine.buildVenueSnapshot(state));
  }

  return {
    getMarketState: fetchState,
    async getMarketRisk(venue, symbol) {
      return (await engine.buildVenueSnapshot(await fetchState(venue, symbol)))
        .risk!;
    },
    async getEcosystemRisk(symbol) {
      const states = await fetchBoth(symbol);
      return engine.calculateEcosystemRisk(
        assetKey(states[0]),
        buildSnapshots(states),
      );
    },
    async getContagionRisk(symbol) {
      const states = await fetchBoth(symbol);
      return engine.calculateContagionRisk(
        assetKey(states[0]),
        buildSnapshots(states),
      );
    },
    getDashboardSnapshot,
  };
}

export function createDefaultMarketService(): MarketService {
  return createMarketService({ adapters: createDefaultAdapters() });
}
