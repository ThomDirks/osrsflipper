import type { SpeedTier } from "@/lib/analysis/speed";
import { gpShort } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Instant-buys (orange, left) versus instant-sells (blue, right) as one bar. */
export function SplitBar({ buys, sells, className, labels = true }: { buys: number; sells: number; className?: string; labels?: boolean }) {
  const total = buys + sells;
  const share = total > 0 ? buys / total : 0.5;
  return (
    <div className={cn("min-w-[120px]", className)} title={total > 0 ? `${Math.round(share * 100)}% instant-buys · ${Math.round((1 - share) * 100)}% instant-sells` : "No trades"}>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
        {total > 0 && (
          <>
            <span className="block h-full bg-accent" style={{ width: `${share * 100}%` }} />
            <span className="block h-full bg-info" style={{ width: `${(1 - share) * 100}%` }} />
          </>
        )}
      </div>
      {labels && (
        <div className="num mt-0.5 flex justify-between text-[10px] text-muted">
          <span>{gpShort(buys)} buys</span>
          <span>{gpShort(sells)} sells</span>
        </div>
      )}
    </div>
  );
}

export const TIER_TONE: Record<SpeedTier, "pos" | "warn" | "neg" | undefined> = {
  "very fast": "pos",
  fast: "pos",
  medium: "warn",
  slow: "neg",
  "very slow": "neg",
  "no data": undefined,
};

export function minutes(m: number | null): string {
  if (m == null) return "–";
  if (m < 1) return "< 1 min";
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 48 * 60) return `${(m / 60).toFixed(m < 600 ? 1 : 0)} h`;
  return `${Math.round(m / 1440)} d`;
}
