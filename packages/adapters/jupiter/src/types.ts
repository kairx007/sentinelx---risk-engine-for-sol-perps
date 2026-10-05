export const JUPITER_PERP_MARKETS = {
  SOL: "So11111111111111111111111111111111111111112",
  BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
} as const;

export type JupiterPerpSymbol = keyof typeof JUPITER_PERP_MARKETS;

export interface JupiterMarketStats {
  price: string;
  priceChange24H: string;
  priceHigh24H: string;
  priceLow24H: string;
  volume: string;
}

export interface JupiterMarketSnapshot {
  symbol: JupiterPerpSymbol;
  mint: string;
  stats: JupiterMarketStats;
  collectedAt: Date;
  staleAfterMs: number;
}

export interface JupiterMarketReader {
  readMarketStats(mint: string): Promise<JupiterMarketStats>;
}

export type JupiterReaderFactory = (options: {
  apiUrl: string;
  fetch: typeof fetch;
}) => JupiterMarketReader;

export interface JupiterAdapterOptions {
  apiUrl?: string;
  staleAfterMs?: number;
  fetch?: typeof fetch;
  readerFactory?: JupiterReaderFactory;
  now?: () => Date;
}
