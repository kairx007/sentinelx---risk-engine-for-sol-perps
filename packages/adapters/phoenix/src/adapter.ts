import { normalizePhoenixMarketSnapshot } from "./normalize.js";
import { createPhoenixMarketReader } from "./reader.js";
import type {
  PhoenixAdapterOptions,
  PhoenixMarketReader,
  PhoenixReaderFactory,
} from "./types.js";

const DEFAULT_STALE_AFTER_MS = 15_000;

function baseSymbol(symbol: string): string {
  return symbol
    .trim()
    .toUpperCase()
    .replace(/[-/]?(PERP|USD[TC]?)$/i, "");
}

export class PhoenixAdapter {
  private readonly staleAfterMs: number;
  private readonly readerFactory: PhoenixReaderFactory;
  private readonly now: () => Date;
  private readonly reader: PhoenixMarketReader;

  constructor(options: PhoenixAdapterOptions = {}) {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) {
      throw new Error("staleAfterMs must be a positive safe integer");
    }
    this.staleAfterMs = staleAfterMs;
    this.readerFactory = options.readerFactory ?? createPhoenixMarketReader;
    this.reader = this.readerFactory(options.apiUrl);
    this.now = options.now ?? (() => new Date());
  }

  async getMarketState(symbol: string) {
    const requested = symbol.trim().toUpperCase();
    if (!requested) throw new Error("Phoenix market symbol is required");
    const requestedBase = baseSymbol(requested);
    const markets = await this.reader.getMarkets();
    const market = markets.find((candidate) => {
      const isActive =
        !candidate.marketStatus ||
        candidate.marketStatus.toLowerCase() === "active";
      return isActive && baseSymbol(candidate.symbol) === requestedBase;
    });
    if (!market)
      throw new Error(`Phoenix perp market not found for symbol "${symbol}"`);

    const snapshot = await this.reader.readSnapshot(market.symbol);
    return normalizePhoenixMarketSnapshot({
      ...snapshot,
      collectedAt: this.now(),
      staleAfterMs: this.staleAfterMs,
    });
  }
}
