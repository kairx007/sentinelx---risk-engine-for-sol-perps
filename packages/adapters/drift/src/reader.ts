import {
  calculateBidAskPrice,
  calculateReservePrice,
  DriftClient,
  getMarketsAndOraclesForSubscription,
  initialize,
  Wallet,
} from "@drift-labs/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type {
  DriftEnv,
  MMOraclePriceData,
  PerpMarketAccount,
  PerpMarketConfig,
} from "@drift-labs/sdk";
import type { Commitment } from "@solana/web3.js";
import type { DriftMarketReader } from "./types.js";

function safeMarkPrice(
  market: PerpMarketAccount,
  oracle: MMOraclePriceData | null,
) {
  if (oracle === null) return null;
  try {
    return calculateReservePrice(market, oracle);
  } catch {
    return null;
  }
}

function safeBidAsk(
  market: PerpMarketAccount,
  oracle: MMOraclePriceData | null,
) {
  if (oracle === null) return [null, null] as const;
  try {
    return calculateBidAskPrice(market.amm, oracle);
  } catch {
    return [null, null] as const;
  }
}

function safeBlockTimestamp(
  connection: Connection,
  slot: number,
): Promise<Date | null> {
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

export function createDriftMarketReader(
  market: PerpMarketConfig,
  env: DriftEnv,
  rpcUrl: string,
  commitment: Commitment,
): DriftMarketReader {
  const connection = new Connection(rpcUrl, commitment);
  // This ephemeral keypair satisfies the SDK's wallet interface. The adapter
  // only subscribes to and reads accounts; it never invokes transaction methods.
  const wallet = new Wallet(Keypair.generate());
  const sdkConfig = initialize({ env });
  const subscriptions = getMarketsAndOraclesForSubscription(env, [market], []);
  const client = new DriftClient({
    connection,
    wallet,
    env,
    programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
    perpMarketIndexes: subscriptions.perpMarketIndexes,
    spotMarketIndexes: subscriptions.spotMarketIndexes,
    oracleInfos: subscriptions.oracleInfos,
    skipLoadUsers: true,
    accountSubscription: { type: "websocket", commitment },
  });

  return {
    async subscribe() {
      await client.subscribe();
    },
    async unsubscribe() {
      await client.unsubscribe();
    },
    async readSnapshot(selectedMarket) {
      const account = await client.forceGetPerpMarketAccount(
        selectedMarket.marketIndex,
      );
      if (!account) {
        throw new Error(
          `Drift market account unavailable for ${selectedMarket.symbol}`,
        );
      }

      const oracle = client.getOracleDataForPerpMarket(
        selectedMarket.marketIndex,
      );
      const mmOracle = client.getMMOracleDataForPerpMarket(
        selectedMarket.marketIndex,
      );
      const [bidPrice, askPrice] = safeBidAsk(account, mmOracle ?? null);
      const sourceUpdatedAt = oracle
        ? await safeBlockTimestamp(connection, Number(oracle.slot.toString()))
        : null;

      return {
        market: selectedMarket,
        amm: account.amm,
        oracle: oracle ?? null,
        markPrice: safeMarkPrice(account, mmOracle ?? null),
        bidPrice,
        askPrice,
        sourceUpdatedAt,
      };
    },
  };
}
