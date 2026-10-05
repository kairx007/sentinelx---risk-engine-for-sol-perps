import { PhoenixHttpClient } from "@ellipsis-labs/rise";
import type { PhoenixMarketReader } from "./types.js";

export function createPhoenixMarketReader(
  apiUrl?: string,
): PhoenixMarketReader {
  const client = new PhoenixHttpClient(apiUrl ? { apiUrl } : {});
  return {
    getMarkets: () => client.exchange().getMarkets(),
    async readSnapshot(symbol) {
      const [market, stats, orderbook] = await Promise.all([
        client.exchange().getMarket(symbol),
        client.markets().getLatestMarketStats(symbol),
        client.orderbook().getOrderbook(symbol),
      ]);
      return { market, stats, orderbook };
    },
  };
}
