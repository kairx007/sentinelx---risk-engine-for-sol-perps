import type {
  JupiterMarketReader,
  JupiterMarketStats,
  JupiterReaderFactory,
} from "./types.js";

export const DEFAULT_JUPITER_PERPS_API_URL = "https://perps-api.jup.ag/v2";

export function createJupiterMarketReader(
  options: {
    apiUrl?: string;
    fetch?: typeof fetch;
  } = {},
): JupiterMarketReader {
  const baseUrl = (options.apiUrl ?? DEFAULT_JUPITER_PERPS_API_URL).replace(
    /\/+$/,
    "",
  );
  const fetcher = options.fetch ?? fetch;
  return {
    async readMarketStats(mint) {
      const url = new URL(`${baseUrl}/market-stats`);
      url.searchParams.set("mint", mint);
      const response = await fetcher(url);
      if (!response.ok) {
        throw new Error(
          `Jupiter Perps market stats request failed (${response.status})`,
        );
      }
      const payload: unknown = await response.json();
      if (!isMarketStats(payload)) {
        throw new Error(
          "Jupiter Perps returned an invalid market stats response",
        );
      }
      return payload;
    },
  };
}

function isMarketStats(value: unknown): value is JupiterMarketStats {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return [
    "price",
    "priceChange24H",
    "priceHigh24H",
    "priceLow24H",
    "volume",
  ].every((key) => typeof record[key] === "string");
}

export const defaultJupiterReaderFactory: JupiterReaderFactory = ({
  apiUrl,
  fetch: fetcher,
}) => createJupiterMarketReader({ apiUrl, fetch: fetcher });
