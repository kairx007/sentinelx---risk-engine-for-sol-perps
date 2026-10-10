import { useState } from "react";
import type { ChainSnapshot } from "../solana/client";
import type { DashboardSnapshot } from "../../../../packages/api-contracts/src/dashboard";
import { riskStateMatchesDecision } from "../../../risk-publisher/src/risk-state";

function formatDate(seconds: number): string {
  if (!seconds) return "Never updated";
  return new Date(seconds * 1000).toLocaleString();
}

function truncateAddress(address: string | null | undefined, chars = 5): string {
  if (!address) return "—";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

function getExplorerUrl(address: string, cluster: string | null): string {
  const c = cluster === "mainnet-beta" ? "" : `?cluster=${cluster || "devnet"}`;
  return `https://explorer.solana.com/address/${address}${c}`;
}

function AddressPill({
  address,
  cluster,
  label,
  derivation,
}: {
  address: string | null | undefined;
  cluster: string | null;
  label: string;
  derivation?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!address) return;
    try {
      navigator.clipboard?.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failures in restricted environments
    }
  };

  const isDerived = Boolean(address);

  return (
    <div className="chain-account-card">
      <div className="chain-account-meta">
        <span className="chain-account-label">{label}</span>
        {derivation && <span className="chain-account-derivation">{derivation}</span>}
      </div>
      <div className="chain-account-value">
        {isDerived ? (
          <>
            <code className="chain-address-code" title={address!}>
              {truncateAddress(address, 5)}
            </code>
            <div className="chain-account-actions">
              <button
                type="button"
                className={`chain-icon-btn ${copied ? "copied" : ""}`}
                onClick={handleCopy}
                title={copied ? "Copied!" : "Copy address to clipboard"}
                aria-label={`Copy ${label} address`}
              >
                {copied ? (
                  <span className="chain-copied-badge">Copied</span>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
              <a
                href={getExplorerUrl(address!, cluster)}
                target="_blank"
                rel="noopener noreferrer"
                className="chain-icon-btn"
                title="View on Solana Explorer"
                aria-label={`View ${label} on Solana Explorer`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          </>
        ) : (
          <span className="chain-not-derived">Not derived</span>
        )}
      </div>
    </div>
  );
}

function getStatusDetails(status: ChainSnapshot["status"]): {
  label: string;
  badgeTone: "low" | "medium" | "high" | "neutral";
  dotColor: string;
} {
  switch (status) {
    case "available":
      return { label: "LIVE ON-CHAIN", badgeTone: "low", dotColor: "#39a26b" };
    case "stale":
      return { label: "STALE", badgeTone: "medium", dotColor: "#d5a54f" };
    case "not_found":
      return { label: "AWAITING INIT", badgeTone: "neutral", dotColor: "#84908b" };
    case "unconfigured":
      return { label: "NOT CONFIGURED", badgeTone: "neutral", dotColor: "#84908b" };
    case "network_mismatch":
      return { label: "WRONG CLUSTER", badgeTone: "high", dotColor: "#db8356" };
    case "invalid":
      return { label: "INVALID DATA", badgeTone: "high", dotColor: "#db8356" };
    case "unavailable":
      return { label: "RPC UNAVAILABLE", badgeTone: "neutral", dotColor: "#84908b" };
  }
}

export function OnChainRiskState({
  snapshot,
  decision,
}: {
  snapshot: ChainSnapshot;
  decision: DashboardSnapshot["policy"]["decision"];
}) {
  const state = snapshot.riskState;
  const statusInfo = getStatusDetails(snapshot.status);

  // Sync comparison
  const isMatch = state && decision ? riskStateMatchesDecision(state, decision) : null;

  // Active risk parameters to present (either verified on-chain or staged off-chain decision)
  const riskLevel = state?.riskLevel ?? decision?.riskLevel ?? null;
  const riskScore = state?.riskScore ?? decision?.riskScore ?? null;
  const contagionState = state?.contagionState ?? decision?.contagionState ?? null;
  const maxLeverage = state
    ? (state.maxLeverageX100 / 100).toFixed(2)
    : decision
      ? (decision.maxLeverageX100 / 100).toFixed(2)
      : null;

  const scoreTone =
    riskLevel === "critical" || riskLevel === "high"
      ? "high"
      : riskLevel === "medium"
        ? "medium"
        : riskLevel === "low"
          ? "low"
          : "neutral";

  return (
    <section className="card chain-state-card" aria-label="On-chain risk state">
      {/* Header */}
      <div className="chain-card-header">
        <div className="chain-header-left">
          <span className="mini-icon blue" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </span>
          <div>
            <div className="chain-title-row">
              <h2>On-Chain RiskState</h2>
              <span className="chain-network-tag">
                <span className="chain-cluster-dot" style={{ backgroundColor: statusInfo.dotColor }} />
                {snapshot.cluster ?? "devnet"}
              </span>
            </div>
            <p className="chain-subtitle">
              Verified Anchor account state on Solana · Zero-copy deserialization
            </p>
          </div>
        </div>

        <div className="chain-header-right">
          <span className={`badge badge-${statusInfo.badgeTone}`}>
            {statusInfo.label}
          </span>
        </div>
      </div>

      {/* Status banner */}
      {snapshot.status === "available" && state ? (
        <div className="chain-banner chain-banner-success">
          <div className="chain-banner-badge">VERIFIED</div>
          <p>
            Anchor program account verified at slot <strong>#{snapshot.slot?.toLocaleString() ?? "—"}</strong>.
            {isMatch === true && " State perfectly matches active off-chain risk calculations."}
            {isMatch === false && " Off-chain policy has updated; on-chain synchronization pending."}
          </p>
        </div>
      ) : snapshot.status === "not_found" ? (
        <div className="chain-banner chain-banner-info">
          <div className="chain-banner-badge">DEVNET READY</div>
          <p>
            Anchor program is live on Solana Devnet. Risk accounts are awaiting initial policy publication.
            Displaying staged risk policy parameters below.
          </p>
        </div>
      ) : snapshot.status === "stale" ? (
        <div className="chain-banner chain-banner-warning">
          <div className="chain-banner-badge">STALE</div>
          <p>On-chain risk parameters have exceeded the maximum staleness freshness threshold.</p>
        </div>
      ) : snapshot.error ? (
        <div className="chain-banner chain-banner-neutral">
          <div className="chain-banner-badge">STATUS</div>
          <p>{snapshot.error}</p>
        </div>
      ) : null}

      {/* Key Metric Tiles */}
      {(state || decision) && (
        <div className="chain-metrics-grid">
          {/* Card 1: Risk Assessment */}
          <div className="chain-metric-card">
            <span className="chain-metric-label">Risk Level & Score</span>
            <div className="chain-metric-value-row">
              <strong className="chain-metric-score">
                {riskLevel ? riskLevel.toUpperCase() : "—"}
              </strong>
              {riskScore !== null && (
                <span className="chain-metric-score-denom">
                  {riskScore}<span>/100</span>
                </span>
              )}
            </div>
            <div className="risk-bar" style={{ width: "100%", marginTop: "8px" }}>
              <i
                className={`fill-${scoreTone}`}
                style={{ width: `${Math.max(5, Math.min(100, riskScore ?? 0))}%` }}
              />
            </div>
          </div>

          {/* Card 2: Contagion State */}
          <div className="chain-metric-card">
            <span className="chain-metric-label">Contagion State</span>
            <div className="chain-metric-value-row">
              <strong className="chain-metric-score">
                {contagionState ? contagionState.toUpperCase() : "—"}
              </strong>
            </div>
            <span className="chain-metric-subtext">
              {contagionState === "contained"
                ? "Low systemic spillover risk"
                : contagionState === "emerging"
                  ? "Elevated market fragility"
                  : "Active systemic contagion"}
            </span>
          </div>

          {/* Card 3: Max Leverage Ceiling */}
          <div className="chain-metric-card">
            <span className="chain-metric-label">Max Leverage Cap</span>
            <div className="chain-metric-value-row">
              <strong className="chain-metric-score">
                {maxLeverage ? `${maxLeverage}×` : "—"}
              </strong>
            </div>
            <span className="chain-metric-subtext">Dynamic liquidation safety cap</span>
          </div>

          {/* Card 4: Publication / Nonce */}
          <div className="chain-metric-card">
            <span className="chain-metric-label">Publication Sync</span>
            <div className="chain-metric-value-row">
              <strong className="chain-metric-score" style={{ fontSize: "12px", letterSpacing: "0.2px" }}>
                {state ? `Nonce #${state.nonce.toString()}` : "Staged for Publish"}
              </strong>
            </div>
            <span className="chain-metric-subtext">
              {state
                ? `Updated ${formatDate(state.updatedAt)}`
                : "Awaiting risk-publisher run"}
            </span>
          </div>
        </div>
      )}

      {/* Account Verification Section */}
      <div className="chain-accounts-section">
        <div className="chain-accounts-title-row">
          <h3>Anchor Accounts & PDA Verification</h3>
          <span className="chain-security-badge">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Cryptographic Integrity
          </span>
        </div>

        <div className="chain-accounts-grid">
          <AddressPill
            label="Anchor Program ID"
            derivation="Risk Engine Executable"
            address={snapshot.programId}
            cluster={snapshot.cluster}
          />
          <AddressPill
            label="Vault PDA"
            derivation='["vault", collateral_mint]'
            address={snapshot.vaultAddress}
            cluster={snapshot.cluster}
          />
          <AddressPill
            label="RiskState PDA"
            derivation='["risk_state", vault]'
            address={snapshot.riskStateAddress}
            cluster={snapshot.cluster}
          />
          {snapshot.vault && (
            <>
              <AddressPill
                label="Collateral Mint"
                derivation="Settlement Token"
                address={snapshot.vault.collateralMint}
                cluster={snapshot.cluster}
              />
              <AddressPill
                label="Risk Authority"
                derivation="Authorized Publisher"
                address={snapshot.vault.riskAuthority}
                cluster={snapshot.cluster}
              />
            </>
          )}
        </div>
      </div>

      {/* Diagnostics & Read Guarantee Footer */}
      <div className="chain-card-footer">
        <div className="chain-diagnostics-items">
          <div className="chain-diag-item">
            <span>Cluster</span>
            <strong>{snapshot.cluster ?? "devnet"}</strong>
          </div>
          <div className="chain-diag-item">
            <span>RPC Slot</span>
            <strong>{snapshot.slot ? snapshot.slot.toLocaleString() : "—"}</strong>
          </div>
          <div className="chain-diag-item">
            <span>Read Checked</span>
            <strong>{new Date(snapshot.fetchedAt).toLocaleTimeString()}</strong>
          </div>
        </div>
        <p className="chain-footer-note">
          Verified via read-only Solana RPC. No wallet connection or transaction signing required.
        </p>
      </div>
    </section>
  );
}
