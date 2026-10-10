import type { DashboardSnapshot } from "../../../../packages/api-contracts/src/dashboard";
import type { ChainSnapshot } from "../solana/client";

export function ProtocolFlow({
  snapshot,
  chainSnapshot,
}: {
  snapshot: DashboardSnapshot | null;
  chainSnapshot: ChainSnapshot;
}) {
  const policy = snapshot?.policy.decision;
  const onChainState = chainSnapshot.riskState;
  const venues = snapshot?.venues ?? [];

  return (
    <section className="card protocol-flow-card" aria-label="End-to-end protocol flow">
      <div className="card-title">
        <div>
          <span className="mini-icon orange">🔄</span>
          <h2>End-to-End Risk Orchestration Flow</h2>
        </div>
        <span className="badge badge-neutral">CONTINUOUS LOOP</span>
      </div>

      <p className="flow-explainer">
        Real-time telemetry pipeline: telemetry is collected off-chain, signed by an authenticated risk publisher, and verified on-chain to restrict position leverage.
      </p>

      <div className="flow-diagram-container">
        {/* Node 1: Multi-Venue Ingestion */}
        <div className="flow-step-node">
          <div className="flow-node-badge">1. TELEMETRY</div>
          <h4>Multi-Venue Ingestion</h4>
          <p>Velocity & Phoenix perpetual markets stream orderbook depth, spreads, funding rates, and volume.</p>
          <div className="flow-pill-row">
            {venues.map((v) => (
              <span key={v.venue} className={`venue-tag ${v.status === "available" ? "active" : ""}`}>
                {v.venue.toUpperCase()}
              </span>
            ))}
          </div>
        </div>

        <div className="flow-arrow-connector">→</div>

        {/* Node 2: Risk & Policy Engine */}
        <div className="flow-step-node">
          <div className="flow-node-badge">2. SYSTEMIC ENGINE</div>
          <h4>Divergence & Policy</h4>
          <p>HHI concentration, price disparity, and contagion models compute the maximum risk score.</p>
          <div className="flow-stat-box">
            <span>Score:</span> <strong>{policy ? `${policy.riskScore}/100` : "—"}</strong>
            <span>Cap:</span> <strong>{policy ? `${(policy.maxLeverageX100 / 100).toFixed(2)}×` : "—"}</strong>
          </div>
        </div>

        <div className="flow-arrow-connector">→</div>

        {/* Node 3: Risk Publisher */}
        <div className="flow-step-node">
          <div className="flow-node-badge">3. PUBLISHER</div>
          <h4>Authenticated Commit</h4>
          <p>Dedicated authority signs <code>update_risk_state</code> transactions with monotonic nonces.</p>
          <div className="flow-stat-box">
            <span>Status:</span> <strong>{onChainState ? "ACTIVE" : "AWAITING"}</strong>
          </div>
        </div>

        <div className="flow-arrow-connector">→</div>

        {/* Node 4: On-Chain Anchor Vault */}
        <div className="flow-step-node highlighted">
          <div className="flow-node-badge">4. SOLANA ANCHOR</div>
          <h4>Contract Enforcement</h4>
          <p>The <code>risk_vault</code> program verifies the RiskState PDA before any user position increases.</p>
          <div className="flow-stat-box">
            <span>Enforced Cap:</span> <strong>{onChainState ? `${(onChainState.maxLeverageX100 / 100).toFixed(2)}×` : policy ? `${(policy.maxLeverageX100 / 100).toFixed(2)}×` : "—"}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
