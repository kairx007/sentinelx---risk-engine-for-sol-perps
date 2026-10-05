# Canonical Data Model

Phase 2 defines the venue-independent contract in `packages/types`. A venue
adapter will map its protocol-specific data into `MarketState`; downstream
metrics and risk packages should depend on this contract rather than a venue
SDK.

## Model overview

`MarketState` contains `Market`, `PriceState`, `PositioningState`,
`LiquidityState`, `FundingState`, `LiquidationState`, `OracleState`, and
collection metadata. Runtime schemas and TypeScript types are exported from
`@perps-risk/types`.

## Units and conventions

- Timestamps are ISO 8601 strings with an explicit `Z` or UTC offset.
- Prices are quote-asset units per one base-asset unit.
- Open-interest amounts use one shared `openInterestUnit`: base units, quote
  units, or contracts. The unit is `null` when the amount is unavailable.
- Liquidity sizes and available liquidity use the declared base or quote unit.
- Funding `rate` is a signed decimal fraction for one `periodSeconds` interval.
- Liquidation amounts use the declared base, quote, or contract unit and cover
  `intervalSeconds`.
- Freshness durations are milliseconds. `sourceAgeMs` and `staleAfterMs` are
  nullable when the source does not provide enough information; freshness is
  reported as data and is not itself a risk classification.
- Numeric observations are finite. Prices must be positive; quantities and
  durations must be nonnegative or positive as appropriate. Missing
  measurements are represented by `null`, never by zero.

## Timestamp meanings

- Component `observedAt` is when that component's measurement applies or was
  observed by its source.
- Metadata `observedAt` is the observation time for the overall snapshot.
- Metadata `sourceUpdatedAt` is the source's last update time, when available.
- Metadata `collectedAt` is when the collector obtained this snapshot.

All component fields are required in the serialized shape, even when their
values are `null`. This makes unavailable data explicit and avoids silently
conflating missing fields with zero values. Schemas reject unknown properties
so venue-specific raw fields stay in adapters instead of leaking into the
canonical model.

## Validation and fixtures

`MarketStateSchema` and the component schemas validate payloads at runtime.
Fixtures under `tests/fixtures` cover all three planned venues, nullable data,
an unsupported venue, and an invalid timestamp. Tests exercise valid states,
nullable values, missing fields, wrong types, unsupported venues, timestamps,
and unknown properties.
