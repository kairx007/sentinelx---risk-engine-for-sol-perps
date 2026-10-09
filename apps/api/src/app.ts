import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import { ApiError } from "./errors.js";
import { DashboardSnapshotSchema } from "../../../packages/api-contracts/src/dashboard.js";
import {
  createDefaultMarketService,
  type ApiVenue,
  type MarketService,
} from "./market-service.js";

const supportedVenues = new Set<ApiVenue>(["velocity", "phoenix"]);

function requiredQuery(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      `Query parameter "${name}" is required.`,
    );
  }
  return value.trim();
}

function parseVenue(value: string): ApiVenue {
  if (!supportedVenues.has(value as ApiVenue)) {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "Venue must be velocity or phoenix.",
    );
  }
  return value as ApiVenue;
}

function pathParams(request: Request): { venue: ApiVenue; symbol: string } {
  const venueValue = request.params.venue;
  const symbolValue = request.params.symbol;
  if (typeof venueValue !== "string" || typeof symbolValue !== "string") {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "Venue and market symbol are required.",
    );
  }
  const venue = parseVenue(venueValue);
  const symbol = symbolValue.trim();
  if (!symbol) {
    throw new ApiError(400, "INVALID_REQUEST", "Market symbol is required.");
  }
  return { venue, symbol };
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    error: { code, message, timestamp: new Date().toISOString() },
  });
}

export function createApiApp(
  service: MarketService = createDefaultMarketService(),
): Express {
  const app = express();

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/markets", async (request, response) => {
    const venue = parseVenue(requiredQuery(request.query.venue, "venue"));
    const symbol = requiredQuery(request.query.symbol, "symbol");
    response.json([await service.getMarketState(venue, symbol)]);
  });

  app.get("/markets/:venue/:symbol/risk", async (request, response) => {
    const { venue, symbol } = pathParams(request);
    response.json(await service.getMarketRisk(venue, symbol));
  });

  app.get("/markets/:venue/:symbol", async (request, response) => {
    const { venue, symbol } = pathParams(request);
    response.json(await service.getMarketState(venue, symbol));
  });

  app.get("/ecosystem/risk", async (request, response) => {
    const symbol = requiredQuery(request.query.symbol, "symbol");
    response.json(await service.getEcosystemRisk(symbol));
  });

  app.get("/ecosystem/contagion", async (request, response) => {
    const symbol = requiredQuery(request.query.symbol, "symbol");
    response.json(await service.getContagionRisk(symbol));
  });

  app.get("/dashboard/snapshot", async (request, response) => {
    const symbol = requiredQuery(request.query.symbol, "symbol");
    const snapshot = await service.getDashboardSnapshot(symbol);
    response.json(DashboardSnapshotSchema.parse(snapshot));
  });

  app.use((_request, response) => {
    sendError(response, 404, "NOT_FOUND", "Route not found.");
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof ApiError) {
      sendError(response, error.status, error.code, error.message);
      return;
    }
    if (error instanceof URIError) {
      sendError(response, 400, "INVALID_REQUEST", "Request path is malformed.");
      return;
    }

    console.error("Unhandled API error", error);
    sendError(response, 500, "INTERNAL_ERROR", "Internal server error.");
  };

  app.use(errorHandler);
  return app;
}
