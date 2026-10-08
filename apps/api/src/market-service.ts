import { PhoenixAdapter } from "@perps-risk/adapter-phoenix";
import { VelocityAdapter } from "@perps-risk/adapter-velocity";
import {
  assetKey,
  buildVenueSnapshot,
  calculateContagionRisk,
  calculateEcosystemRisk,
} from "@perps-risk/cross-venue";
import type { ContagionRisk, EcosystemRisk, VenueSnapshot } from "@perps-risk/cross-venue";
import type { MarketRisk } from "@perps-risk/risk";
import type { MarketState } from "@perps-risk/types";
import { ApiError } from "./errors.js";

export type ApiVenue = "velocity" | "phoenix";

export interface MarketStateReader {
  getMarketState(symbol: string): Promise<MarketState>;
}

export interface RiskEngine {
  buildVenueSnapshot: typeof buildVenueSnapshot;
  calculateEcosystemRisk: typeof calculateEcosystemRisk;
  calculateContagionRisk: typeof calculateContagionRisk;
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
}

const defaultEngine: RiskEngine = {
  buildVenueSnapshot,
  calculateEcosystemRisk,
  calculateContagionRisk,
};

function createDefaultAdapters(): Record<ApiVenue, MarketStateReader> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
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

  async function fetchState(venue: ApiVenue, symbol: string): Promise<MarketState> {
    try {
      return await dependencies.adapters[venue].getMarketState(symbol);
    } catch (error) {
      if (isMarketNotFound(error)) {
        throw new ApiError(404, "MARKET_NOT_FOUND", `Market ${symbol} was not found on ${venue}.`);
      }
      throw new ApiError(503, "VENUE_UNAVAILABLE", `${venue} market data is unavailable.`);
    }
  }

  async function fetchBoth(symbol: string): Promise<[MarketState, MarketState]> {
    const [velocity, phoenix] = await Promise.all([
      fetchState("velocity", symbol),
      fetchState("phoenix", symbol),
    ]);
    return [velocity, phoenix];
  }

  function buildSnapshots(states: MarketState[]): VenueSnapshot[] {
    return states.map((state) => engine.buildVenueSnapshot(state));
  }

  return {
    getMarketState: fetchState,
    async getMarketRisk(venue, symbol) {
      return (await engine.buildVenueSnapshot(await fetchState(venue, symbol))).risk!;
    },
    async getEcosystemRisk(symbol) {
      const states = await fetchBoth(symbol);
      return engine.calculateEcosystemRisk(assetKey(states[0]), buildSnapshots(states));
    },
    async getContagionRisk(symbol) {
      const states = await fetchBoth(symbol);
      return engine.calculateContagionRisk(assetKey(states[0]), buildSnapshots(states));
    },
  };
}

export function createDefaultMarketService(): MarketService {
  return createMarketService({ adapters: createDefaultAdapters() });
}