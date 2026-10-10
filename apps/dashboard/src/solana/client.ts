import "../polyfills.js";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  decodeRiskState,
  decodeVaultIdentity,
  deriveRiskStateAddress,
  deriveVaultAddress,
  RISK_VAULT_PROGRAM_ID,
  type RiskStateSnapshot,
} from "../../../risk-publisher/src/risk-state";

const MAX_RISK_STATE_AGE_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 8_000;

export type ChainStatus =
  | "unconfigured"
  | "available"
  | "stale"
  | "network_mismatch"
  | "not_found"
  | "invalid"
  | "unavailable";

export interface ChainSnapshot {
  status: ChainStatus;
  cluster: string | null;
  programId: string;
  vaultAddress: string | null;
  riskStateAddress: string | null;
  riskState: RiskStateSnapshot | null;
  vault: {
    collateralMint: string;
    riskAuthority: string;
  } | null;
  slot: number | null;
  fetchedAt: string;
  error: string | null;
}

export interface ChainConfig {
  rpcUrl: string;
  cluster: string;
  collateralMint: string;
}

export interface ChainReader {
  getAccountInfo(address: PublicKey): Promise<AccountInfo<Buffer> | null>;
  getSlot(): Promise<number>;
  getGenesisHash(): Promise<string>;
}

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_CLUSTER = "devnet";
const DEFAULT_COLLATERAL_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const CLUSTER_GENESIS_HASHES: Record<string, string> = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
};

function result(fields: Omit<ChainSnapshot, "fetchedAt">): ChainSnapshot {
  return { ...fields, fetchedAt: new Date().toISOString() };
}

function configFromEnvironment(): ChainConfig | null {
  const env = ((import.meta as { env?: Record<string, string | undefined> }).env ??
    {}) as Record<string, string | undefined>;
  const rpcUrl = env.VITE_CHAIN_RPC_URL?.trim() || DEFAULT_RPC_URL;
  const cluster = env.VITE_CHAIN_CLUSTER?.trim() || DEFAULT_CLUSTER;
  const collateralMint =
    env.VITE_COLLATERAL_MINT?.trim() || DEFAULT_COLLATERAL_MINT;
  if (!rpcUrl || !cluster || !collateralMint) return null;
  return { rpcUrl, cluster, collateralMint };
}

