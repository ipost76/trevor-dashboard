"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Pill, Skeleton } from "@/components/ui";
import { RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScoutFetch } from "./use-fetch";
import { fetchConfig, updateConfig } from "./api";
import type { ScoutConfig } from "./types";

interface FieldDef {
  envKey: EnvKey;
  label: string;
  hint?: string;
  type: "number" | "range";
  min?: number;
  max?: number;
  step?: number;
  group: "thresholds" | "universe" | "size";
}

type EnvKey =
  | "RS_THRESHOLD"
  | "EPS_YOY_THRESHOLD"
  | "REVENUE_YOY_THRESHOLD"
  | "UNIVERSE_MIN_MCAP"
  | "UNIVERSE_MIN_VOLUME"
  | "SIZE_MULT_MICRO"
  | "SIZE_MULT_SMALL"
  | "SIZE_MULT_MID"
  | "SIZE_MULT_LARGE"
  | "SIZE_MULT_MEGA";

const FIELDS: ReadonlyArray<FieldDef> = [
  { envKey: "RS_THRESHOLD", label: "RS Threshold", hint: "Minimum IBD-style RS percentile",
    type: "range", min: 50, max: 99, step: 1, group: "thresholds" },
  { envKey: "EPS_YOY_THRESHOLD", label: "EPS YoY %", hint: "Minimum YoY EPS growth",
    type: "number", step: 0.5, group: "thresholds" },
  { envKey: "REVENUE_YOY_THRESHOLD", label: "Revenue YoY %", hint: "Minimum YoY revenue growth",
    type: "number", step: 0.5, group: "thresholds" },
  { envKey: "UNIVERSE_MIN_MCAP", label: "Min Mcap ($)", hint: "Universe filter — 50,000,000 = $50M",
    type: "number", step: 1_000_000, group: "universe" },
  { envKey: "UNIVERSE_MIN_VOLUME", label: "Min 50d Avg Volume", hint: "Shares per day",
    type: "number", step: 1_000, group: "universe" },
  { envKey: "SIZE_MULT_MICRO", label: "Micro ×", hint: "<$300M",
    type: "range", min: 0.5, max: 1.5, step: 0.05, group: "size" },
  { envKey: "SIZE_MULT_SMALL", label: "Small ×", hint: "$300M – $2B",
    type: "range", min: 0.5, max: 1.5, step: 0.05, group: "size" },
  { envKey: "SIZE_MULT_MID", label: "Mid ×", hint: "$2B – $20B",
    type: "range", min: 0.5, max: 1.5, step: 0.05, group: "size" },
  { envKey: "SIZE_MULT_LARGE", label: "Large ×", hint: "$20B – $200B",
    type: "range", min: 0.5, max: 1.5, step: 0.05, group: "size" },
  { envKey: "SIZE_MULT_MEGA", label: "Mega ×", hint: "≥$200B",
    type: "range", min: 0.5, max: 1.5, step: 0.05, group: "size" },
];

function configToEnv(cfg: ScoutConfig): Record<EnvKey, number> {
  return {
    RS_THRESHOLD: cfg.rs_threshold,
    EPS_YOY_THRESHOLD: cfg.eps_yoy_threshold,
    REVENUE_YOY_THRESHOLD: cfg.revenue_yoy_threshold,
    UNIVERSE_MIN_MCAP: cfg.universe_min_mcap,
    UNIVERSE_MIN_VOLUME: cfg.universe_min_volume,
    SIZE_MULT_MICRO: cfg.size_multipliers.micro,
    SIZE_MULT_SMALL: cfg.size_multipliers.small,
    SIZE_MULT_MID: cfg.size_multipliers.mid,
    SIZE_MULT_LARGE: cfg.size_multipliers.large,
    SIZE_MULT_MEGA: cfg.size_multipliers.mega,
  };
}

