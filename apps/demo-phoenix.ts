import { PhoenixAdapter } from "@perps-risk/adapter-phoenix";

const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

console.log(`\n🔍 Phoenix adapter — fetching live data\n`);

const adapter = new PhoenixAdapter();

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
    console.log(`    bid/ask size: ${state.liquidity.bidSize} / ${state.liquidity.askSize} ${state.liquidity.liquidityUnit ?? ""}`);
    console.log(`    OI:          ${state.positioning.totalOpenInterest} ${state.positioning.openInterestUnit ?? ""}`);
    console.log(`    funding:     ${state.funding.rate} (period: ${state.funding.periodSeconds}s)`);
    console.log(`    liquidations: ${state.liquidation.totalVolume}`);
    console.log(`    spread:      ${state.liquidity.bestBidPrice && state.liquidity.bestAskPrice ? ((state.liquidity.bestAskPrice - state.liquidity.bestBidPrice) / ((state.liquidity.bestAskPrice + state.liquidity.bestBidPrice) / 2) * 100).toFixed(4) + "%" : "N/A"}`);
    console.log("");
  } catch (err) {
    console.error(`  ${symbol}: ✗ ${(err as Error).message}\n`);
  }
}