export async function readOnChainRiskState(
  config: ChainConfig | null = configFromEnvironment(),
  readerFactory: (rpcUrl: string) => ChainReader = (rpcUrl) =>
    new Connection(rpcUrl, { commitment: "confirmed" }),
): Promise<ChainSnapshot> {
  if (!config) {
    return result({
      status: "unconfigured",
      cluster: null,
      programId: RISK_VAULT_PROGRAM_ID.toBase58(),
      vaultAddress: null,
      riskStateAddress: null,
      riskState: null,
      vault: null,
      slot: null,
      error:
        "Set VITE_CHAIN_RPC_URL, VITE_CHAIN_CLUSTER, and VITE_COLLATERAL_MINT to enable chain reads.",
    });
  }
  let collateralMint: PublicKey;
  try {
    collateralMint = new PublicKey(config.collateralMint);
  } catch {
    return result({
      status: "invalid",
      cluster: config.cluster,
      programId: RISK_VAULT_PROGRAM_ID.toBase58(),
      vaultAddress: null,
      riskStateAddress: null,
      riskState: null,
      vault: null,
      slot: null,
      error: "Configured collateral mint is not a valid Solana address.",
    });
  }

  let vaultAddress: PublicKey;
  let riskStateAddress: PublicKey;
  try {
    [vaultAddress] = deriveVaultAddress(collateralMint);
    [riskStateAddress] = deriveRiskStateAddress(vaultAddress);
  } catch (error) {
    return result({
      status: "invalid",
      cluster: config.cluster,
      programId: RISK_VAULT_PROGRAM_ID.toBase58(),
      vaultAddress: null,
      riskStateAddress: null,
      riskState: null,
      vault: null,
      slot: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to derive PDA addresses for the configured collateral mint.",
    });
  }

  const base = {
    cluster: config.cluster,
    programId: RISK_VAULT_PROGRAM_ID.toBase58(),
    vaultAddress: vaultAddress.toBase58(),
    riskStateAddress: riskStateAddress.toBase58(),
  };

  try {
    const reader = readerFactory(config.rpcUrl);
    const [genesisHash, vaultAccount, riskAccount, slot] = await Promise.race([
      Promise.all([
        reader.getGenesisHash(),
        reader.getAccountInfo(vaultAddress),
        reader.getAccountInfo(riskStateAddress),
        reader.getSlot(),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Solana RPC request timed out.")),
          REQUEST_TIMEOUT_MS,
        ),
      ),
    ]);

    const expectedGenesisHash =
      CLUSTER_GENESIS_HASHES[config.cluster.toLowerCase()];
    if (
      expectedGenesisHash &&
      genesisHash !== expectedGenesisHash &&
      !genesisHash.startsWith(expectedGenesisHash.slice(0, 30))
    ) {
      return result({
        ...base,
        status: "network_mismatch",
        riskState: null,
        vault: null,
        slot,
        error: `RPC endpoint is not connected to the configured ${config.cluster} cluster.`,
      });
    }

    if (!vaultAccount || !riskAccount) {
      return result({
        ...base,
        status: "not_found",
        riskState: null,
        vault: null,
        slot,
        error:
          !vaultAccount && !riskAccount
            ? "Vault and RiskState accounts were not found at the derived addresses."
            : !vaultAccount
              ? "Vault account was not found at the derived address."
              : "RiskState account was not found at the derived address.",
      });
    }
    if (
      !vaultAccount.owner.equals(RISK_VAULT_PROGRAM_ID) ||
      !riskAccount.owner.equals(RISK_VAULT_PROGRAM_ID)
    ) {
      return result({
        ...base,
        status: "invalid",
        riskState: null,
        vault: null,
        slot,
        error: "Account owner does not match the configured risk program.",
      });
    }

    const vault = decodeVaultIdentity(vaultAccount.data);
    const state = decodeRiskState(riskAccount.data);
    const [verifiedVault, vaultBump] = deriveVaultAddress(
      new PublicKey(vault.collateralMint),
    );
    const [verifiedRiskState, riskBump] = deriveRiskStateAddress(verifiedVault);
    if (
      !verifiedVault.equals(vaultAddress) ||
      !verifiedRiskState.equals(riskStateAddress) ||
      state.bump !== riskBump ||
      vault.bump !== vaultBump
    ) {
      return result({
        ...base,
        status: "invalid",
        riskState: null,
        vault: null,
        slot,
        error:
          "Account PDA or bump does not match the expected program derivation.",
      });
    }
    if (vault.collateralMint.toBase58() !== collateralMint.toBase58()) {
      return result({
        ...base,
        status: "invalid",
        riskState: null,
        vault: null,
        slot,
        error: "Vault collateral mint does not match the configured mint.",
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const age = nowSeconds - state.updatedAt;
    const futureDated = age < -30;
    const isStale = state.updatedAt === 0 || age > MAX_RISK_STATE_AGE_SECONDS;
    const invalidTime = futureDated || state.observedAt > state.updatedAt + 30;
    if (invalidTime) {
      return result({
        ...base,
        status: "invalid",
        riskState: null,
        vault: null,
        slot,
        error: "RiskState timestamps are inconsistent or in the future.",
      });
    }

    return result({
      ...base,
      status: isStale ? "stale" : "available",
      riskState: state,
      vault: {
        collateralMint: vault.collateralMint.toBase58(),
        riskAuthority: vault.riskAuthority.toBase58(),
      },
      slot,
      error: isStale
        ? "On-chain RiskState has not been updated recently."
        : null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Solana RPC read failed.";
    const invalidData =
      /invalid|discriminator|layout|enum|policy|timestamp|bump/i.test(message);
    return result({
      ...base,
      status: invalidData ? "invalid" : "unavailable",
      riskState: null,
      vault: null,
      slot: null,
      error: message,
    });
  }
}
