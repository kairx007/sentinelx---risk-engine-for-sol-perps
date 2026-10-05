import type { MarketState } from "@perps-risk/types";
import { isPositive, observationTime, sameMarket } from "./history.js";

export type VolatilityPriceSource = "mark" | "index" | "last";

export interface VolatilityMetrics {
  priceSource: VolatilityPriceSource | null;
  windowSeconds: number;
  /** sqrt(sum of squared log returns), expressed as percent and not annualized. */
  realizedVolatilityPercent: number | null;
  /** Endpoint-to-endpoint price change over the current window, as percent. */
  priceChangePercent: number | null;
  /** Relative change in realized volatility versus the previous equal window. */
  volatilityChangePercent: number | null;
}

interface PricePoint {
  time: number;
  price: number;
}

function getPrice(state: MarketState, source: VolatilityPriceSource) {
  if (source === "mark") return state.price.markPrice;
  if (source === "index") return state.price.indexPrice;
  return state.price.lastPrice;
}

function realizedVolatility(points: readonly PricePoint[]) {
  if (points.length < 2) return null;
  let squaredReturns = 0;
  let validReturns = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current || current.time <= previous.time) continue;
    const logReturn = Math.log(current.price / previous.price);
    squaredReturns += logReturn * logReturn;
    validReturns += 1;
  }
  return validReturns > 0 ? Math.sqrt(squaredReturns) * 100 : null;
}

function priceChange(points: readonly PricePoint[]) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last || points.length < 2 || first.price <= 0) return null;
  return ((last.price - first.price) / first.price) * 100;
}

export function calculateVolatilityMetrics(
  states: readonly MarketState[],
  windowSeconds: number,
): VolatilityMetrics {
  const empty = {
    priceSource: null,
    windowSeconds,
    realizedVolatilityPercent: null,
    priceChangePercent: null,
    volatilityChangePercent: null,
  } satisfies VolatilityMetrics;
  if (
    !Number.isSafeInteger(windowSeconds) ||
    windowSeconds <= 0 ||
    states.length === 0
  ) {
    return empty;
  }

  const ordered = [...states]
    .map((state) => ({
      state,
      time: observationTime(state, state.price.observedAt),
    }))
    .filter(
      (point): point is { state: MarketState; time: number } =>
        point.time !== null,
    )
    .sort((left, right) => left.time - right.time);
  const latest = ordered.at(-1);
  if (!latest) return empty;

  const marketSeries = ordered.filter((point) =>
    sameMarket(point.state, latest.state),
  );
  const source: VolatilityPriceSource | null = isPositive(
    latest.state.price.markPrice,
  )
    ? "mark"
    : isPositive(latest.state.price.indexPrice)
      ? "index"
      : isPositive(latest.state.price.lastPrice)
        ? "last"
        : null;
  if (source === null) return empty;

  const points: PricePoint[] = marketSeries
    .map(({ state, time }) => ({ time, price: getPrice(state, source) }))
    .filter(
      (point): point is PricePoint =>
        point.price !== null && Number.isFinite(point.price) && point.price > 0,
    );
  const latestTime = latest.time;
  const durationMs = windowSeconds * 1000;
  const currentWindow = points.filter(
    (point) =>
      point.time >= latestTime - durationMs && point.time <= latestTime,
  );
  const previousWindow = points.filter(
    (point) =>
      point.time >= latestTime - 2 * durationMs &&
      point.time < latestTime - durationMs,
  );
  const volatility = realizedVolatility(currentWindow);
  const previousVolatility = realizedVolatility(previousWindow);

  return {
    priceSource: source,
    windowSeconds,
    realizedVolatilityPercent: volatility,
    priceChangePercent: priceChange(currentWindow),
    volatilityChangePercent:
      volatility !== null && previousVolatility !== null
        ? previousVolatility === 0
          ? null
          : ((volatility - previousVolatility) / previousVolatility) * 100
        : null,
  };
}
