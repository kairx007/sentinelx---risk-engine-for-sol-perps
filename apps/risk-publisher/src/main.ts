import { readFile } from "node:fs/promises";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  calculateCurrentPolicy,
  createDefaultMarketReaders,
  publishRiskPolicy,
} from "./index.js";
import { createSolanaRiskStateChain } from "./solana-chain.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function structuredLog(event: string, fields: Record<string, unknown>): void {
  console.log(
    JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }),
  );
}

async function loadSigner(path: string): Promise<Keypair> {
  const bytes = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (
    !Array.isArray(bytes) ||
    bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new Error(
      "Risk authority keypair file must contain a JSON byte array",
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}

async function main(): Promise<void> {
  const marketRpcUrl = requiredEnv("MARKET_RPC_URL");
  const solanaRpcUrl = requiredEnv("SOLANA_RPC_URL");
  const vault = new PublicKey(requiredEnv("RISK_VAULT_ADDRESS"));
  const symbol = requiredEnv("MARKET_SYMBOL");
  const signer = await loadSigner(requiredEnv("RISK_AUTHORITY_KEYPAIR"));
  const readers = createDefaultMarketReaders({
    marketRpcUrl,
    ...(process.env.PHOENIX_API_URL
      ? { phoenixApiUrl: process.env.PHOENIX_API_URL }
      : {}),
  });

  const { decision } = await calculateCurrentPolicy(
    readers,
    symbol,
    structuredLog,
  );
  const connection = new Connection(solanaRpcUrl, "confirmed");
  const chain = createSolanaRiskStateChain(connection, signer);
  structuredLog("risk_state_update_attempt", {
    vault: vault.toBase58(),
    authority: signer.publicKey.toBase58(),
    riskLevel: decision.riskLevel,
    riskScore: decision.riskScore,
    contagionState: decision.contagionState,
    maxLeverageX100: decision.maxLeverageX100,
    observedAt: decision.observedAt,
  });
  try {
    const result = await publishRiskPolicy(
      chain,
      vault,
      signer.publicKey,
      decision,
    );
    structuredLog("risk_state_update_success", {
      vault: vault.toBase58(),
      status: result.status,
      nonce: result.nonce.toString(),
      ...(result.status === "published" ? { signature: result.signature } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/nonce|concurrent/i.test(message)) {
      structuredLog("risk_state_nonce_mismatch", {
        vault: vault.toBase58(),
        error: message,
      });
    }
    if (/stale|older than the on-chain observation/i.test(message)) {
      structuredLog("risk_state_stale", {
        vault: vault.toBase58(),
        error: message,
      });
    }
    structuredLog("risk_state_update_failed", {
      vault: vault.toBase58(),
      error: message,
    });
    throw error;
  }
}

main().catch((error: unknown) => {
  structuredLog("risk_publisher_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
