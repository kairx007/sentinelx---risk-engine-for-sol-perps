import { useState, useId } from "react";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";
import { useWallet } from "../solana/wallet";
import type { ChainSnapshot } from "../solana/client";
import {
  buildIncreasePositionInstruction,
  buildReducePositionInstruction,
  buildClosePositionInstruction,
  PositionSide,
} from "../solana/transactions";

// Default Pyth & market placeholders for SOL-PERP devnet demonstration
const DEFAULT_SOL_PERP_MARKET = "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4SE5nv";
const DEFAULT_PYTH_FEED = "7UVimffxr9ow1ukKttssAKBiNdTe2deMm98qwx5Y8NNd";

export function UserTransactionPanel({
  chainSnapshot,
}: {
  chainSnapshot: ChainSnapshot;
}) {
  const wallet = useWallet();
  const formId = useId();

  const [activeTab, setActiveTab] = useState<"increase" | "reduce" | "close">(
    "increase",
  );
  const [side, setSide] = useState<PositionSide>(PositionSide.Long);
  const [sizeSol, setSizeSol] = useState("1.0");
  const [collateralUsdc, setCollateralUsdc] = useState("50.0");
  const [simulating, setSimulating] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const riskState = chainSnapshot.riskState;
  const maxLeverage = riskState ? riskState.maxLeverageX100 / 100 : 2.0;

  // Approximate SOL price ~$150 for requested leverage preview
  const estimatedPrice = 150;
  const parsedSize = parseFloat(sizeSol) || 0;
  const parsedCollateral = parseFloat(collateralUsdc) || 1;
  const notionalUsd = parsedSize * estimatedPrice;
  const requestedLeverage =
    parsedCollateral > 0 ? notionalUsd / parsedCollateral : 0;
  const exceedsCap =
    activeTab === "increase" && requestedLeverage > maxLeverage;

  const handleSimulateAndSend = async () => {
    if (!wallet.connected || !wallet.publicKey) {
      await wallet.connect();
      return;
    }

    setSimulating(true);
    setTxStatus("Building & Simulating transaction…");
    setTxError(null);

    try {
      const connection = new Connection(
        process.env.VITE_CHAIN_RPC_URL || "https://api.devnet.solana.com",
        "confirmed",
      );

      const collateralMint = new PublicKey(
        chainSnapshot.vault?.collateralMint ||
          "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      );
      const market = new PublicKey(DEFAULT_SOL_PERP_MARKET);
      const oracleUpdateAccount = new PublicKey(DEFAULT_PYTH_FEED);

      let ix;
      if (activeTab === "increase") {
        const sizeDelta = BigInt(Math.round(parsedSize * 1_000_000));
        const notionalDelta = BigInt(Math.round(notionalUsd * 1_000_000));
        const collateralDelta = BigInt(
          Math.round(parsedCollateral * 1_000_000),
        );

        ix = buildIncreasePositionInstruction({
          owner: wallet.publicKey,
          collateralMint,
          market,
          oracleUpdateAccount,
          side,
          sizeDelta,
          notionalDelta,
          collateralDelta,
        });
      } else if (activeTab === "reduce") {
        const sizeDelta = BigInt(Math.round(parsedSize * 1_000_000));
        const notionalDelta = BigInt(Math.round(notionalUsd * 1_000_000));

        ix = buildReducePositionInstruction({
          owner: wallet.publicKey,
          collateralMint,
          market,
          oracleUpdateAccount,
          sizeDelta,
          notionalDelta,
        });
      } else {
        ix = buildClosePositionInstruction({
          owner: wallet.publicKey,
          collateralMint,
          market,
          oracleUpdateAccount,
        });
      }

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: wallet.publicKey,
      }).add(ix);

      // Pre-flight simulation
      const simulation = await connection.simulateTransaction(transaction);
      if (simulation.value.err) {
        throw new Error(
          `On-chain simulation rejected: ${JSON.stringify(simulation.value.err)}`,
        );
      }

      setTxStatus("Simulation passed! Awaiting wallet signature…");
      if (wallet.signTransaction) {
        const signedTx = await wallet.signTransaction(transaction);
        setTxStatus("Broadcasting to Solana cluster…");
        const sig = await connection.sendRawTransaction(signedTx.serialize());
        setTxStatus(
          `Confirmed: https://explorer.solana.com/tx/${sig}?cluster=devnet`,
        );
      }
    } catch (err: any) {
      setTxError(err.message || "Transaction failed");
      setTxStatus(null);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <section className="card user-tx-card" aria-label="User position controls">
      <div className="card-title">
        <div>
          <span className="mini-icon orange">⚡</span>
          <h2>Position Execution & On-Chain Gate</h2>
        </div>
        <span className="badge badge-neutral">PHASE 4 ACTIVE</span>
      </div>

      <div className="tx-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "increase"}
          className={`tx-tab ${activeTab === "increase" ? "selected" : ""}`}
          onClick={() => setActiveTab("increase")}
        >
          Increase
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "reduce"}
          className={`tx-tab ${activeTab === "reduce" ? "selected" : ""}`}
          onClick={() => setActiveTab("reduce")}
        >
          Reduce
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "close"}
          className={`tx-tab ${activeTab === "close" ? "selected" : ""}`}
          onClick={() => setActiveTab("close")}
        >
          Close
        </button>
      </div>

      {activeTab === "increase" && (
        <div className="tx-form">
          <div className="side-selector">
            <button
              type="button"
              className={`side-btn ${side === PositionSide.Long ? "long active" : ""}`}
              onClick={() => setSide(PositionSide.Long)}
            >
              LONG
            </button>
            <button
              type="button"
              className={`side-btn ${side === PositionSide.Short ? "short active" : ""}`}
              onClick={() => setSide(PositionSide.Short)}
            >
              SHORT
            </button>
          </div>

          <div className="input-row">
            <div>
              <label htmlFor={`${formId}-size`}>Position Size (SOL)</label>
              <input
                id={`${formId}-size`}
                type="number"
                value={sizeSol}
                onChange={(e) => setSizeSol(e.target.value)}
                step="0.1"
                min="0.1"
              />
            </div>
            <div>
              <label htmlFor={`${formId}-collateral`}>
                Collateral Deposit (USDC)
              </label>
              <input
                id={`${formId}-collateral`}
                type="number"
                value={collateralUsdc}
                onChange={(e) => setCollateralUsdc(e.target.value)}
                step="5"
                min="5"
              />
            </div>
          </div>

          <div className="leverage-indicator-row">
            <span className="label">Requested Leverage:</span>
            <strong
              className={exceedsCap ? "leverage-breached" : "leverage-safe"}
            >
              {requestedLeverage.toFixed(2)}×
            </strong>
            <span className="cap-label">
              (Max Cap: {maxLeverage.toFixed(2)}×)
            </span>
          </div>

          {exceedsCap && (
            <div className="leverage-warning-callout">
              ⚠️ Requested leverage ({requestedLeverage.toFixed(2)}×) exceeds
              on-chain RiskState cap ({maxLeverage.toFixed(2)}×). Transaction
              will be rejected by the contract.
            </div>
          )}
        </div>
      )}

      {activeTab === "reduce" && (
        <div className="tx-form">
          <div className="input-row">
            <div>
              <label htmlFor={`${formId}-reduce-size`}>
                Size to Reduce (SOL)
              </label>
              <input
                id={`${formId}-reduce-size`}
                type="number"
                value={sizeSol}
                onChange={(e) => setSizeSol(e.target.value)}
                step="0.1"
                min="0.1"
              />
            </div>
          </div>
          <p className="tx-note">
            Risk-reducing action: Lowering position size is authorized
            regardless of risk state elevation.
          </p>
        </div>
      )}

      {activeTab === "close" && (
        <div className="tx-form">
          <p className="tx-note">
            Full exit: Closes open position and settles available margin back to
            UserVaultAccount.
          </p>
        </div>
      )}

      {txStatus && <div className="tx-status-notice">{txStatus}</div>}
      {txError && <div className="tx-error-notice">{txError}</div>}

      <div className="tx-actions">
        {!wallet.connected ? (
          <button
            type="button"
            className="button button-primary tx-submit-btn"
            onClick={wallet.connect}
          >
            Connect Wallet to Transact
          </button>
        ) : (
          <button
            type="button"
            className="button button-primary tx-submit-btn"
            onClick={handleSimulateAndSend}
            disabled={simulating || exceedsCap}
          >
            {simulating
              ? "Simulating…"
              : exceedsCap
                ? "Exceeds Leverage Cap"
                : `Simulate & Submit ${activeTab.toUpperCase()}`}
          </button>
        )}
      </div>
    </section>
  );
}