export function ConfigPanel() {
  const { data, error, loading, refresh } = useScoutFetch((s) => fetchConfig(s), []);
  const [draft, setDraft] = useState<Record<EnvKey, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (data) setDraft(configToEnv(data));
  }, [data]);

  const original = useMemo(() => (data ? configToEnv(data) : null), [data]);

  const dirtyKeys = useMemo(() => {
    if (!draft || !original) return new Set<EnvKey>();
    const set = new Set<EnvKey>();
    (Object.keys(draft) as EnvKey[]).forEach((k) => {
      if (draft[k] !== original[k]) set.add(k);
    });
    return set;
  }, [draft, original]);

  const onChange = (key: EnvKey, value: number) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setSaveMsg(null);
  };

  const onReset = () => {
    if (original) setDraft(original);
    setSaveMsg(null);
  };

  const onSave = async () => {
    if (!draft || dirtyKeys.size === 0) return;
    const updates: Record<string, number> = {};
    dirtyKeys.forEach((k) => {
      updates[k] = draft[k];
    });
    setBusy(true);
    setSaveMsg(null);
    try {
      const res = await updateConfig(updates);
      setSaveMsg({
        type: "ok",
        text: `Saved ${res.updated_keys.length} key(s). Restart scout.service to apply.`,
      });
      refresh();
    } catch (e) {
      setSaveMsg({ type: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <Card padding="md">
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (error || !data || !draft) {
    return (
      <Card padding="md">
        <div className="text-caption text-accent-red">{error ?? "Could not load config."}</div>
      </Card>
    );
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-h3 text-fg-primary">CONFIG</h2>
          <span className="text-caption text-fg-muted">SCOUT thresholds & multipliers</span>
        </div>
        <div className="flex items-center gap-2">
          {dirtyKeys.size > 0 && <Pill tone="amber" size="sm">{dirtyKeys.size} changed</Pill>}
          <button
            type="button"
            onClick={onReset}
            disabled={busy || dirtyKeys.size === 0}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 py-1 text-caption uppercase tracking-wider transition-colors duration-fast",
              "text-fg-muted hover:border-border-strong hover:text-fg-primary",
              "disabled:cursor-not-allowed disabled:opacity-30",
            )}
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy || dirtyKeys.size === 0}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 py-1 text-caption uppercase tracking-wider transition-colors duration-fast",
              "text-accent-cyan hover:border-border-strong",
              "disabled:cursor-not-allowed disabled:opacity-30",
            )}
          >
            <Save className="h-3 w-3" /> {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {saveMsg && (
        <div
          className={cn(
            "border-b px-4 py-2 text-caption",
            saveMsg.type === "ok"
              ? "border-border-subtle bg-accent-green/5 text-accent-green"
              : "border-border-red bg-accent-red/5 text-accent-red",
          )}
        >
          {saveMsg.text}
        </div>
      )}

      <div className="grid gap-4 p-4 md:grid-cols-3">
        <ConfigGroup
          title="THRESHOLDS"
          fields={FIELDS.filter((f) => f.group === "thresholds")}
          draft={draft}
          original={original ?? ({} as Record<EnvKey, number>)}
          dirty={dirtyKeys}
          onChange={onChange}
        />
        <ConfigGroup
          title="UNIVERSE"
          fields={FIELDS.filter((f) => f.group === "universe")}
          draft={draft}
          original={original ?? ({} as Record<EnvKey, number>)}
          dirty={dirtyKeys}
          onChange={onChange}
        />
        <ConfigGroup
          title="SIZE MULT"
          fields={FIELDS.filter((f) => f.group === "size")}
          draft={draft}
          original={original ?? ({} as Record<EnvKey, number>)}
          dirty={dirtyKeys}
          onChange={onChange}
        />
      </div>

      <div className="border-t border-border-subtle px-4 py-2 text-micro text-fg-muted">
        Schedule: pre-market{" "}
        <span className="text-fg-primary">{data.premarket_time}</span> · EOD scan{" "}
        <span className="text-fg-primary">{data.eod_scan_time}</span> · daily report{" "}
        <span className="text-fg-primary">{data.daily_report_time}</span>
      </div>
    </Card>
  );
}

function ConfigGroup({
  title,
  fields,
  draft,
  original,
  dirty,
  onChange,
}: {
  title: string;
  fields: ReadonlyArray<FieldDef>;
  draft: Record<EnvKey, number>;
  original: Record<EnvKey, number>;
  dirty: Set<EnvKey>;
  onChange: (key: EnvKey, value: number) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="text-micro uppercase tracking-wider text-fg-muted">{title}</div>
      {fields.map((f) => {
        const v = draft[f.envKey] ?? 0;
        const orig = original[f.envKey] ?? v;
        const changed = dirty.has(f.envKey);
        return (
          <div key={f.envKey} className="space-y-1">
            <label className="flex items-baseline justify-between text-caption text-fg-primary">
              <span>{f.label}</span>
              <span
                className={cn(
                  "tabular-nums text-micro",
                  changed ? "text-accent-amber" : "text-fg-muted",
                )}
              >
                {f.type === "range" && f.step && f.step < 1 ? v.toFixed(2) : v}
                {changed && <span className="ml-1 text-fg-dim">(was {orig})</span>}
              </span>
            </label>
            {f.type === "range" ? (
              <input
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={v}
                onChange={(e) => onChange(f.envKey, Number(e.target.value))}
                className="w-full accent-[var(--color-accent-cyan)]"
              />
            ) : (
              <input
                type="number"
                value={v}
                step={f.step}
                onChange={(e) => onChange(f.envKey, Number(e.target.value))}
                className={cn(
                  "w-full rounded-md border bg-bg-elevated px-2 py-1 text-caption tabular-nums text-fg-primary transition-colors duration-fast focus:outline-none",
                  changed
                    ? "border-accent-amber/50"
                    : "border-border-subtle focus:border-border-accent",
                )}
              />
            )}
            {f.hint && <div className="text-micro text-fg-dim">{f.hint}</div>}
          </div>
        );
      })}
    </section>
  );
}
