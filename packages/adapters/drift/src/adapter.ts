import { PerpMarkets, type DriftEnv } from "@drift-labs/sdk";
import type { Commitment } from "@solana/web3.js";
import { normalizeDriftMarketSnapshot } from "./normalize.js";
import { createDriftMarketReader } from "./reader.js";
import type {
  DriftAdapterOptions,
  DriftMarketReader,
  DriftReaderFactory,
} from "./types.js";

const DEFAULT_ENV: DriftEnv = "mainnet-beta";
const DEFAULT_COMMITMENT: Commitment = "confirmed";
const DEFAULT_STALE_AFTER_MS = 30_000;

export class DriftAdapter {
  private readonly rpcUrl: string;
  private readonly env: DriftEnv;
  private readonly commitment: Commitment;
  private readonly staleAfterMs: number;
  private readonly readerFactory: DriftReaderFactory;
  private readonly now: () => Date;

  constructor(options: DriftAdapterOptions) {
    let rpcUrl: URL;
    try {
      rpcUrl = new URL(options.rpcUrl);
    } catch {
      throw new Error("Drift adapter requires a valid HTTP(S) RPC URL");
    }
    if (rpcUrl.protocol !== "http:" && rpcUrl.protocol !== "https:") {
      throw new Error("Drift adapter RPC URL must use HTTP or HTTPS");
    }

    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) {
      throw new Error("staleAfterMs must be a positive safe integer");
    }

    this.rpcUrl = options.rpcUrl;
    this.env = options.env ?? DEFAULT_ENV;
    this.commitment = options.commitment ?? DEFAULT_COMMITMENT;
    this.staleAfterMs = staleAfterMs;
    this.readerFactory = options.readerFactory ?? createDriftMarketReader;
    this.now = options.now ?? (() => new Date());
  }

  async getMarketState(symbol: string) {
    const requestedSymbol = symbol.trim().toUpperCase();
    const market = PerpMarkets[this.env].find(
      (candidate) =>
        candidate.symbol.toUpperCase() === requestedSymbol ||
        candidate.baseAssetSymbol.toUpperCase() === requestedSymbol,
    );
    if (!market) {
      throw new Error(`Drift perp market not found for symbol "${symbol}"`);
    }

    const reader: DriftMarketReader = await this.readerFactory(
      market,
      this.env,
      this.rpcUrl,
      this.commitment,
    );
    let subscriptionAttempted = false;
    try {
      subscriptionAttempted = true;
      await reader.subscribe();
      const snapshot = await reader.readSnapshot(market);

      return normalizeDriftMarketSnapshot({
        ...snapshot,
        collectedAt: this.now(),
        staleAfterMs: this.staleAfterMs,
      });
    } finally {
      if (subscriptionAttempted) await reader.unsubscribe();
    }
  }
}
