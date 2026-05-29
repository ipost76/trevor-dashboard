"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  Skeleton,
  CollapsibleSection,
  ToggleSwitch,
  type ToggleSensitivity,
} from "@/components/ui";
import { Lock, ShieldOff, AlertTriangle } from "lucide-react";
import { AutoTraderToggleCard } from "./autotrader-toggle-card";
import { ExitControlsCard } from "./exit-controls-card";
import { PartialsToggleCard } from "./partials-toggle-card";
import { RecentTogglesSection } from "./recent-toggles-section";

// D2 — Control Center sub-tab.
//
// Reads /api/auto/control-full (B1c), filters out the 4 dedicated-endpoint
// keys, groups the remaining 85 toggles by A1 §3 category, and renders each
// via <ToggleSwitch> with the A1 §9 sensitivity tier baked in.
//
// Pause/Resume + per-flag history at the top is the existing
// <AutoTraderToggleCard /> (Rule 32 carve-out, 2-tap BottomSheet).
// Recent generic toggle changes at the bottom read from the B1b
// change_log via /api/auto/activity.

interface ControlRow {
  key: string;
  value: "true" | "false";
  updated_at: string | null;
  category: string;
  sensitivity_tier: ToggleSensitivity;
  immutable: boolean;
  immutable_reason: string | null;
}

interface ControlFullResponse {
  controls: ControlRow[];
  total: number;
  by_category: Record<string, number>;
  by_tier: Record<string, number>;
  live_edit_enabled: boolean;
  error?: string;
}

// Keys whose flip is owned by a dedicated endpoint with its own audit +
// cache-bust surface. The control-full PATCH refuses them with 400 anyway;
// rendering them in the grouped toggle grid would just duplicate UI that
// already lives on this same tab (AutoTraderToggleCard + PartialsToggleCard
// + ExitControlsCard immediately below) or in the global topbar
// (KillswitchPill).
const DEDICATED_ENDPOINT_KEYS = new Set<string>([
  "AUTO_TRADER_ENABLED",
  "EMERGENCY_KILLSWITCH",
  "LIVE_PARTIALS_ENABLED",
  "CONFIRM_CYCLES_PROMOTED",
]);

// Render order matches A1 §3 category list.
const CATEGORY_ORDER: ReadonlyArray<string> = [
  "Execution",
  "Signal Gates",
  "Critic Stack",
  "Calibration",
  "Risk",
  "Experimental",
  "Misc",
];

// Open by default — highest-impact categories Ghost scans first.
const DEFAULT_OPEN = new Set<string>(["Execution", "Signal Gates"]);

interface ToastState {
  tone: "ok" | "warn" | "err";
  message: string;
}

type PatchResponse = {
  ok: boolean;
  no_change?: boolean;
  gate_locked?: boolean;
  key?: string;
  value?: string;
  prev_value?: string | null;
  updated_at?: string | null;
  error?: string;
};

