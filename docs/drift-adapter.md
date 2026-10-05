# Drift Adapter

`@perps-risk/adapter-drift` reads Drift v2 perpetual market state through the
official `@drift-labs/sdk` package and returns the venue-neutral `MarketState`
from `@perps-risk/types`.

## Use

Provide an HTTP(S) Solana RPC endpoint and request a configured perpetual market
by symbol or base-asset symbol:

```ts
import { DriftAdapter } from "@perps-risk/adapter-drift";

const adapter = new DriftAdapter({
  rpcUrl: process.env.SOLANA_RPC_URL!,
  env: "mainnet-beta",
});

const state = await adapter.getMarketState("SOL-PERP");
```

The adapter defaults to `mainnet-beta`, uses `confirmed` commitment, and marks
data stale after 30 seconds when it can determine the source age. Set
`staleAfterMs` to override the threshold. Use `env: "devnet"` for Drift's
configured devnet markets.

## Data mapping

- Oracle price maps to both `price.indexPrice` and `oracle.price`.
- SDK reserve price maps to `price.markPrice`.
- Long and short AMM base amounts map to open interest in base units; total is
  their sum.
- SDK AMM bid/ask price estimates map to best bid/ask prices. They do not include
  executable depth or size.
- The latest funding rate and funding period map to `FundingState`.
- Source block time is queried for the oracle slot when available. The
  collection timestamp is always recorded.
- `MarketStateSchema` validates every returned snapshot.

## Known data gaps

The SDK market snapshot used here does not provide a reliable last-trade price,
executable orderbook depth, available liquidity, or liquidation volume. Those
fields remain `null`. Drift v2 perpetuals are represented as USDC-quoted
markets. The adapter uses the SDK's configured market list, so newly listed or
custom markets require an SDK configuration update.

The SDK repository is archived. The adapter is pinned to the published
`@drift-labs/sdk` version `2.163.0-beta.13`; upgrades should be reviewed against
Drift's current documentation and on-chain deployment before adoption.
