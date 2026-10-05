# Velocity Adapter

`@perps-risk/adapter-velocity` reads current Velocity perp market and oracle
accounts through the official `@velocity-exchange/sdk` package and maps them to
the venue-neutral `MarketState` model.

## Use

Provide an HTTP(S) Solana RPC URL and request a configured market by symbol:

```ts
import { VelocityAdapter } from "@perps-risk/adapter-velocity";

const adapter = new VelocityAdapter({
  rpcUrl: process.env.SOLANA_RPC_URL!,
  env: "mainnet-beta",
});

const state = await adapter.getMarketState("SOL-PERP");
```

The adapter defaults to mainnet-beta, confirmed commitment, and a 15-second
freshness threshold. It uses the SDK's WebSocket account subscription and
unsubscribes after each snapshot read. Configure a reliable RPC provider; the
public Solana endpoint is rate-limited.

## Data mapping

- Oracle price maps to `price.indexPrice` and `oracle.price`.
- The SDK reserve price maps to `price.markPrice`.
- AMM long and short base amounts map to open interest in base units.
- AMM bid and ask estimates map to best bid and ask prices. They are not
  executable DLOB depth, so sizes and available liquidity remain `null`.
- Latest funding rate and funding period map to `FundingState`.
- Last-trade price and liquidation measurements remain `null`. Although the
  SDK exposes last-fill data, the canonical model has one timestamp shared by
  price fields, so the adapter avoids pairing an older trade price with current
  oracle time.
- Mainnet markets are labeled USDT-quoted; devnet markets use the dUSDT
  placeholder quote asset.

## Migration note

Velocity is a separate deployment forked from Drift v2, with a different
program ID and PDA addresses. No Drift V2 state carries over. Its mainnet quote
asset is USDT, not USDC. Keep Velocity market IDs, oracle accounts, and quote
asset metadata separate from any legacy Drift V2 data.

The adapter makes a short-lived subscription per `getMarketState` call. A
future continuously running collector can keep one `VelocityClient`
subscription alive and emit updated canonical states as accounts change.
