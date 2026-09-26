"use client";
import { useCallback, useEffect, useState } from "react";
import type { CoverageSnapshot } from "./coverage-contracts";

export const refreshCoverage = () => window.dispatchEvent(new Event("nacre-coverage-refresh"));
export function useCoverage() {
  const [data, setData] = useState<CoverageSnapshot | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const load = useCallback(async (fresh = false, signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/workspace/coverage${fresh ? "?fresh=1" : ""}`, { cache: "no-store", signal });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Coverage unavailable");
      if (signal?.aborted) return;
      setData(value); setError(""); setNow(Math.floor(Date.now() / 1000));
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Coverage unavailable");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => void load(true, controller.signal);
    queueMicrotask(() => { if (!controller.signal.aborted) void load(false, controller.signal); });
    const timer = setInterval(() => void load(false, controller.signal), 10_000);
    window.addEventListener("nacre-coverage-refresh", refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("nacre-coverage-refresh", refresh); };
  }, [load]);
  return { data, error, now, refresh: () => load(true) };
}
