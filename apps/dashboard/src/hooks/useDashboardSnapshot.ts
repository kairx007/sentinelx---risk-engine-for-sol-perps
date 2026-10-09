import { useEffect, useState } from "react";
import { fetchDashboardSnapshot } from "../api/client";
import type { DashboardSnapshot } from "../../../../packages/api-contracts/src/dashboard";

const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 4_000;
const STALE_AFTER_MS = 15_000;

export interface DashboardSnapshotState {
  data: DashboardSnapshot | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  stale: boolean;
  lastUpdatedAt: string | null;
}

export function useDashboardSnapshot(symbol: string): DashboardSnapshotState {
  const [state, setState] = useState<DashboardSnapshotState>({
    data: null,
    status: "loading",
    error: null,
    stale: false,
    lastUpdatedAt: null,
  });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | undefined;

    const poll = async () => {
      const controller = new AbortController();
      activeController = controller;
      const timeout = setTimeout(
        () =>
          controller.abort(
            new DOMException("Request timed out", "TimeoutError"),
          ),
        REQUEST_TIMEOUT_MS,
      );
      try {
        const data = await fetchDashboardSnapshot(symbol, controller.signal);
        if (!disposed) {
          setState({
            data,
            status: "ready",
            error: null,
            stale: false,
            lastUpdatedAt: data.collectedAt,
          });
        }
      } catch (error) {
        if (
          !disposed &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setState((current) => ({
            ...current,
            status: current.data ? "ready" : "error",
            error: controller.signal.aborted
              ? "Dashboard request timed out."
              : error instanceof Error
                ? error.message
                : "Dashboard request failed.",
            stale: current.data !== null,
          }));
        }
      } finally {
        clearTimeout(timeout);
        if (activeController === controller) activeController = undefined;
        if (!disposed) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      activeController?.abort();
    };
  }, [symbol]);

  useEffect(() => {
    if (!state.data) return;
    const updateStaleness = () => {
      const age = Date.now() - Date.parse(state.data!.collectedAt);
      setState((current) => ({
        ...current,
        stale: !Number.isFinite(age) || age > STALE_AFTER_MS,
      }));
    };
    updateStaleness();
    const interval = setInterval(updateStaleness, 1_000);
    return () => clearInterval(interval);
  }, [state.data]);

  return state;
}
