import type {
  BN,
  OraclePriceData,
  PerpMarketAccount,
  PerpMarketConfig,
  VelocityEnv,
} from "@velocity-exchange/sdk";
import type { Commitment } from "@solana/web3.js";

export type VelocityMarketAccountSnapshot = Pick<
  PerpMarketAccount,
  | "baseAssetAmountLong"
  | "baseAssetAmountShort"
  | "lastFundingRate"
  | "lastFundingRateTs"
  | "lastFillPrice"
  | "amm"
  | "marketStats"
>;

export interface VelocityMarketReader {
  subscribe(): Promise<void>;
  unsubscribe(): Promise<void>;
  readSnapshot(
    market: PerpMarketConfig,
  ): Promise<
    Omit<VelocityMarketSnapshot, "collectedAt" | "staleAfterMs" | "quoteAsset">
  >;
}

export type VelocityReaderFactory = (
  market: PerpMarketConfig,
  env: VelocityEnv,
  rpcUrl: string,
  commitment: Commitment,
) => VelocityMarketReader | Promise<VelocityMarketReader>;

export interface VelocityAdapterOptions {
  rpcUrl: string;
  env?: VelocityEnv;
  commitment?: Commitment;
  staleAfterMs?: number;
  readerFactory?: VelocityReaderFactory;
  now?: () => Date;
}

export interface VelocityMarketSnapshot {
  market: Pick<
    PerpMarketConfig,
    "symbol" | "baseAssetSymbol" | "marketIndex" | "oracle" | "oracleSource"
  >;
  quoteAsset: "USDT" | "dUSDT";
  marketAccount: VelocityMarketAccountSnapshot;
  oracle: OraclePriceData | null;
  markPrice: BN | null;
  bidPrice: BN | null;
  askPrice: BN | null;
  sourceUpdatedAt: Date | null;
  collectedAt: Date;
  staleAfterMs: number;
}
