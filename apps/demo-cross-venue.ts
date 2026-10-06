import { VelocityAdapter } from "@perps-risk/adapter-velocity";
import { PhoenixAdapter } from "@perps-risk/adapter-phoenix";
import { analyzeCrossVenue } from "@perps-risk/cross-venue";

const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

console.log(`\n🔍 Cross-Venue Risk — Velocity + Phoenix\n`);

const velocity = new VelocityAdapter({ rpcUrl, env: "mainnet-beta" });
const phoenix = new PhoenixAdapter();

const symbols = ["SOL", "BTC", "ETH"];
const states: { state: Awaited<ReturnType<typeof velocity.getMarketState>>; venue: string }[] = [];

for (const symbol of symbols) {
  try {
    const [vState, pState] = await Promise.all([
      velocity.getMarketState(symbol),
      phoenix.getMarketState(symbol),
    ]);
    states.push({ state: vState, venue: "velocity" });
    states.push({ state: pState, venue: "phoenix" });
  } catch (err) {
    console.error(`  ${symbol}: ✗ ${(err as Error).message}`);
  }
}

const results = analyzeCrossVenue(states.map((s) => s.state));

for (const [asset, risk] of results) {
  console.log(`  ${"=".repeat(60)}`);
  console.log(`  ${asset} Perp — Cross-Venue Analysis`);
  console.log(`  ${"=".repeat(60)}`);

  // Venue comparison table
  console.log(`\n  Venue        Price        OI           Funding      Spread`);
  for (const snap of risk.venueSnapshots) {
    const p = snap.metrics.price?.toFixed(2) ?? "N/A";
    const oi = snap.metrics.oi?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? "N/A";
    const f = snap.metrics.funding !== null
      ? (snap.metrics.funding * 100).toFixed(5) + "%"
      : "N/A";
    const s = snap.metrics.spread !== null
      ? snap.metrics.spread.toFixed(4) + "%"
      : "N/A";
    console.log(`    ${snap.venue.padEnd(10)} $${p.padStart(10)} ${oi.padStart(13)} ${f.padStart(12)} ${s}`);
  }

  // Divergence
  console.log(`\n  Divergence:`);
  if (risk.divergence.price !== null) {
    console.log(`    Price CV:        ${risk.divergence.price.toFixed(3)}%`);
  }
  if (risk.divergence.funding !== null) {
    console.log(`    Funding σ:       ${risk.divergence.funding.toFixed(4)}`);
  }
  if (risk.divergence.oiConcentration !== null) {
    console.log(`    OI Concentration: ${risk.divergence.oiConcentration.toFixed(3)} (0–1)`);
  }
  if (risk.divergence.liquiditySpread !== null) {
    console.log(`    Spread Range:    ${risk.divergence.liquiditySpread.toFixed(4)}%`);
  }

  // Risk score
  console.log(`\n  Ecosystem Score:  ${risk.ecosystemScore} / 100  (${risk.ecosystemLevel?.toUpperCase()})`);
  console.log(`  Drivers:`);
  for (const d of risk.riskDrivers) {
    console.log(`    • ${d}`);
  }
  console.log("");
}

console.log(`${"=".repeat(60)}\n`);
