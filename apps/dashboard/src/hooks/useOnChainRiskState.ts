import { useEffect, useState } from "react";
import { readOnChainRiskState, type ChainSnapshot } from "../solana/client";

const REFRESH_INTERVAL_MS = 10_000;

export function useOnChainRiskState(): ChainSnapshot {
  const [snapshot, setSnapshot] = useState<ChainSnapshot>(() => ({
    status: "unconfigured",
    cluster: null,
    programId: "H1DeHTackptYWeK8EAjLGG6UXG7xFQhkMUgWsdNrm45H",
    vaultAddress: null,
    riskStateAddress: null,
    riskState: null,
    vault: null,
    slot: null,
    fetchedAt: new Date().toISOString(),
    error: "Chain configuration has not been loaded.",
  }));

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const next = await readOnChainRiskState();
      if (!disposed) setSnapshot(next);
      if (!disposed) timer = setTimeout(poll, REFRESH_INTERVAL_MS);
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return snapshot;
}
