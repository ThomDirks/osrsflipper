import type { Trade } from "./schemas";

/**
 * GE-Kauflimit-Tracker aus den eigenen Käufen.
 *
 * Regel (OSRS Wiki, „Grand Exchange#Buying limits“): Das Limit gilt pro Item für 4 Stunden ab dem
 * ERSTEN Kauf. Alles, was innerhalb dieser 4 h gekauft wird, zählt; danach steht das volle Limit
 * wieder zur Verfügung und der nächste Kauf startet ein neues Fenster.
 *
 * Gezählt werden gefüllte Kaufchargen (Lots) sowie offene Kaufangebote (Offers), weil diese das
 * Limit beim Füllen ebenfalls verbrauchen. Basis sind die erfassten Zeitpunkte – Käufe, die nicht
 * im Tracker stehen, kennt die App nicht.
 */

export const BUY_LIMIT_WINDOW_MS = 4 * 3_600_000;

export interface LimitUsage {
  itemId: number;
  itemName: string;
  /** Im aktuellen Fenster gekaufte Stück */
  bought: number;
  /** Offene Kaufangebote (noch nicht gefüllt) */
  pending: number;
  /** Beginn des aktuellen Fensters (erster Kauf); null = kein aktives Fenster */
  windowStart: number | null;
  /** Zeitpunkt, an dem das volle Limit wieder verfügbar ist; null = kein aktives Fenster */
  resetsAt: number | null;
}

/** Aktive Limit-Nutzung pro Item (nur Items mit aktivem Fenster oder offenen Angeboten). */
export function buyLimitUsage(trades: Trade[], now: number): Map<number, LimitUsage> {
  const lotsByItem = new Map<number, { date: number; quantity: number }[]>();
  const names = new Map<number, string>();
  const out = new Map<number, LimitUsage>();
  const entry = (itemId: number) => {
    let u = out.get(itemId);
    if (!u) {
      u = { itemId, itemName: names.get(itemId) ?? `#${itemId}`, bought: 0, pending: 0, windowStart: null, resetsAt: null };
      out.set(itemId, u);
    }
    return u;
  };

  for (const t of trades) {
    if (!names.has(t.itemId)) names.set(t.itemId, t.itemName);
    for (const l of t.lots) {
      // Zukünftige Daten (Tippfehler) zählen erst, wenn sie erreicht sind
      if (l.date > now) continue;
      // Umgefüllte Käufe verbrauchen das Limit des tatsächlich gekauften Items
      const id = l.decantFrom?.itemId ?? t.itemId;
      if (l.decantFrom && !names.has(id)) names.set(id, l.decantFrom.itemName);
      const list = lotsByItem.get(id) ?? [];
      list.push({ date: l.date, quantity: l.decantFrom?.quantity ?? l.quantity });
      lotsByItem.set(id, list);
    }
    const pending = t.offers.reduce((s, o) => s + o.quantity, 0);
    if (pending > 0) entry(t.itemId).pending += pending;
  }

  for (const [itemId, lots] of lotsByItem) {
    lots.sort((a, b) => a.date - b.date);
    let start: number | null = null;
    let bought = 0;
    for (const l of lots) {
      if (start == null || l.date >= start + BUY_LIMIT_WINDOW_MS) {
        start = l.date;
        bought = 0;
      }
      bought += l.quantity;
    }
    if (start != null && now < start + BUY_LIMIT_WINDOW_MS) {
      const u = entry(itemId);
      u.bought = bought;
      u.windowStart = start;
      u.resetsAt = start + BUY_LIMIT_WINDOW_MS;
    }
  }

  for (const [id, u] of out) if (u.bought === 0 && u.pending === 0) out.delete(id);
  return out;
}

/** Verbrauchte Stück (gekauft + offen) – für die Mengenbegrenzung im Scanner. */
export function limitUsed(u: LimitUsage | undefined): number {
  return u ? u.bought + u.pending : 0;
}

/** Noch verfügbares Limit; null = Limit des Items unbekannt. */
export function limitLeft(limit: number | null, u: LimitUsage | undefined): number | null {
  return limit == null ? null : Math.max(0, limit - limitUsed(u));
}
