import { scoreToLevel, type RiskLevel } from "@perps-risk/risk";
import type { ContagionStatus, EcosystemRisk, VenueSnapshot } from "./types.js";

export interface RiskPolicyDecision {
  riskLevel: RiskLevel;
  riskScore: number;
  contagionState: ContagionStatus;
  maxLeverageX100: number;
  observedAt: number;
}

const venueRiskCaps: Record<RiskLevel, number> = {
  low: 300,
  medium: 200,
  high: 100,
  critical: 0,
};

const requiredVenues = ["velocity", "phoenix"] as const;

function getCurrentSnapshot(
  snapshots: VenueSnapshot[],
  venue: string,
): VenueSnapshot {
  const matches = snapshots.filter((snapshot) => snapshot.venue === venue);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one current ${venue} market snapshot`);
  }

  const snapshot = matches[0]!;
  if (snapshot.risk === null) {
    throw new Error(`Current ${venue} market risk is unavailable`);
  }

  const { sourceAgeMs, staleAfterMs } = snapshot.state.metadata.freshness;
  if (
    sourceAgeMs === null ||
    staleAfterMs === null ||
    sourceAgeMs > staleAfterMs
  ) {
    throw new Error(
      `Current ${venue} market data freshness is unavailable or stale`,
    );
  }

  const marketAsset = snapshot.state.market.baseAsset.trim().toUpperCase();
  if (
    !marketAsset ||
    !snapshot.state.market.marketId?.trim() ||
    !snapshot.state.market.symbol.trim() ||
    snapshot.state.market.venue !== venue ||
    snapshot.venue !== venue ||
    snapshot.symbol !== snapshot.state.market.symbol
  ) {
    throw new Error(`Current ${venue} market identity is invalid`);
  }
  if (
    !snapshot.state.metadata.observedAt ||
    !Number.isFinite(Date.parse(snapshot.state.metadata.observedAt))
  ) {
    throw new Error(
      `Current ${venue} observation timestamp is unavailable or invalid`,
    );
  }

  const score = snapshot.risk.overallScore;
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error(`Current ${venue} risk score is outside the valid range`);
  }

  if (!Number.isFinite(Date.parse(snapshot.risk.timestamp))) {
    throw new Error(`Current ${venue} risk timestamp is invalid`);
  }

  return snapshot;
}

/** Maps current engine results into bounded policy arguments for the Vault. */
export function buildRiskPolicyDecision(
  ecosystem: EcosystemRisk,
  contagionState: ContagionStatus,
): RiskPolicyDecision {
  if (
    !(["NONE", "ISOLATED", "DEVELOPING", "ACTIVE"] as string[]).includes(
      contagionState,
    )
  ) {
    throw new Error("Contagion state is invalid");
  }
  const snapshots = requiredVenues.map((venue) =>
    getCurrentSnapshot(ecosystem.venueSnapshots, venue),
  );
  const assets = new Set(
    snapshots.map((snapshot) =>
      snapshot.state.market.baseAsset.trim().toUpperCase(),
    ),
  );
  if (assets.size !== 1 || !assets.has(ecosystem.asset.trim().toUpperCase())) {
    throw new Error("Ecosystem asset does not match the current venue markets");
  }
  const scores = snapshots.map((snapshot) => snapshot.risk!.overallScore);

  if (ecosystem.ecosystemScore !== null) {
    if (
      !Number.isInteger(ecosystem.ecosystemScore) ||
      ecosystem.ecosystemScore < 0 ||
      ecosystem.ecosystemScore > 100
    ) {
      throw new Error("Ecosystem risk score is outside the valid range");
    }
    scores.push(ecosystem.ecosystemScore);
  }

  const riskScore = Math.max(...scores);
  const riskLevel = scoreToLevel(riskScore);
  let maxLeverageX100 = venueRiskCaps[riskLevel];

  if (contagionState === "DEVELOPING") {
    maxLeverageX100 = Math.min(maxLeverageX100, 100);
  } else if (contagionState === "ACTIVE") {
    maxLeverageX100 = 0;
  }

  // Use source observation time, not local collection/calculation time. This
  // keeps delayed publishing from refreshing old market observations.
  const observedAt = Math.floor(
    Math.min(
      ...snapshots.map((snapshot) =>
        Date.parse(snapshot.state.metadata.observedAt!),
      ),
    ) / 1000,
  );

  return {
    riskLevel,
    riskScore,
    contagionState,
    maxLeverageX100,
    observedAt,
  };
}
