"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Small per-browser preference (e.g. remembered filters) in localStorage.
 * The server render and first paint use the default, so hydration stays stable; storage that is
 * blocked or broken falls back to memory for this visit.
 */
const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, string>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useLocalState<T extends object>(key: string, fallback: T): [T, (next: T) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(cb);
      listeners.set(key, set);
      return () => set.delete(cb);
    },
    [key],
  );
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = useMemo<T>(() => {
    if (!raw) return fallback;
    try {
      // Merge with defaults so new fields get their default value
      return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      return fallback;
    }
  }, [raw, fallback]);
  const set = useCallback(
    (next: T) => {
      const s = JSON.stringify(next);
      memory.set(key, s);
      try {
        localStorage.setItem(key, s);
      } catch {
        /* blocked: memory only */
      }
      listeners.get(key)?.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
