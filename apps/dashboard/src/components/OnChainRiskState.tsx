import type { ChainSnapshot } from "../solana/client";
import type { DashboardSnapshot } from "../../../../packages/api-contracts/src/dashboard";
import { riskStateMatchesDecision } from "../../../risk-publisher/src/risk-state";

function formatDate(seconds: number): string {
  if (!seconds) return "Never updated";
  return new Date(seconds * 1000).toLocaleString();
}

function statusLabel(status: ChainSnapshot["status"]): string {
  return {
    unconfigured: "NOT CONFIGURED",
    available: "LIVE ON-CHAIN",
    stale: "STALE",
    network_mismatch: "WRONG CLUSTER",
    not_found: "ACCOUNT NOT FOUND",
    invalid: "INVALID ACCOUNT DATA",
    unavailable: "RPC UNAVAILABLE",
  }[status];
}

export function OnChainRiskState({
  snapshot,
  decision,
}: {
  snapshot: ChainSnapshot;
  decision: DashboardSnapshot["policy"]["decision"];
}) {
  const state = snapshot.riskState;
  const tone =
    snapshot.status === "available"
      ? "low"
      : snapshot.status === "stale"
        ? "medium"
        : "neutral";
  const comparison =
    state && decision
      ? riskStateMatchesDecision(state, decision)
        ? "MATCH"
        : "MISMATCH"
      : "NOT COMPARED";
  return (
    <section className="card chain-state-card" aria-label="On-chain risk state">
      <div className="card-title">
        <div>
          <span className="mini-icon blue">⛓</span>
          <h2>On-chain RiskState</h2>
        </div>
        <span className={`badge badge-${tone}`}>
          {statusLabel(snapshot.status)}
        </span>
      </div>
      <p className="chain-explainer">
        Verified read-only Anchor account data. This state is stored on the
        configured Solana cluster.
      </p>
      {state ? (
        <div className="chain-values">
          <div className="metric-line">
            <span>Risk level / score</span>
            <strong>
              {state.riskLevel.toUpperCase()} · {state.riskScore}/100
            </strong>
          </div>
          <div className="metric-line">
            <span>Contagion state</span>
            <strong>{state.contagionState}</strong>
          </div>
          <div className="metric-line">
            <span>Max leverage cap</span>
            <strong>{(state.maxLeverageX100 / 100).toFixed(2)}×</strong>
          </div>
          <div className="metric-line">
            <span>Nonce</span>
            <strong>{state.nonce.toString()}</strong>
          </div>
          <div className="metric-line">
            <span>Off-chain policy comparison</span>
            <strong>{comparison}</strong>
          </div>
          <div className="metric-line">
            <span>Observed at</span>
            <strong>{formatDate(state.observedAt)}</strong>
          </div>
          <div className="metric-line">
            <span>Updated at</span>
            <strong>{formatDate(state.updatedAt)}</strong>
          </div>
        </div>
      ) : (
        <div className="empty-state compact chain-message" role="status">
          {snapshot.error ?? "On-chain RiskState is unavailable."}
        </div>
      )}
      <dl className="chain-meta">
        <div>
          <dt>Cluster</dt>
          <dd>{snapshot.cluster ?? "—"}</dd>
        </div>
        <div>
          <dt>Vault PDA</dt>
          <dd title={snapshot.vaultAddress ?? undefined}>
            {snapshot.vaultAddress ?? "Not derived"}
          </dd>
        </div>
        <div>
          <dt>RiskState PDA</dt>
          <dd title={snapshot.riskStateAddress ?? undefined}>
            {snapshot.riskStateAddress ?? "Not derived"}
          </dd>
        </div>
        <div>
          <dt>Program ID</dt>
          <dd title={snapshot.programId}>{snapshot.programId}</dd>
        </div>
        <div>
          <dt>RPC slot</dt>
          <dd>{snapshot.slot ?? "—"}</dd>
        </div>
        <div>
          <dt>Read checked</dt>
          <dd>{new Date(snapshot.fetchedAt).toLocaleTimeString()}</dd>
        </div>
      </dl>
      {snapshot.vault && (
        <dl className="chain-meta chain-meta-secondary">
          <div>
            <dt>Collateral mint</dt>
            <dd title={snapshot.vault.collateralMint}>
              {snapshot.vault.collateralMint}
            </dd>
          </div>
          <div>
            <dt>Risk authority</dt>
            <dd title={snapshot.vault.riskAuthority}>
              {snapshot.vault.riskAuthority}
            </dd>
          </div>
        </dl>
      )}
      <p className="policy-note">
        No wallet is connected. This panel never submits transactions. Compare
        this value with the separate off-chain policy panel.
      </p>
    </section>
  );
}
