import { VelocityAdapter } from "@perps-risk/adapter-velocity";
import {
  calculatePositioningMetrics,
  calculateLiquidityMetrics,
  calculateFundingMetrics,
  calculateLiquidationMetrics,
  calculateOracleMetrics,
  calculateOpenInterestMetrics,
  calculateVolatilityMetrics,
} from "@perps-risk/metrics";
import { evaluateMarketRisk } from "@perps-risk/risk";

const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

console.log(`\n🔍 Velocity adapter — fetching real on-chain perps data`);
console.log(`   RPC: ${rpcUrl}\n`);

const adapter = new VelocityAdapter({ rpcUrl, env: "mainnet-beta" });

for (const symbol of ["SOL", "BTC", "ETH"]) {
  try {
    const t0 = performance.now();
    const state = await adapter.getMarketState(symbol);
    const fetchMs = Math.round(performance.now() - t0);

    const positioning = calculatePositioningMetrics(state);
    const liquidity = calculateLiquidityMetrics(state);
    const funding = calculateFundingMetrics(state);
    const liquidation = calculateLiquidationMetrics(state);
    const oracle = calculateOracleMetrics(state);
    const openInterest = calculateOpenInterestMetrics(state);
    const volatility = calculateVolatilityMetrics([state], 300);

    const result = evaluateMarketRisk({
      state,
      openInterest,
      positioning,
      liquidity,
      funding,
      liquidation,
      oracle,
      volatility,
    });

    console.log(`  ${"=".repeat(58)}`);
    console.log(`  ${symbol} Perp — Velocity mainnet  (${fetchMs}ms)`);
    console.log(`  ${"=".repeat(58)}`);
    console.log(
      `  Mark Price:   $${state.price.markPrice ? state.price.markPrice.toFixed(2) : "N/A"}`,
    );
    console.log(
      `  Index Price:  $${state.price.indexPrice ? state.price.indexPrice.toFixed(2) : "N/A"}`,
    );
    console.log(
      `  Oracle Price: $${state.oracle.price ? state.oracle.price.toFixed(2) : "N/A"}`,
    );
    console.log(
      `  Bid / Ask:    ${state.liquidity.bestBidPrice ? "$" + state.liquidity.bestBidPrice.toFixed(2) : "N/A"}  /  ${state.liquidity.bestAskPrice ? "$" + state.liquidity.bestAskPrice.toFixed(2) : "N/A"}`,
    );
    console.log(
      `  Spread:       ${liquidity.spreadPercent !== null ? liquidity.spreadPercent.toFixed(4) + "%" : "N/A"}`,
    );
    console.log(
      `  OI Long/Short: ${state.positioning.longOpenInterest?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? "N/A"} / ${state.positioning.shortOpenInterest?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? "N/A"} ${state.positioning.openInterestUnit ?? ""}`,
    );
    console.log(
      `  Total OI:     ${state.positioning.totalOpenInterest?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? "N/A"} ${state.positioning.openInterestUnit ?? ""}`,
    );
    console.log(
      `  Funding Rate: ${funding.currentFunding !== null ? (funding.currentFunding * 100).toFixed(5) + "%" : "N/A"}`,
    );
    console.log(
      `  Oracle Age:   ${oracle.oracleAgeMs !== null ? (oracle.oracleAgeMs / 1000).toFixed(1) + "s" : "N/A"}`,
    );
    console.log(
      `  Mark/Idx Δ:   ${oracle.markIndexDeviationPercent !== null ? oracle.markIndexDeviationPercent.toFixed(4) + "%" : "N/A"}`,
    );
    console.log("");
    console.log(
      `  Risk Score:   ${result.overallScore.toString().padStart(3)} / 100`,
    );
    console.log(`  Risk Level:   ${result.level.toUpperCase()}`);
    console.log(`  Components:`);

    for (const [name, comp] of Object.entries(result.components)) {
      const s = comp.score;
      const filled = Math.round(s / 10);
      const bar = "█".repeat(filled) + "░".repeat(10 - filled);
      const drivers =
        comp.drivers.length > 0 &&
        !comp.drivers[0]?.includes("not available")
          ? `  ← ${comp.drivers[0]}`
          : "";
      console.log(
        `    ${name.padEnd(14)} ${bar} ${s.toString().padStart(3)}${drivers}`,
      );
    }

    if (result.topDrivers.length > 0) {
      console.log(`\n  Key findings:`);
      for (const d of result.topDrivers) {
        console.log(`    • ${d}`);
      }
    }
    console.log("");
  } catch (err) {
    console.error(
      `  ${symbol}: ✗ ${(err as Error).message}\n`,
    );
  }
}

console.log(`${"═".repeat(58)}\n`);
