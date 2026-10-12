import { useState, useId } from "react";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";
import { useWallet } from "../solana/wallet";
import type { ChainSnapshot } from "../solana/client";
import {
  buildIncreasePositionInstruction,
  buildReducePositionInstruction,
  buildClosePositionInstruction,
  buildInitializeUserVaultAccountInstruction,
  buildDepositInstruction,
  deriveUserVaultAddress,
  decodeUserVaultAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  parsePythPriceUpdateV2,
  notionalForSize,
  PositionSide,
} from "../solana/transactions";
import { deriveVaultAddress } from "../../../risk-publisher/src/risk-state";

// Live Pyth PriceUpdateV2 account for SOL/USD on Solana Devnet
const DEFAULT_SOL_PERP_MARKET = "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4SE5nv";
const DEFAULT_PYTH_FEED = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";

export function UserTransactionPanel({
  chainSnapshot,
}: {
  chainSnapshot: ChainSnapshot;
}) {
  const wallet = useWallet();
  const formId = useId();

  const [activeTab, setActiveTab] = useState<
    "deposit" | "increase" | "reduce" | "close"
  >("increase");
  const [depositAmount, setDepositAmount] = useState("100.0");
  const [side, setSide] = useState<PositionSide>(PositionSide.Long);
  const [sizeSol, setSizeSol] = useState("1.0");
  const [collateralUsdc, setCollateralUsdc] = useState("50.0");
  const [simulating, setSimulating] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const [airdropping, setAirdropping] = useState(false);
  const [airdropMsg, setAirdropMsg] = useState<string | null>(null);

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

  const handleAirdrop = async () => {
    if (!wallet.connected || !wallet.publicKey) {
      await wallet.connect();
      return;
    }
    setAirdropping(true);
    setAirdropMsg("Requesting 100 test USDC airdrop from Devnet faucet…");
    setTxError(null);
    try {
      const res = await fetch("/api/faucet/usdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: wallet.publicKey.toBase58() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Faucet request failed.");
      }
      setAirdropMsg(
        `Received 100 Test USDC! (Tx: ${data.txSignature?.slice(0, 8)}…)`,
      );
    } catch (err: any) {
      setTxError(err.message || "Failed to airdrop test USDC.");
      setAirdropMsg(null);
    } finally {
      setAirdropping(false);
    }
  };

  const handleSimulateAndSend = async () => {
    if (!wallet.connected || !wallet.publicKey) {
      await wallet.connect();
      return;
    }

    setSimulating(true);
    setTxStatus("Building & Simulating transaction…");
    setTxError(null);

    try {
      const rpcUrl =
        (import.meta as any).env?.VITE_CHAIN_RPC_URL || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");

      const collateralMint = new PublicKey(
        chainSnapshot.vault?.collateralMint ||
          (import.meta as any).env?.VITE_COLLATERAL_MINT ||
          "49rjDqfTwbMZhiayCRaRWhtUyoduSWSzQTD2FdV12xxx",
      );
      const market = new PublicKey(DEFAULT_SOL_PERP_MARKET);
      const oracleUpdateAccount = new PublicKey(DEFAULT_PYTH_FEED);

      const [vault] = deriveVaultAddress(collateralMint);
      const [userVaultAddress] = deriveUserVaultAddress(
        vault,
        wallet.publicKey,
      );
      const userVaultInfo = await connection.getAccountInfo(userVaultAddress);
      const userAta = getAssociatedTokenAddressSync(
        collateralMint,
        wallet.publicKey,
      );
      const userAtaInfo = await connection.getAccountInfo(userAta);

      // Check whether user has 0 shares
      let userShares = 0n;
      if (userVaultInfo) {
        try {
          const decoded = decodeUserVaultAccount(userVaultInfo.data);
          userShares = decoded.shares;
        } catch {
          userShares = 0n;
        }
      }

      const transaction = new Transaction();

      // Ensure user ATA exists if performing a deposit or if auto-depositing
      const needsDeposit =
        activeTab === "deposit" ||
        (activeTab === "increase" && (!userVaultInfo || userShares === 0n));

      if (!userAtaInfo && needsDeposit) {
        setTxStatus("Creating Associated Token Account for collateral…");
        const createAtaIx = createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userAta,
          wallet.publicKey,
          collateralMint,
        );
        transaction.add(createAtaIx);
      }

      // Ensure UserVaultAccount exists
      if (!userVaultInfo) {
        setTxStatus(
          "Account not initialized. Adding initialization instruction…",
        );
        const initUserVaultIx = buildInitializeUserVaultAccountInstruction({
          owner: wallet.publicKey,
          collateralMint,
        });
        transaction.add(initUserVaultIx);
      }

      // If user has zero shares on increase, automatically prepend a deposit of the initial collateral!
      if (activeTab === "increase" && (!userVaultInfo || userShares === 0n)) {
        setTxStatus(
          "No vault shares found. Auto-depositing initial margin…",
        );
        const depositAmountAtoms = BigInt(
          Math.max(100, Math.round(parsedCollateral)) * 1_000_000,
        );
        const autoDepositIx = buildDepositInstruction({
          owner: wallet.publicKey,
          collateralMint,
          amount: depositAmountAtoms,
        });
        transaction.add(autoDepositIx);
      }

      let ix;
      if (activeTab === "deposit") {
        const parsedDeposit = parseFloat(depositAmount) || 100;
        const depositAtoms = BigInt(Math.round(parsedDeposit * 1_000_000));
        ix = buildDepositInstruction({
          owner: wallet.publicKey,
          collateralMint,
          amount: depositAtoms,
        });
      } else if (activeTab === "increase") {
        if (parsedSize <= 0 || isNaN(parsedSize)) {
          throw new Error("Position size must be greater than zero.");
        }
        if (parsedCollateral <= 0 || isNaN(parsedCollateral)) {
          throw new Error("Collateral deposit must be greater than zero.");
        }

        setTxStatus("Fetching current oracle price from Pyth…");
        const oracleInfo = await connection.getAccountInfo(oracleUpdateAccount);
        if (!oracleInfo) {
          throw new Error("Unable to read Pyth oracle account from cluster.");
        }
        const { normalizedPrice, publishTime } = parsePythPriceUpdateV2(oracleInfo.data);

        const sizeDelta = BigInt(Math.round(parsedSize * 1_000_000));
        const notionalDelta = notionalForSize(sizeDelta, normalizedPrice);
        const collateralDelta = BigInt(
          Math.round(parsedCollateral * 1_000_000),
        );

        console.log("[Diagnostic: IncreasePosition]", {
          sizeDelta: sizeDelta.toString(),
          normalizedPrice: normalizedPrice.toString(),
          publishTime: publishTime.toString(),
          notionalDelta: notionalDelta.toString(),
          collateralDelta: collateralDelta.toString(),
          side: side === PositionSide.Long ? "LONG" : "SHORT",
        });

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
        if (parsedSize <= 0 || isNaN(parsedSize)) {
          throw new Error("Size to reduce must be greater than zero.");
        }

        setTxStatus("Fetching current oracle price from Pyth…");
        const oracleInfo = await connection.getAccountInfo(oracleUpdateAccount);
        if (!oracleInfo) {
          throw new Error("Unable to read Pyth oracle account from cluster.");
        }
        const { normalizedPrice, publishTime } = parsePythPriceUpdateV2(oracleInfo.data);

        const sizeDelta = BigInt(Math.round(parsedSize * 1_000_000));
        const notionalDelta = notionalForSize(sizeDelta, normalizedPrice);

        console.log("[Diagnostic: ReducePosition]", {
          sizeDelta: sizeDelta.toString(),
          normalizedPrice: normalizedPrice.toString(),
          publishTime: publishTime.toString(),
          notionalDelta: notionalDelta.toString(),
        });

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

      transaction.add(ix);

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey;

      // Pre-flight simulation
      let simulation = await connection.simulateTransaction(transaction);
      if (simulation.value.err) {
        const errorLogs = simulation.value.logs?.join(" ") || "";
        if (errorLogs.includes("RiskStateStale") || errorLogs.includes("6021") || errorLogs.includes("0x1785")) {
          setTxStatus("On-chain RiskState expired (>300s). Refreshing risk pulse…");
          try {
            await fetch("/api/risk/publish-pulse", { method: "POST" });
            // Re-simulate with fresh risk state
            const { blockhash: newBlockhash } = await connection.getLatestBlockhash("confirmed");
            transaction.recentBlockhash = newBlockhash;
            simulation = await connection.simulateTransaction(transaction);
          } catch {
            // Proceed to standard error handling if pulse fails
          }
        }
      }

      if (simulation.value.err) {
        console.error("Simulation error:", simulation.value.err, "Logs:", simulation.value.logs);
        const detailedLogs = simulation.value.logs?.filter((l) => l.includes("Error") || l.includes("failed") || l.includes("Program log"))?.join(" | ");
        throw new Error(
          `On-chain simulation rejected: ${JSON.stringify(simulation.value.err)}${detailedLogs ? ` (${detailedLogs})` : ""}`,
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
          aria-selected={activeTab === "deposit"}
          className={`tx-tab ${activeTab === "deposit" ? "selected" : ""}`}
          onClick={() => setActiveTab("deposit")}
        >
          Deposit
        </button>
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

      {activeTab === "deposit" && (
        <div className="tx-form">
          <div className="input-row">
            <div>
              <label htmlFor={`${formId}-deposit`}>
                Deposit Collateral (USDC)
              </label>
              <input
                id={`${formId}-deposit`}
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                step="10"
                min="1"
              />
            </div>
          </div>
          <p className="tx-note">
            Deposit test collateral (USDC) into the SentinelX vault to mint
            vault shares and fund initial margin for perpetual positions.
          </p>
        </div>
      )}

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

      {airdropMsg && <div className="tx-status-notice" style={{ color: "var(--color-accent-teal, #10b981)" }}>{airdropMsg}</div>}
      {txStatus && <div className="tx-status-notice">{txStatus}</div>}
      {txError && <div className="tx-error-notice">{txError}</div>}

      <div className="tx-actions" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {!wallet.connected ? (
          <button
            type="button"
            className="button button-primary tx-submit-btn"
            onClick={wallet.connect}
          >
            Connect Wallet to Transact
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button button-secondary"
              onClick={handleAirdrop}
              disabled={airdropping}
              title="Airdrop 100 test USDC to your connected wallet"
            >
              {airdropping ? "Airdropping 100 USDC…" : "💧 Airdrop 100 Test USDC"}
            </button>
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
          </>
        )}
      </div>
    </section>
  );
}
