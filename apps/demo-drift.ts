import { DriftAdapter } from "@perps-risk/adapter-drift";

const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

console.log(`\n🔍 Drift adapter — fetching live mainnet data\n`);

const adapter = new DriftAdapter({ rpcUrl, env: "mainnet-beta" });

for (const symbol of ["SOL", "BTC", "ETH"]) {
  try {
    const t0 = performance.now();
    const state = await adapter.getMarketState(symbol);
    const ms = Math.round(performance.now() - t0);

    console.log(`  ${symbol} — ${ms}ms`);
    console.log(`    venue:       ${state.market.venue}`);
    console.log(`    symbol:      ${state.market.symbol}`);
    console.log(`    markPrice:   ${state.price.markPrice}`);
    console.log(`    indexPrice:  ${state.price.indexPrice}`);
    console.log(`    bid/ask:     ${state.liquidity.bestBidPrice} / ${state.liquidity.bestAskPrice}`);
    console.log(`    OI long/short: ${state.positioning.longOpenInterest} / ${state.positioning.shortOpenInterest}`);
    console.log(`    total OI:    ${state.positioning.totalOpenInterest} ${state.positioning.openInterestUnit}`);
    console.log(`    funding:     ${state.funding.rate} (period: ${state.funding.periodSeconds}s)`);
    console.log(`    oracle:      ${state.oracle.price}`);
    console.log(`    liquidations: ${state.liquidation.totalVolume}`);
    console.log(`    oracle age:  ${state.metadata.freshness.sourceAgeMs}ms`);
    console.log("");
  } catch (err) {
    console.error(`  ${symbol}: ✗ ${(err as Error).message}\n`);
  }
}
