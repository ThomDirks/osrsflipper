"use client";
import { useState } from "react";
import { prepareTrade, type Draft } from "@/components/trades/trade-editor";
import type { SpeedRow } from "@/lib/analysis/speed";
import type { Trade } from "@/lib/portfolio/schemas";
import { useDataStore } from "@/state/data";
import { useSettings, useSettingsStore } from "@/state/settings";
import { toast } from "@/state/toasts";

/** Watch, dismiss and log-trade actions shared by the scanner table, side panel and Top 10. */
export function useRowActions() {
  const settings = useSettings();
  const update = useSettingsStore((s) => s.update);
  const { trades, watchlist, upsertWatch, removeWatch } = useDataStore();
  const [editing, setEditing] = useState<{ draft: Trade | Draft; mode: "buy" | "sell" } | null>(null);
  const watched = new Set(watchlist.map((w) => w.itemId));

  const watch = async (r: SpeedRow) => {
    if (watched.has(r.id)) {
      await removeWatch(r.id);
      toast(`${r.name} removed from the watchlist.`);
    } else {
      await upsertWatch({ itemId: r.id, addedAt: Date.now(), favorite: false, note: "", targetBuy: null, targetSell: null, targetMargin: null, targetRoi: null });
      toast(`${r.name} added to the watchlist.`, "pos");
    }
  };

  const dismiss = (r: SpeedRow) => {
    const list = settings.dismissedItems;
    if (list.includes(r.id)) {
      update({ dismissedItems: list.filter((x) => x !== r.id) });
      toast(`${r.name} shows up again.`);
    } else {
      update({ dismissedItems: [...list, r.id] });
      toast(`${r.name} hidden. “Show dismissed” in the filters brings it back.`);
    }
  };

  const log = (r: SpeedRow) => setEditing(prepareTrade(trades, { id: r.id, name: r.name }, { buy: r.c.estBuy, sell: r.c.estSell, qty: r.qty }));

  return { watched, watch, dismiss, log, editing, setEditing };
}