export function ControlTab() {
  const [data, setData] = React.useState<ControlFullResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [toast, setToast] = React.useState<ToastState | null>(null);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchControls = React.useCallback(async () => {
    try {
      const res = await fetch("/api/auto/control-full", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as ControlFullResponse;
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchControls();
  }, [fetchControls]);

  React.useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = React.useCallback((state: ToastState, ttlMs = 4_000) => {
    setToast(state);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ttlMs);
  }, []);

  const handleToggle = React.useCallback(
    async (row: ControlRow, newValue: boolean, reason?: string) => {
      const body: Record<string, string> = {
        value: newValue ? "true" : "false",
        author: "ghost",
      };
      if (reason && reason.trim()) body.reason = reason.trim();

      const res = await fetch(
        `/api/auto/control-full/${encodeURIComponent(row.key)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      let payload: PatchResponse = {} as PatchResponse;
      try {
        payload = (await res.json()) as PatchResponse;
      } catch {
        // non-JSON; fall through to error path
      }

      if (res.status === 423 || payload.gate_locked) {
        showToast({
          tone: "warn",
          message:
            "Editing locked — set LIVE_EDIT_ENABLED=true in auto_config to enable toggle writes.",
        });
        throw new Error("gate_locked");
      }
      if (!res.ok || !payload.ok) {
        showToast({
          tone: "err",
          message: payload.error || `Toggle failed (HTTP ${res.status}).`,
        });
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      showToast({
        tone: "ok",
        message: payload.no_change
          ? `${row.key} already ${newValue ? "ON" : "OFF"} — no change.`
          : `${row.key} → ${newValue ? "ON" : "OFF"}.`,
      });
      await fetchControls();
    },
    [fetchControls, showToast],
  );

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 md:p-6 lg:px-8">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const rows: ControlRow[] = data?.controls ?? [];
  const visibleRows = rows
    .filter((r) => !DEDICATED_ENDPOINT_KEYS.has(r.key))
    .sort((a, b) => a.key.localeCompare(b.key));

  // Group by category, preserving CATEGORY_ORDER.
  const grouped = new Map<string, ControlRow[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const row of visibleRows) {
    const cat = CATEGORY_ORDER.includes(row.category) ? row.category : "Misc";
    grouped.get(cat)!.push(row);
  }

  const liveEdit = !!data?.live_edit_enabled;

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      {/* Top: existing AutoTrader pause/resume card (Rule 32 carve-out) */}
      <AutoTraderToggleCard />

      {/* Dedicated-endpoint toggles — each owns its own write surface */}
      <ExitControlsCard />
      <PartialsToggleCard />

      {/* LIVE_EDIT_ENABLED state banner */}
      <Card padding="sm" className="card-elevated">
        <div className="flex items-start gap-3">
          {liveEdit ? (
            <AlertTriangle
              size={18}
              className="mt-0.5 shrink-0 text-accent-mint"
              aria-hidden
            />
          ) : (
            <Lock
              size={18}
              className="mt-0.5 shrink-0 text-accent-gold-strong"
              aria-hidden
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-sans text-label-ui text-fg-primary">
                Toggle editing
              </span>
              {liveEdit ? (
                <Pill intent="active" size="sm">
                  UNLOCKED
                </Pill>
              ) : (
                <Pill intent="warn" size="sm">
                  LOCKED
                </Pill>
              )}
            </div>
            <p className="mt-1 font-sans text-micro text-fg-muted">
              {liveEdit ? (
                <>
                  Writes are live — every flip lands in{" "}
                  <code className="font-mono text-accent-cyan-soft">
                    change_log
                  </code>{" "}
                  with actor + reason. Tier 1 toggles require a reason.
                </>
              ) : (
                <>
                  <code className="font-mono text-accent-cyan-soft">
                    LIVE_EDIT_ENABLED
                  </code>{" "}
                  is{" "}
                  <code className="font-mono text-accent-gold-strong">
                    false
                  </code>{" "}
                  — toggle PATCH returns 423. Run{" "}
                  <code className="font-mono text-accent-cyan-soft">
                    UPDATE auto_config SET value=&apos;true&apos; WHERE
                    key=&apos;LIVE_EDIT_ENABLED&apos;
                  </code>{" "}
                  to enable. No service restart needed.
                </>
              )}
            </p>
          </div>
        </div>
      </Card>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={
            "rounded-md border p-3 font-sans text-caption " +
            (toast.tone === "ok"
              ? "border-accent-mint/40 bg-accent-mint/10 text-accent-mint-strong"
              : toast.tone === "warn"
                ? "border-accent-gold/40 bg-accent-gold/10 text-accent-gold-strong"
                : "border-accent-red/40 bg-accent-red/10 text-accent-red")
          }
        >
          {toast.message}
        </div>
      )}

      {/* Categories */}
      {CATEGORY_ORDER.map((cat) => {
        const items = grouped.get(cat) ?? [];
        if (items.length === 0) return null;
        const tier1 = items.filter((r) => r.sensitivity_tier === 1).length;
        return (
          <CollapsibleSection
            key={cat}
            title={cat}
            defaultOpen={DEFAULT_OPEN.has(cat)}
            rightSlot={
              <span className="flex items-center gap-2">
                {tier1 > 0 && (
                  <Pill intent="error" size="sm">
                    {tier1} T1
                  </Pill>
                )}
                <Pill intent="blue-chip" size="sm">
                  {items.length}
                </Pill>
              </span>
            }
          >
            <div className="px-4 pb-2">
              {items.map((row) => (
                <ToggleSwitch
                  key={row.key}
                  label={row.key}
                  value={row.value === "true"}
                  sensitivity={row.sensitivity_tier}
                  disabled={!liveEdit || row.immutable}
                  onToggle={(newValue, reason) =>
                    handleToggle(row, newValue, reason)
                  }
                />
              ))}
            </div>
          </CollapsibleSection>
        );
      })}

      {/* Footer advisory: 4 dedicated keys filtered out */}
      <Card padding="sm" className="card-elevated">
        <div className="flex items-start gap-3">
          <ShieldOff
            size={16}
            className="mt-0.5 shrink-0 text-fg-muted"
            aria-hidden
          />
          <div className="font-sans text-micro text-fg-muted">
            <span className="text-fg-primary">4 toggles hidden:</span>{" "}
            <code className="font-mono">AUTO_TRADER_ENABLED</code>,{" "}
            <code className="font-mono">EMERGENCY_KILLSWITCH</code>,{" "}
            <code className="font-mono">LIVE_PARTIALS_ENABLED</code>,{" "}
            <code className="font-mono">CONFIRM_CYCLES_PROMOTED</code> — each
            has its own dedicated write surface (AutoTrader / Exit Controls /
            Partials cards above, Killswitch pill on the topbar).
          </div>
        </div>
      </Card>

      {/* Bottom: recent toggle changes from B1b change_log */}
      <RecentTogglesSection />
    </div>
  );
}
