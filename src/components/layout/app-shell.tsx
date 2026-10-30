"use client";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronRight, Menu, Palette, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSettings, useSettingsStore } from "@/state/settings";
import { THEMES } from "@/lib/ui/themes";
import { HoldingAlertsBell, HoldingAlertsWatcher, useHoldingSignals } from "./holding-alerts";
import { LockinLayer, LockinToggle } from "@/components/lockin/lockin";
import { DataStatus, FixtureBanner, StaleBanner } from "./data-status";
import { MOBILE_TABS, NAV, NAV_GROUPS, NAV_TONES, type NavGroupKey } from "./nav";
import { SearchCommand } from "./search-command";
import { FolderStatusChip } from "./folder-sync";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-1">
      <span className="coin flex size-9 items-center justify-center rounded-full text-xs font-black">GE</span>
      <span className="leading-tight">
        <span className="block text-base font-extrabold tracking-tight">GE Flipper</span>
        <span className="block text-[11px] font-medium text-muted">Old School RuneScape</span>
      </span>
    </Link>
  );
}

const NAV_OPEN_KEY = "osrs-ge-flipper:nav-groups";

const navListeners = new Set<() => void>();
function subscribeNav(cb: () => void) {
  navListeners.add(cb);
  return () => navListeners.delete(cb);
}
function readNavRaw(): string {
  try {
    return localStorage.getItem(NAV_OPEN_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}
let navMemory = "{}";
function writeNav(next: Partial<Record<NavGroupKey, boolean>>) {
  navMemory = JSON.stringify(next);
  try {
    localStorage.setItem(NAV_OPEN_KEY, navMemory);
  } catch {
    /* storage blocked: state lasts for this visit */
  }
  navListeners.forEach((l) => l());
}
function parseNav(raw: string): Partial<Record<NavGroupKey, boolean>> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Partial<Record<NavGroupKey, boolean>>) : {};
  } catch {
    return {};
  }
}

