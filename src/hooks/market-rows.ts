"use client";
import { useMemo } from "react";
import { buildSpeedRows, DEFAULT_REALISM, ownHoldTimes, type SpeedRow } from "@/lib/analysis/speed";
import { applySpeedFilters, type SpeedFilters } from "@/lib/analysis/speed-filters";
import { computeFifo } from "@/lib/portfolio/fifo";
import { useDataStore } from "@/state/data";
import { useSettings } from "@/state/settings";
import { useCandidates, useHistory, useRowMap } from "./market";

export type QtyBasis = "limit" | "capital";

/**
 * All scanner rows with speed, returns, "within reason" sizing and history signals, plus the
 * filtered and sorted list. Shared by the Flip Scanner and Top 10.
 */
export function useMarketRows(f: SpeedFilters, basis: QtyBasis, capitalOverride: number | null, limit = 5000) {
  const settings = useSettings();
  const capital = capitalOverride ?? settings.defaultCapital;
  const { candidates, isLoading, error } = useCandidates(capital);
  const rows = useRowMap();
  const history = useHistory();
  const trades = useDataStore((s) => s.trades);
  const own = useMemo(() => ownHoldTimes(trades), [trades]);
  const held = useMemo(() => new Set(trades.filter((t) => computeFifo(t).openQty > 0).map((t) => t.itemId)), [trades]);
  const dismissed = useMemo(() => new Set(settings.dismissedItems), [settings.dismissedItems]);
  const realism = useMemo(() => (f.realistic ? { ...DEFAULT_REALISM, maxShare: f.maxShare, minPerSide: f.minPerSide } : null), [f.realistic, f.maxShare, f.minPerSide]);
  const all: SpeedRow[] = useMemo(
    () => buildSpeedRows(candidates, rows, own, { basis, realism, capital, timeAwayHours: f.timeAwayHours, history: history.data?.items ?? null }),
    [candidates, rows, own, basis, realism, capital, f.timeAwayHours, history.data],
  );
  const shown = useMemo(() => applySpeedFilters(all, f, held, limit, dismissed), [all, f, held, limit, dismissed]);
  const outliers = useMemo(() => (f.realistic ? all.filter((r) => r.outlier).length : 0), [all, f.realistic]);
  return { all, shown, held, dismissed, outliers, capital, isLoading, error, historyLoaded: !!history.data };
}
