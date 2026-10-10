export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "MARKET_NOT_FOUND"
  | "VENUE_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 503,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
