"use client";
import { useState, useSyncExternalStore } from "react";
import { InfoNote } from "@/components/common/indicators";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { useSettings, useSettingsStore } from "@/state/settings";
import { toast } from "@/state/toasts";
import { playChime, showDesktopNotification, useHoldingSignals } from "./holding-alerts";

function PctInput({ value, onChange, label, testId }: { value: number; onChange: (v: number) => void; label: string; testId?: string }) {
  return (
    <Input
      type="number"
      min={0.5}
      max={500}
      step={0.5}
      value={+(value * 100).toFixed(2)}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 0.5 && v <= 500) onChange(v / 100);
      }}
      aria-label={label}
      data-testid={testId}
    />
  );
}

export function HoldingAlertSettingsCard() {
  const s = useSettings();
  const update = useSettingsStore((x) => x.update);
  const cfg = s.holdingAlerts;
  const set = (patch: Partial<typeof cfg>) => update({ holdingAlerts: { ...cfg, ...patch } });
  const signals = useHoldingSignals();
  const supported = typeof window !== "undefined" && "Notification" in window;
  // Browser permission is only known on the client; the server render shows the default button
  const browserPerm = useSyncExternalStore(
    () => () => {},
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission),
    () => "default" as const,
  );
  const [asked, setPerm] = useState<NotificationPermission | null>(null);
  const perm = asked ?? browserPerm;

  const enableDesktop = async () => {
    if (!supported) return;
    const p = await Notification.requestPermission();
    setPerm(p);
    update({ notificationsEnabled: p === "granted" });
    if (p === "granted") toast("Desktop notifications are on.", "pos");
    else toast("Notifications were blocked in the browser. Allow them in the site settings (lock icon next to the address).", "warn");
  };

  const test = () => {
    const sample = { key: "test", itemId: 0, title: "Test alert: Prayer potion(4) jumped +9.2%", detail: "This is what a price alert looks like." };
    toast(`${sample.title}. ${sample.detail}`, "pos");
    if (s.notificationsEnabled) showDesktopNotification(sample);
    if (cfg.sound) playChime("pos");
  };

  return (
    <Card id="holding-alerts" className="lg:col-span-2">
      <CardHeader
        title="Price alerts on items you hold"
        description="Pings you when the price of something you still hold moves a lot, so you can decide to sell now or hold longer. Checked every minute while the app is open in a browser tab."
      />
      <CardBody className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="hold-enabled" /> Enable price alerts
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Rise above expected (%)" hint="Or above break-even without an expected price"><PctInput value={cfg.upPct} onChange={(v) => set({ upPct: v })} label="Rise percentage" testId="hold-up" /></Field>
          <Field label="Drop below expected (%)" hint="Or below what you paid without one"><PctInput value={cfg.downPct} onChange={(v) => set({ downPct: v })} label="Drop percentage" testId="hold-down" /></Field>
          <Field label="Sudden move (%)" hint="Last price vs the last hour’s average"><PctInput value={cfg.suddenPct} onChange={(v) => set({ suddenPct: v })} label="Sudden move percentage" testId="hold-sudden" /></Field>
          <Field label="Repeat the same alert after">
            <Select value={cfg.cooldownMinutes} onChange={(e) => set({ cooldownMinutes: Number(e.target.value) })} aria-label="Repeat after">
              {[15, 30, 60, 120, 240, 720, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.lossWarning} onChange={(e) => set({ lossWarning: e.target.checked })} /> Warn when selling now would lose money</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={cfg.sound} onChange={(e) => set({ sound: e.target.checked })} /> Play a sound</label>
          {perm === "granted" ? (
            <label className="flex items-center gap-2"><input type="checkbox" checked={s.notificationsEnabled} onChange={(e) => update({ notificationsEnabled: e.target.checked })} data-testid="hold-desktop" /> Desktop notifications</label>
          ) : (
            <Button size="sm" variant="outline" onClick={enableDesktop} disabled={perm === "unsupported"} data-testid="hold-desktop-enable">
              {perm === "unsupported" ? "Desktop notifications not supported" : perm === "denied" ? "Notifications blocked – allow in browser" : "Turn on desktop notifications"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={test} data-testid="hold-test">Send a test alert</Button>
        </div>
        <InfoNote>
          Set an <b>expected sale price</b> when you log a buy (it’s filled in from the scanner, Top 10 and Decanting, and you can change it any time in the trade). Without one, alerts use your break-even and what you paid. {signals.length > 0 ? `${signals.length} alert${signals.length === 1 ? "" : "s"} active right now – see the bell at the top.` : "No alerts right now."}
        </InfoNote>
      </CardBody>
    </Card>
  );
}
