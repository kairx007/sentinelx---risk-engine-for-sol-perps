import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDashboardSnapshot } from "../src/hooks/useDashboardSnapshot";

const payload = {
  source: "LIVE",
  symbol: "SOL-PERP",
  collectedAt: new Date().toISOString(),
  venues: (["velocity", "phoenix"] as const).map((venue) => ({
    venue,
    status: "unavailable",
    state: null,
    risk: null,
    error: "Feed offline.",
  })),
  ecosystem: null,
  contagion: null,
  policy: { status: "unavailable", decision: null, reason: "No feeds." },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDashboardSnapshot", () => {
  it("polls again only after the previous request has completed", async () => {
    vi.useFakeTimers();
    let finishFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      finishFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderHook(() =>
      useDashboardSnapshot("SOL-PERP"),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishFirst(new Response(JSON.stringify(payload), { status: 200 }));
      await first;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.data?.source).toBe("LIVE");
    unmount();
  });

  it("aborts an in-flight request on unmount", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => {
        capturedSignal = options.signal as AbortSignal;
        return new Promise<Response>(() => {});
      }),
    );
    const { unmount } = renderHook(() => useDashboardSnapshot("SOL-PERP"));
    await waitFor(() => expect(capturedSignal).toBeDefined());
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
