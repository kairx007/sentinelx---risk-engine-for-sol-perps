import {
  calculateBidAskPrice,
  calculateReservePrice,
  VelocityClient,
  Wallet,
} from "@velocity-exchange/sdk";
import { Buffer } from "node:buffer";
import { Connection, Keypair } from "@solana/web3.js";
import type {
  OraclePriceData,
  PerpMarketConfig,
  VelocityEnv,
} from "@velocity-exchange/sdk";
import type { Commitment } from "@solana/web3.js";
import type { VelocityMarketReader } from "./types.js";

function safeBlockTimestamp(connection: Connection, slot: number) {
  if (!Number.isSafeInteger(slot) || slot <= 0) return Promise.resolve(null);
  return connection
    .getBlockTime(slot)
    .then((seconds) => {
      if (seconds === null || !Number.isSafeInteger(seconds) || seconds <= 0) {
        return null;
      }
      const timestamp = new Date(seconds * 1000);
      return Number.isNaN(timestamp.getTime()) ? null : timestamp;
    })
    .catch(() => null);
}

export function createVelocityMarketReader(
  market: PerpMarketConfig,
  env: VelocityEnv,
  rpcUrl: string,
  commitment: Commitment,
): VelocityMarketReader {
  const connection = new Connection(rpcUrl, commitment);
  // Read-only SDK use only; no transaction signing methods are called.
  const wallet = new Wallet(Keypair.generate());
  const client = new VelocityClient({
    connection,
    wallet,
    env,
    accountSubscription: { type: "websocket", commitment },
    perpMarketIndexes: [market.marketIndex],
    spotMarketIndexes: [],
    oracleInfos: [{ publicKey: market.oracle, source: market.oracleSource }],
    skipLoadUsers: true,
  });

  return {
    async subscribe() {
      const subscribed = await client.subscribe();
      if (subscribed === false) {
        throw new Error("Velocity SDK market subscription failed");
      }
    },
    async unsubscribe() {
      await client.unsubscribe();
    },
    async readSnapshot(selectedMarket) {
      const account = client.getPerpMarketAccount(selectedMarket.marketIndex);
      if (!account) {
        throw new Error(
          `Velocity market account unavailable for ${selectedMarket.symbol}`,
        );
      }
      const onChainName = Buffer.from(account.name)
        .toString("utf8")
        .replace(/\0/g, "")
        .trim()
        .toUpperCase();
      if (
        account.marketIndex !== selectedMarket.marketIndex ||
        (onChainName && onChainName !== selectedMarket.symbol.toUpperCase()) ||
        account.oracle.toBase58() !== selectedMarket.oracle.toBase58() ||
        JSON.stringify(account.oracleSource) !==
          JSON.stringify(selectedMarket.oracleSource)
      ) {
        throw new Error(
          `Velocity market registry mismatch at index ${selectedMarket.marketIndex}: configured market or oracle does not match the subscribed on-chain account`,
        );
      }
      const oracle: OraclePriceData | null =
        client.getOracleDataForPerpMarket(selectedMarket.marketIndex) ?? null;
      const mmOracle =
        client.getMMOracleDataForPerpMarket(selectedMarket.marketIndex) ?? null;
      let markPrice = null;
      let bidPrice = null;
      let askPrice = null;
      if (mmOracle) {
        try {
          markPrice = calculateReservePrice(account, mmOracle);
        } catch {
          // Keep unavailable SDK calculations explicitly null.
        }
        try {
          [bidPrice, askPrice] = calculateBidAskPrice(
            account.amm,
            account.marketStats,
            mmOracle,
          );
        } catch {
          // Keep unavailable SDK calculations explicitly null.
        }
      }
      const sourceUpdatedAt = oracle
        ? await safeBlockTimestamp(connection, Number(oracle.slot.toString()))
        : null;
      return {
        market: selectedMarket,
        marketAccount: account,
        oracle,
        markPrice,
        bidPrice,
        askPrice,
        sourceUpdatedAt,
      };
    },
  };
}
