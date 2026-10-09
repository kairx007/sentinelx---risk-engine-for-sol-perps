import {
  DashboardSnapshotSchema,
  type DashboardSnapshot,
} from "../../../../packages/api-contracts/src/dashboard";

export class DashboardApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DashboardApiError";
  }
}

export async function fetchDashboardSnapshot(
  symbol: string,
  signal: AbortSignal,
): Promise<DashboardSnapshot> {
  const response = await fetch(
    `/api/dashboard/snapshot?symbol=${encodeURIComponent(symbol)}`,
    { signal },
  );
  if (!response.ok) {
    let message = `Dashboard API request failed (${response.status}).`;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "error" in body) {
        const error = body.error;
        if (
          typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ) {
          message = error.message;
        }
      }
    } catch {
      // Keep the safe HTTP status message when the error body is not JSON.
    }
    throw new DashboardApiError(message, response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DashboardApiError("Dashboard API returned invalid JSON.");
  }
  const parsed = DashboardSnapshotSchema.safeParse(body);
  if (!parsed.success)
    throw new DashboardApiError(
      "Dashboard API response did not match the expected snapshot format.",
    );
  return parsed.data;
}
