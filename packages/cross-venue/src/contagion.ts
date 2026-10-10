import type { Venue } from "@perps-risk/types";
import { scoreFromThresholds } from "@perps-risk/risk";
import {
  fundingDivergenceThresholds,
  liquidityDivergenceThresholds,
  oiConcentrationThresholds,
  priceDivergenceThresholds,
} from "./config.js";
import { calculateCrossVenueRisk } from "./risk.js";
import type { ContagionRisk, VenueSnapshot } from "./types.js";

function isMaterialSignal(
  value: number | null,
  thresholds: readonly { at: number; score: number }[],
): boolean {
  const score = scoreFromThresholds(value, thresholds);
  return score !== null && score >= 20;
}

function buildDrivers(
  ecosystemDrivers: string[],
  stressedVenues: Venue[],
  mediumVenues: Venue[],
  status: ContagionRisk["status"],
): string[] {
  const drivers = new Set<string>();

  for (const venue of stressedVenues) {
    drivers.add(`${venue} is under elevated risk`);
  }

  for (const venue of mediumVenues) {
    if (status === "DEVELOPING") {
      drivers.add(`${venue} is medium risk and trending toward stress`);
    }
  }

  for (const driver of ecosystemDrivers) {
    if (!driver.includes("Insufficient") && !driver.includes("No venue data")) {
      drivers.add(driver);
    }
  }

  return [...drivers];
}

function deriveSeverity(
  status: ContagionRisk["status"],
  maxVenueScore: number,
  ecosystemScore: number | null,
): ContagionRisk["severity"] {
  const strongest = Math.max(maxVenueScore, ecosystemScore ?? 0);

  if (strongest >= 76 || status === "ACTIVE") return "critical";
  if (strongest >= 51 || status === "DEVELOPING") return "high";
  if (strongest >= 26) return "medium";
  return "low";
}

export function calculateContagionRisk(
  asset: string,
  snapshots: VenueSnapshot[],
): ContagionRisk {
  const sorted = [...snapshots].sort((a, b) => a.venue.localeCompare(b.venue));
  const timestamp = new Date().toISOString();

  if (sorted.length === 0) {
    return {
      status: "NONE",
      severity: "low",
      affectedVenues: [],
      drivers: ["No venue data available"],
      timestamp,
    };
  }

  const ecosystem = calculateCrossVenueRisk(asset, sorted);
  const stressedVenues = sorted
    .filter(
      (snapshot) =>
        snapshot.risk !== null &&
        ["high", "critical"].includes(snapshot.risk.level),
    )
    .map((snapshot) => snapshot.venue);
  const mediumVenues = sorted
    .filter(
      (snapshot) => snapshot.risk !== null && snapshot.risk.level === "medium",
    )
    .map((snapshot) => snapshot.venue);

  const materialSignals = [
    {
      key: "price",
      label: "Price divergence",
      value: ecosystem.divergence.price,
      thresholds: priceDivergenceThresholds.priceDivergence,
    },
    {
      key: "funding",
      label: "Funding divergence",
      value: ecosystem.divergence.funding,
      thresholds: fundingDivergenceThresholds.fundingDivergence,
    },
    {
      key: "oiConcentration",
      label: "OI concentration",
      value: ecosystem.divergence.oiConcentration,
      thresholds: oiConcentrationThresholds.oiConcentration,
    },
    {
      key: "liquiditySpread",
      label: "Liquidity spread divergence",
      value: ecosystem.divergence.liquiditySpread,
      thresholds: liquidityDivergenceThresholds.liquidityDivergence,
    },
    {
      key: "liquidationConcentration",
      label: "Liquidation concentration",
      value: ecosystem.divergence.liquidationConcentration,
      thresholds: oiConcentrationThresholds.oiConcentration,
    },
  ].filter((signal) => isMaterialSignal(signal.value, signal.thresholds ?? []));

  const stressedCount = stressedVenues.length;
  const materialSignalCount = materialSignals.length;

  let status: ContagionRisk["status"] = "NONE";
  if (stressedCount === 0) {
    status = "NONE";
  } else if (stressedCount >= 2) {
    status = "ACTIVE";
  } else if (stressedCount === 1 && materialSignalCount >= 2) {
    status = "ACTIVE";
  } else if (
    stressedCount === 1 &&
    (mediumVenues.length > 0 || materialSignalCount >= 1)
  ) {
    status = "DEVELOPING";
  } else if (stressedCount === 1) {
    status = "ISOLATED";
  }

  const maxVenueScore = Math.max(
    0,
    ...sorted.map((snapshot) => snapshot.risk?.overallScore ?? 0),
  );
  const severity = deriveSeverity(
    status,
    maxVenueScore,
    ecosystem.ecosystemScore,
  );

  const affectedVenues: Venue[] =
    status === "NONE"
      ? []
      : sorted
          .filter((snapshot) => {
            const level = snapshot.risk?.level ?? "low";
            if (["high", "critical"].includes(level)) return true;
            if (status === "DEVELOPING" && level === "medium") return true;
            return false;
          })
          .map((snapshot) => snapshot.venue);

  const drivers = buildDrivers(
    ecosystem.riskDrivers.filter(
      (driver) =>
        !driver.includes("Insufficient") &&
        !driver.includes("Single venue") &&
        !driver.includes("No venue data"),
    ),
    stressedVenues,
    mediumVenues,
    status,
  );

  return {
    status,
    severity,
    affectedVenues,
    drivers,
    timestamp,
  };
}
