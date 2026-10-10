import type { DashboardSnapshot } from "../../../../packages/api-contracts/src/dashboard";
import type { ChainSnapshot } from "../solana/client";
import { useWallet } from "../solana/wallet";

export function LiveReadiness({
  snapshot,
  chainSnapshot,
}: {
  snapshot: DashboardSnapshot | null;
  chainSnapshot: ChainSnapshot;
}) {
  const wallet = useWallet();

  const venues = snapshot?.venues ?? [];
  const velocityLive = venues.some(
    (v) => v.venue === "velocity" && v.status === "available",
  );
  const phoenixLive = venues.some(
    (v) => v.venue === "phoenix" && v.status === "available",
  );
  const policyAvailable = Boolean(snapshot?.policy.decision);
  const chainVerified = chainSnapshot.status === "available";
  const walletReady = Boolean(wallet.connected && wallet.publicKey);

  const checks = [
    {
      label: "Velocity Feed",
      detail: velocityLive ? "Live & fresh (<5s)" : "Feed offline / stale",
      ready: velocityLive,
    },
    {
      label: "Phoenix Orderbook",
      detail: phoenixLive ? "Top-of-book depth live" : "Feed offline / stale",
      ready: phoenixLive,
    },
    {
      label: "Off-Chain Risk Engine",
      detail: policyAvailable
        ? `Policy: ${snapshot?.policy.decision?.riskLevel.toUpperCase()}`
        : "Feeds insufficient",
      ready: policyAvailable,
    },
    {
      label: "Anchor Program & PDAs",
      detail: chainSnapshot.programId
        ? `Program ${chainSnapshot.programId.slice(0, 4)}…${chainSnapshot.programId.slice(-4)}`
        : "Program ID unconfigured",
      ready: Boolean(chainSnapshot.programId),
    },
    {
      label: "On-Chain RiskState",
      detail: chainVerified
        ? `Nonce #${chainSnapshot.riskState?.nonce.toString()} verified`
        : chainSnapshot.status === "not_found"
          ? "Devnet ready (awaiting first publish)"
          : "Not available",
      ready: chainVerified || chainSnapshot.status === "not_found",
    },
    {
      label: "Trader Wallet",
      detail: walletReady
        ? `Connected: ${wallet.publicKey?.toBase58().slice(0, 4)}…`
        : "Not connected (read-only)",
      ready: walletReady,
    },
  ];

  return (
    <section
      className="card live-readiness-card"
      aria-label="System readiness checklist"
    >
      <div className="card-title">
        <div>
          <span className="mini-icon blue">🛡️</span>
          <h2>System Operational Readiness</h2>
        </div>
        <span className="badge badge-low">PHASE 5 VERIFIED</span>
      </div>

      <p className="readiness-explainer">
        Cryptographic and telemetry readiness across market adapters, policy
        orchestrator, and Solana cluster enforcement.
      </p>

      <div className="readiness-grid">
        {checks.map((check) => (
          <div key={check.label} className="readiness-item">
            <span
              className={`readiness-indicator ${check.ready ? "ready" : "pending"}`}
            >
              {check.ready ? "✓" : "○"}
            </span>
            <div className="readiness-item-text">
              <strong>{check.label}</strong>
              <small>{check.detail}</small>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
