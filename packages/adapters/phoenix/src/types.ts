import type { ExchangeMarketConfig } from "@ellipsis-labs/rise";

export interface PhoenixMarketSnapshot {
  market: ExchangeMarketConfig;
  stats: {
    symbol: string;
    timestamp_ms: bigint;
    mark_price: number;
    oracle_price: number;
    prev_day_mark_price: number;
    open_interest: number;
    day_volume_usd: number;
    day_volume_base: number;
    current_funding_rate: number;
    eight_hour_funding_rate: number;
    annualized_funding_rate: number;
  };
  orderbook: {
    slot: number;
    symbol: string;
    bids: [number, number][];
    asks: [number, number][];
    mid?: number | null;
  };
  collectedAt: Date;
  staleAfterMs: number;
}

export interface PhoenixMarketReader {
  getMarkets(): Promise<ExchangeMarketConfig[]>;
  readSnapshot(
    symbol: string,
  ): Promise<Omit<PhoenixMarketSnapshot, "collectedAt" | "staleAfterMs">>;
}

export type PhoenixReaderFactory = (apiUrl?: string) => PhoenixMarketReader;

export interface PhoenixAdapterOptions {
  apiUrl?: string;
  staleAfterMs?: number;
  readerFactory?: PhoenixReaderFactory;
  now?: () => Date;
}
