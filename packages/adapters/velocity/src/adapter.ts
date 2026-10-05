import { PerpMarkets, type VelocityEnv } from "@velocity-exchange/sdk";
import type { Commitment } from "@solana/web3.js";
import { normalizeVelocityMarketSnapshot } from "./normalize.js";
import { createVelocityMarketReader } from "./reader.js";
import type {
  VelocityAdapterOptions,
  VelocityMarketReader,
  VelocityReaderFactory,
} from "./types.js";

const DEFAULT_ENV: VelocityEnv = "mainnet-beta";
const DEFAULT_COMMITMENT: Commitment = "confirmed";
const DEFAULT_STALE_AFTER_MS = 15_000;

export class VelocityAdapter {
  private readonly rpcUrl: string;
  private readonly env: VelocityEnv;
  private readonly commitment: Commitment;
  private readonly staleAfterMs: number;
  private readonly readerFactory: VelocityReaderFactory;
  private readonly now: () => Date;

  constructor(options: VelocityAdapterOptions) {
    let rpcUrl: URL;
    try {
      rpcUrl = new URL(options.rpcUrl);
    } catch {
      throw new Error("Velocity adapter requires a valid HTTP(S) RPC URL");
    }
    if (rpcUrl.protocol !== "http:" && rpcUrl.protocol !== "https:") {
      throw new Error("Velocity adapter RPC URL must use HTTP or HTTPS");
    }
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) {
      throw new Error("staleAfterMs must be a positive safe integer");
    }
    this.rpcUrl = options.rpcUrl;
    this.env = options.env ?? DEFAULT_ENV;
    this.commitment = options.commitment ?? DEFAULT_COMMITMENT;
    this.staleAfterMs = staleAfterMs;
    this.readerFactory = options.readerFactory ?? createVelocityMarketReader;
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
      throw new Error(`Velocity perp market not found for symbol "${symbol}"`);
    }

    const reader: VelocityMarketReader = await this.readerFactory(
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
      return normalizeVelocityMarketSnapshot({
        ...snapshot,
        quoteAsset: this.env === "mainnet-beta" ? "USDT" : "dUSDT",
        collectedAt: this.now(),
        staleAfterMs: this.staleAfterMs,
      });
    } finally {
      if (subscriptionAttempted) await reader.unsubscribe();
    }
  }
}
