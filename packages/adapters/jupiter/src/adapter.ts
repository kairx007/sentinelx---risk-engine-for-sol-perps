import { normalizeJupiterMarketSnapshot } from "./normalize.js";
import { defaultJupiterReaderFactory } from "./reader.js";
import {
  JUPITER_PERP_MARKETS,
  type JupiterAdapterOptions,
  type JupiterMarketReader,
  type JupiterPerpSymbol,
  type JupiterReaderFactory,
} from "./types.js";

const DEFAULT_STALE_AFTER_MS = 15_000;

export class JupiterAdapter {
  private readonly reader: JupiterMarketReader;
  private readonly now: () => Date;
  private readonly staleAfterMs: number;

  constructor(options: JupiterAdapterOptions = {}) {
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs <= 0) {
      throw new Error("staleAfterMs must be a positive safe integer");
    }
    const apiUrl = options.apiUrl ?? "https://perps-api.jup.ag/v2";
    const fetcher = options.fetch ?? fetch;
    const readerFactory: JupiterReaderFactory =
      options.readerFactory ?? defaultJupiterReaderFactory;
    this.reader = readerFactory({ apiUrl, fetch: fetcher });
    this.now = options.now ?? (() => new Date());
    this.staleAfterMs = staleAfterMs;
  }

  async getMarketState(symbol: string) {
    const requested = symbol
      .trim()
      .toUpperCase()
      .replace(/[-/]?PERP$/, "") as JupiterPerpSymbol;
    const mint = JUPITER_PERP_MARKETS[requested];
    if (!mint)
      throw new Error(`Jupiter perp market not found for symbol "${symbol}"`);
    const stats = await this.reader.readMarketStats(mint);
    return normalizeJupiterMarketSnapshot({
      symbol: requested,
      mint,
      stats,
      collectedAt: this.now(),
      staleAfterMs: this.staleAfterMs,
    });
  }
}