function NavLink({ href, onNavigate, pathname }: { href: string; onNavigate?: () => void; pathname: string }) {
  const item = NAV.find((n) => n.href === href);
  if (!item) return null;
  const Icon = item.icon;
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text",
        active && "bg-surface-2 font-bold text-text shadow-card",
      )}
      aria-current={active ? "page" : undefined}
    >
      <span className={cn("flex size-7 items-center justify-center rounded-lg", NAV_TONES[item.tone])}>
        <Icon className="size-4" />
      </span>
      {item.label}
    </Link>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  // Remembered open/closed state is per browser; the server render uses the defaults
  const raw = useSyncExternalStore(subscribeNav, () => (navMemory !== "{}" ? navMemory : readNavRaw()), () => "{}");
  const open = useMemo(() => parseNav(raw), [raw]);
  const alertCount = useHoldingSignals().length;
  const grouped = new Set<string>(NAV_GROUPS.flatMap((g) => [...g.hrefs]));
  const toggle = (key: NavGroupKey, value: boolean) => writeNav({ ...open, [key]: value });

  return (
    <nav className="flex flex-col gap-1" aria-label="Main navigation">
      {NAV.filter((n) => !grouped.has(n.href)).map((n) => (
        <NavLink key={n.href} href={n.href} pathname={pathname} onNavigate={onNavigate} />
      ))}
      {NAV_GROUPS.map((g) => {
        const hasActive = g.hrefs.some((h) => isActive(pathname, h));
        const isOpen = hasActive || (open[g.key] ?? false);
        return (
          <div key={g.key} className="mt-2" data-testid={`nav-group-${g.key}`}>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => !hasActive && toggle(g.key, !isOpen)}
                aria-expanded={isOpen}
                disabled={hasActive}
                className={cn("flex flex-1 items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-faint", !hasActive && "hover:text-text")}
                title={hasActive ? "Contains the page you’re on" : isOpen ? "Collapse" : "Expand"}
                data-testid={`nav-toggle-${g.key}`}
              >
                <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90", hasActive && "opacity-0")} />
                {g.label}
                {g.key === "mine" && alertCount > 0 && (
                  <span className="ml-1 rounded-full bg-neg px-1.5 text-[10px] leading-4 text-white" title={`${alertCount} price alerts`}>{alertCount}</span>
                )}
              </button>
              {!isOpen && (
                <div className="flex gap-0.5">
                  {g.hrefs.map((h) => {
                    const item = NAV.find((n) => n.href === h)!;
                    const Icon = item.icon;
                    return (
                      <Link key={h} href={h} onClick={onNavigate} aria-label={item.label} title={item.label} className={cn("flex size-7 items-center justify-center rounded-lg opacity-80 hover:opacity-100", NAV_TONES[item.tone])}>
                        <Icon className="size-4" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
            {isOpen && (
              <div className="mt-0.5 flex flex-col gap-1">
                {g.hrefs.map((h) => (
                  <NavLink key={h} href={h} pathname={pathname} onNavigate={onNavigate} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function ThemeToggle() {
  const theme = useSettings().theme;
  const update = useSettingsStore((s) => s.update);
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-full border border-border bg-surface text-accent shadow-card hover:bg-surface-2"
          aria-label="Theme"
          title="Theme"
          data-testid="theme-toggle"
        >
          <Palette className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-60 rounded-lg border border-border bg-surface p-1 shadow-lg animate-fade-in" data-testid="theme-menu">
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                update({ theme: t.key });
                setOpen(false);
              }}
              className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2", theme === t.key && "font-semibold")}
              data-testid={`theme-option-${t.key}`}
            >
              <span className="flex overflow-hidden rounded-full border border-border">
                {t.swatch.map((c) => <span key={c} className="block size-3" style={{ background: c }} />)}
              </span>
              <span className="flex-1">{t.label}</span>
              {theme === t.key && <Check className="size-4 text-accent" />}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="min-h-screen">
      <FixtureBanner />
      <HoldingAlertsWatcher />
      <LockinLayer />
      {/* Desktop-Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
        <Logo />
        <div className="mt-6 flex-1 overflow-y-auto">
          <NavList pathname={pathname} />
        </div>
        <div className="space-y-1 border-t border-border pt-3 text-[11px] text-faint">
          <p>
            Data:{" "}
            <a className="underline hover:text-muted" href="https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices" target="_blank" rel="noreferrer">
              OSRS Wiki
            </a>{" "}
            (CC BY-NC-SA 3.0)
          </p>
          <p>
            Charts:{" "}
            <a className="underline hover:text-muted" href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">
              TradingView Lightweight Charts
            </a>
          </p>
          <p>
            <Link className="underline hover:text-muted" href="/methodology">Methodology</Link> ·{" "}
            <Link className="underline hover:text-muted" href="/privacy">Privacy</Link>
          </p>
          <p>Not an official Jagex product.</p>
        </div>
      </aside>

      {/* Mobile-Drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface p-3 shadow-2xl animate-fade-in">
            <div className="mb-4 flex items-center justify-between">
              <Logo />
              <button type="button" onClick={() => setDrawer(false)} className="rounded p-1 text-muted" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <NavList pathname={pathname} onNavigate={() => setDrawer(false)} />
            <p className="mt-4 text-[11px] text-faint">
              <Link href="/methodology" onClick={() => setDrawer(false)} className="underline">Methodology</Link> ·{" "}
              <Link href="/privacy" onClick={() => setDrawer(false)} className="underline">Privacy</Link>
            </p>
            <div className="mt-2 text-[11px] text-faint">
                </div>
          </div>
        </div>
      )}

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-[var(--header-bg)] px-3 backdrop-blur md:px-5">
          <button type="button" className="rounded p-1 text-muted md:hidden" onClick={() => setDrawer(true)} aria-label="Open menu" data-testid="menu-button">
            <Menu className="size-5" />
          </button>
          <div className="flex-1">
            <SearchCommand />
          </div>
          <FolderStatusChip />
          <DataStatus />
          <LockinToggle />
          <HoldingAlertsBell />
          <ThemeToggle />
        </header>
        <StaleBanner />
        <main className="mx-auto max-w-[1600px] px-3 py-5 pb-24 md:px-6 md:pb-10">{children}</main>
      </div>

      {/* Mobile-Tabbar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface shadow-card md:hidden" aria-label="Quick navigation">
        {MOBILE_TABS.map((href) => {
          const item = NAV.find((n) => n.href === href)!;
          const Icon = item.icon;
          return (
            <Link key={href} href={href} className={cn("flex flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium text-muted", isActive(pathname, href) && "font-bold text-accent")}>
              <span className={cn("flex h-7 w-10 items-center justify-center rounded-full", isActive(pathname, href) && NAV_TONES[item.tone])}>
                <Icon className="size-5" />
              </span>
              {item.label.replace("Flip Scanner", "Scanner").replace("Profit Calculator", "Calculator").replace("Flip History", "History").replace(" Buys", "")}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
