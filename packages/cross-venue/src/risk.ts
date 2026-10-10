import type {
  CrossVenueRisk,
  CrossVenueDivergence,
  VenueSnapshot,
} from "./types.js";
import type { MarketRisk, RiskLevel } from "@perps-risk/risk";
import type { RiskThresholds } from "@perps-risk/risk";
import {
  scoreFromThresholds,
  scoreToLevel,
  weightedAverage,
} from "@perps-risk/risk";
import {
  priceDivergence,
  fundingDivergence,
  oiConcentration,
  liquiditySpreadDivergence,
  liquidationConcentration,
  type DivergenceResult,
} from "./metrics.js";
import {
  priceDivergenceThresholds,
  fundingDivergenceThresholds,
  oiConcentrationThresholds,
  liquidityDivergenceThresholds,
  crossVenueWeights,
} from "./config.js";

interface ComponentScore {
  value: number | null;
  score: number | null;
  driver: string;
}

function scoreDivergence(
  result: DivergenceResult,
  thresholds: RiskThresholds,
  key: string,
): ComponentScore {
  const score = scoreFromThresholds(result.value, thresholds[key] ?? []);
  return { value: result.value, score, driver: result.driver };
}

export function calculateCrossVenueRisk(
  asset: string,
  snapshots: VenueSnapshot[],
): CrossVenueRisk {
  const timestamp = new Date().toISOString();
  const sorted = [...snapshots].sort((a, b) => a.venue.localeCompare(b.venue));

  // Single venue or no data → low ecosystem risk by default
  if (sorted.length < 2) {
    return {
      asset,
      timestamp,
      venueCount: sorted.length,
      ecosystemScore: 0,
      ecosystemLevel: "low",
      venueSnapshots: sorted,
      divergence: {
        price: null,
        funding: null,
        oiConcentration: null,
        liquiditySpread: null,
        liquidationConcentration: null,
      },
      riskDrivers:
        sorted.length === 0
          ? ["No venue data available"]
          : ["Single venue — no cross-venue comparison possible"],
    };
  }

  // Compute divergences
  const priceDiv = scoreDivergence(
    priceDivergence(sorted),
    priceDivergenceThresholds,
    "priceDivergence",
  );
  const fundDiv = scoreDivergence(
    fundingDivergence(sorted),
    fundingDivergenceThresholds,
    "fundingDivergence",
  );
  const oiDiv = scoreDivergence(
    oiConcentration(sorted),
    oiConcentrationThresholds,
    "oiConcentration",
  );
  const liqDiv = scoreDivergence(
    liquiditySpreadDivergence(sorted),
    liquidityDivergenceThresholds,
    "liquidityDivergence",
  );
  const liqConcDiv = scoreDivergence(
    liquidationConcentration(sorted),
    oiConcentrationThresholds, // reuse OI concentration thresholds
    "oiConcentration",
  );

  const divergence: CrossVenueDivergence = {
    price: priceDiv.value,
    funding: fundDiv.value,
    oiConcentration: oiDiv.value,
    liquiditySpread: liqDiv.value,
    liquidationConcentration: liqConcDiv.value,
  };

  // Combine into ecosystem score
  const scores: Record<string, number | null> = {
    price: priceDiv.score,
    funding: fundDiv.score,
    oiConcentration: oiDiv.score,
    liquiditySpread: liqDiv.score,
    liquidationConcentration: liqConcDiv.score,
  };

  const ecosystemScore = weightedAverage(scores, crossVenueWeights);
  const ecosystemLevel =
    ecosystemScore !== null ? scoreToLevel(ecosystemScore) : "low";

  // Collect drivers, sorted by score descending
  const driverEntries: { driver: string; score: number }[] = [
    { driver: priceDiv.driver, score: priceDiv.score ?? 0 },
    { driver: fundDiv.driver, score: fundDiv.score ?? 0 },
    { driver: oiDiv.driver, score: oiDiv.score ?? 0 },
    { driver: liqDiv.driver, score: liqDiv.score ?? 0 },
    { driver: liqConcDiv.driver, score: liqConcDiv.score ?? 0 },
  ]
    .filter((d) => d.driver && !d.driver.includes("Insufficient"))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const riskDrivers = driverEntries.map((d) => d.driver);

  if (riskDrivers.length === 0) {
    riskDrivers.push("Cross-venue metrics are aligned — low ecosystem risk");
  }

  return {
    asset,
    timestamp,
    venueCount: sorted.length,
    ecosystemScore: Math.round(ecosystemScore ?? 0),
    ecosystemLevel,
    venueSnapshots: sorted,
    divergence,
    riskDrivers,
  };
}

/** Alias for the public ecosystem risk result used across venue comparisons. */
export function calculateEcosystemRisk(
  asset: string,
  snapshots: VenueSnapshot[],
): CrossVenueRisk {
  return calculateCrossVenueRisk(asset, snapshots);
}
