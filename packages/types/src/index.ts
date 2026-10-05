import { z } from "zod";

/** Venue identifiers are stable lowercase keys, independent of SDK names. */
export const VenueSchema = z.enum(["drift", "phoenix", "jupiter"]);
export type Venue = z.infer<typeof VenueSchema>;

const TimestampSchema = z.string().datetime({ offset: true });
const NonEmptyStringSchema = z.string().trim().min(1);
const NonNegativeNumberSchema = z.number().finite().nonnegative();
const PositiveNumberSchema = z.number().finite().positive();
const NullableTimestampSchema = TimestampSchema.nullable();

/** Identifies the instrument on a venue and its normalized display symbol. */
export const MarketSchema = z
  .object({
    venue: VenueSchema,
    symbol: NonEmptyStringSchema,
    marketId: NonEmptyStringSchema.nullable(),
    baseAsset: NonEmptyStringSchema,
    quoteAsset: NonEmptyStringSchema,
  })
  .strict();
export type Market = z.infer<typeof MarketSchema>;

/** Prices are quote-asset units per one base-asset unit. */
export const PriceStateSchema = z
  .object({
    lastPrice: PositiveNumberSchema.nullable(),
    indexPrice: PositiveNumberSchema.nullable(),
    markPrice: PositiveNumberSchema.nullable(),
    observedAt: NullableTimestampSchema,
  })
  .strict();
export type PriceState = z.infer<typeof PriceStateSchema>;

/** Open-interest amounts share one declared unit within this state. */
export const PositioningStateSchema = z
  .object({
    longOpenInterest: NonNegativeNumberSchema.nullable(),
    shortOpenInterest: NonNegativeNumberSchema.nullable(),
    totalOpenInterest: NonNegativeNumberSchema.nullable(),
    openInterestUnit: z.enum(["base", "quote", "contracts"]).nullable(),
    observedAt: NullableTimestampSchema,
  })
  .strict();
export type PositioningState = z.infer<typeof PositioningStateSchema>;

/** Depth and available liquidity use the declared base or quote unit. */
export const LiquidityStateSchema = z
  .object({
    bestBidPrice: PositiveNumberSchema.nullable(),
    bestAskPrice: PositiveNumberSchema.nullable(),
    bidSize: NonNegativeNumberSchema.nullable(),
    askSize: NonNegativeNumberSchema.nullable(),
    availableLiquidity: NonNegativeNumberSchema.nullable(),
    liquidityUnit: z.enum(["base", "quote"]).nullable(),
    observedAt: NullableTimestampSchema,
  })
  .strict();
export type LiquidityState = z.infer<typeof LiquidityStateSchema>;

/** Rate is a signed decimal fraction for the stated funding period. */
export const FundingStateSchema = z
  .object({
    rate: z.number().finite().nullable(),
    periodSeconds: z.number().int().positive().nullable(),
    observedAt: NullableTimestampSchema,
  })
  .strict();
export type FundingState = z.infer<typeof FundingStateSchema>;

/** Liquidation volume is measured in the declared base, quote, or contract unit. */
export const LiquidationStateSchema = z
  .object({
    longVolume: NonNegativeNumberSchema.nullable(),
    shortVolume: NonNegativeNumberSchema.nullable(),
    totalVolume: NonNegativeNumberSchema.nullable(),
    volumeUnit: z.enum(["base", "quote", "contracts"]).nullable(),
    intervalSeconds: z.number().int().positive().nullable(),
    observedAt: NullableTimestampSchema,
  })
  .strict();
export type LiquidationState = z.infer<typeof LiquidationStateSchema>;

/** Oracle price is quote-asset units per one base-asset unit. */
export const OracleStateSchema = z
  .object({
    price: PositiveNumberSchema.nullable(),
    source: NonEmptyStringSchema.nullable(),
    observedAt: NullableTimestampSchema,
  })
  .strict();
export type OracleState = z.infer<typeof OracleStateSchema>;

/** Freshness values are milliseconds; null means the source did not provide enough information. */
export const DataFreshnessSchema = z
  .object({
    sourceAgeMs: z.number().int().nonnegative().nullable(),
    staleAfterMs: z.number().int().positive().nullable(),
  })
  .strict();
export type DataFreshness = z.infer<typeof DataFreshnessSchema>;

/** Timestamps are ISO 8601 strings with an explicit UTC marker or offset. */
export const MarketStateMetadataSchema = z
  .object({
    source: NonEmptyStringSchema,
    observedAt: NullableTimestampSchema,
    collectedAt: TimestampSchema,
    sourceUpdatedAt: NullableTimestampSchema,
    freshness: DataFreshnessSchema,
  })
  .strict();
export type MarketStateMetadata = z.infer<typeof MarketStateMetadataSchema>;

/** Venue-independent snapshot consumed by downstream metrics and risk packages. */
export const MarketStateSchema = z
  .object({
    market: MarketSchema,
    price: PriceStateSchema,
    positioning: PositioningStateSchema,
    liquidity: LiquidityStateSchema,
    funding: FundingStateSchema,
    liquidation: LiquidationStateSchema,
    oracle: OracleStateSchema,
    metadata: MarketStateMetadataSchema,
  })
  .strict();
export type MarketState = z.infer<typeof MarketStateSchema>;
