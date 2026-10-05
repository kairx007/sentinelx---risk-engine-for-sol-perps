import type {
  AMM,
  DriftEnv,
  OraclePriceData,
  PerpMarketConfig,
} from "@drift-labs/sdk";
import type { Commitment } from "@solana/web3.js";

export type DriftAmmSnapshot = Pick<
  AMM,
  | "baseAssetAmountLong"
  | "baseAssetAmountShort"
  | "fundingPeriod"
  | "lastFundingRate"
  | "lastFundingRateTs"
>;

/** Narrow SDK surface used by the adapter and replaced with a fake in tests. */
export interface DriftMarketReader {
  subscribe(): Promise<void>;
  unsubscribe(): Promise<void>;
  readSnapshot(
    market: PerpMarketConfig,
  ): Promise<Omit<DriftMarketSnapshot, "collectedAt" | "staleAfterMs">>;
}

export type DriftReaderFactory = (
  market: PerpMarketConfig,
  env: DriftEnv,
  rpcUrl: string,
  commitment: Commitment,
) => DriftMarketReader | Promise<DriftMarketReader>;

export interface DriftAdapterOptions {
  /** HTTP(S) Solana RPC endpoint; its WebSocket endpoint is derived by web3.js. */
  rpcUrl: string;
  env?: DriftEnv;
  commitment?: Commitment;
  /** Freshness threshold in milliseconds. Age is null if the source time is unknown. */
  staleAfterMs?: number;
  /** SDK seam for deterministic, offline tests. */
  readerFactory?: DriftReaderFactory;
  /** Clock seam for deterministic, offline tests. */
  now?: () => Date;
}

export interface DriftMarketSnapshot {
  market: Pick<
    PerpMarketConfig,
    "symbol" | "baseAssetSymbol" | "marketIndex" | "oracle"
  >;
  amm: DriftAmmSnapshot;
  oracle: OraclePriceData | null;
  markPrice: import("@drift-labs/sdk").BN | null;
  bidPrice: import("@drift-labs/sdk").BN | null;
  askPrice: import("@drift-labs/sdk").BN | null;
  sourceUpdatedAt: Date | null;
  collectedAt: Date;
  staleAfterMs: number;
}
