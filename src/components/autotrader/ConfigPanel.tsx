"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings } from "lucide-react";

// Editable auto_config panel.
// - Numeric fields commit on blur / Enter. Toggles commit on click.
// - Optimistic UI with a short "saved" flash and inline error text.
// - Per-ticker leverage is view-only (source-of-truth is the executor constant).

const GREEN = "#00ff88";
const RED = "#ff4757";
const AMBER = "#ffa502";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#12131a";
const INPUT_BG = "#0a0a0f";

// Per-ticker leverage is a code constant in auto_trader/executor.py — shown
// here read-only so Ghost sees the active map. To change it, edit code and
// restart (kept out of auto_config to prevent "drift" between DB and code).
const LEVERAGE_MAP: Record<string, number> = {
  BTC: 25,
  ETH: 15,
  SOL: 12,
  HYPE: 10,
  FARTCOIN: 8,
};

type FieldKind = "int" | "float" | "bool";
type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  suffix?: string;
};

const NUMERIC_FIELDS: FieldDef[] = [
  { key: "AGGRESSIVE_THRESHOLD", label: "Threshold", kind: "int", hint: "confidence floor" },
  { key: "MAX_CONCURRENT", label: "Max Concurrent", kind: "int" },
  { key: "MAX_TRADES_PER_DAY", label: "Max Daily", kind: "int" },
  { key: "MAX_CONSECUTIVE_LOSSES", label: "Loss Streak Cap", kind: "int" },
  { key: "PAUSE_AFTER_LOSSES_MINUTES", label: "Pause After Losses", kind: "int", suffix: "min" },
  { key: "LEVERAGE_DEFAULT", label: "Discovery Leverage", kind: "float", suffix: "x", hint: "for non-mapped tickers" },
];

const TOGGLE_FIELDS: FieldDef[] = [
  { key: "AUTO_TRADER_ENABLED", label: "Auto Trader", kind: "bool" },
  { key: "TICKER_DISCOVERY", label: "Ticker Discovery", kind: "bool" },
];

type ConfigResponse = {
  ok: boolean;
  config: Record<string, string>;
  allowed_write_keys: string[];
  error?: string;
};

type FieldStatus = "idle" | "saving" | "saved" | "error";

export function ConfigPanel() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, { s: FieldStatus; err?: string }>>({});
  const clearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const setFieldStatus = useCallback(
    (key: string, s: FieldStatus, err?: string) => {
      setStatus((prev) => ({ ...prev, [key]: { s, err } }));
      if (s === "saved") {
        const existing = clearTimers.current.get(key);
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
          setStatus((prev) => ({ ...prev, [key]: { s: "idle" } }));
          clearTimers.current.delete(key);
        }, 1600);
        clearTimers.current.set(key, t);
      }
    },
    []
  );

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/auto-trader/config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ConfigResponse;
      if (!data.ok) throw new Error(data.error || "load failed");
      setConfig(data.config || {});
      setLoaded(true);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(String(e));
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    return () => {
      for (const t of clearTimers.current.values()) clearTimeout(t);
      clearTimers.current.clear();
    };
  }, [loadConfig]);

  const save = useCallback(
    async (key: string, value: string) => {
      setFieldStatus(key, "saving");
      try {
        const res = await fetch("/api/auto-trader/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        const data = (await res.json()) as { ok: boolean; value?: string; error?: string };
        if (!res.ok || !data.ok) {
          setFieldStatus(key, "error", data.error || `HTTP ${res.status}`);
          return;
        }
        setConfig((prev) => ({ ...prev, [key]: data.value ?? value }));
        setFieldStatus(key, "saved");
      } catch (e) {
        setFieldStatus(key, "error", String(e));
      }
    },
    [setFieldStatus]
  );

  return (
    <div
      className="rounded-lg"
      style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
    >
      {/* Heading */}
      <div
        className="flex items-center gap-2 border-b px-4 py-2"
        style={{ borderColor: BORDER }}
      >
        <Settings size={14} style={{ color: MUTED }} />
        <span
          className="text-[11px] uppercase tracking-[0.12em]"
          style={{
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            color: MUTED,
          }}
        >
          Configuration
        </span>
        {loadErr && (
          <span className="ml-auto text-[10px]" style={{ color: RED }}>
            {loadErr}
          </span>
        )}
      </div>

      {!loaded ? (
        <div className="p-4 text-[11px]" style={{ color: MUTED }}>
          Loading…
        </div>
      ) : (
        <div className="p-3 sm:p-4">
          {/* Toggles (prominent row) */}
          <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TOGGLE_FIELDS.map((f) => (
              <ToggleRow
                key={f.key}
                field={f}
                value={config[f.key]}
                status={status[f.key] || { s: "idle" }}
                onChange={(v) => save(f.key, v ? "true" : "false")}
              />
            ))}
          </div>

          {/* Numeric fields 2-col grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {NUMERIC_FIELDS.map((f) => (
              <NumericRow
                key={f.key}
                field={f}
                value={config[f.key]}
                status={status[f.key] || { s: "idle" }}
                onCommit={(v) => save(f.key, v)}
              />
            ))}
          </div>

          {/* PER_TRADE_USD — numeric but with dynamic-range caption */}
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <NumericRow
              field={{
                key: "PER_TRADE_USD",
                label: "Per-Trade (fallback)",
                kind: "float",
                suffix: "$",
                hint: "dynamic $5–15 by confidence",
              }}
              value={config["PER_TRADE_USD"]}
              status={status["PER_TRADE_USD"] || { s: "idle" }}
              onCommit={(v) => save("PER_TRADE_USD", v)}
            />
            <NumericRow
              field={{
                key: "CAPITAL_USD",
                label: "Starting Capital",
                kind: "float",
                suffix: "$",
              }}
              value={config["CAPITAL_USD"]}
              status={status["CAPITAL_USD"] || { s: "idle" }}
              onCommit={(v) => save("CAPITAL_USD", v)}
            />
          </div>

          {/* Leverage view-only */}
          <div
            className="mt-3 rounded border px-3 py-2"
            style={{ borderColor: BORDER, background: INPUT_BG }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-[10px] uppercase tracking-[0.1em]"
                style={{ color: MUTED }}
              >
                Per-Ticker Leverage (view-only)
              </span>
              <span className="text-[10px]" style={{ color: MUTED, opacity: 0.7 }}>
                set in executor.py
              </span>
            </div>
            <div
              className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px]"
              style={{
                fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Object.entries(LEVERAGE_MAP).map(([tk, lev]) => (
                <span key={tk}>
                  <span style={{ color: MUTED }}>{tk}:</span>{" "}
                  <b style={{ color: TEXT }}>{lev}x</b>
                </span>
              ))}
            </div>
          </div>

          <div
            className="mt-3 text-[10px] text-center"
            style={{ color: MUTED, opacity: 0.7 }}
          >
            Changes save individually on blur / Enter. Toggles save on click.
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Toggle switch ── */
function ToggleRow({
  field,
  value,
  status,
  onChange,
}: {
  field: FieldDef;
  value: string | undefined;
  status: { s: FieldStatus; err?: string };
  onChange: (on: boolean) => void;
}) {
  const on = (value || "false").toLowerCase() === "true";
  const saving = status.s === "saving";
  const trackBg = on ? GREEN : "#2a2d3a";
  const thumbX = on ? 18 : 2;

  return (
    <div
      className="flex items-center justify-between rounded border px-3 py-2"
      style={{ background: INPUT_BG, borderColor: BORDER }}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-[11px]" style={{ color: MUTED }}>
          {field.label}
        </span>
        <span
          className="text-[13px] font-semibold"
          style={{
            color: on ? GREEN : RED,
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            letterSpacing: "0.08em",
          }}
        >
          {on ? "ON" : "OFF"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <FieldFlash status={status} />
        <button
          type="button"
          onClick={() => !saving && onChange(!on)}
          disabled={saving}
          aria-label={`Toggle ${field.label}`}
          className="relative inline-block rounded-full"
          style={{
            width: 36,
            height: 18,
            background: trackBg,
            transition: "background 0.18s",
            opacity: saving ? 0.6 : 1,
            cursor: saving ? "wait" : "pointer",
          }}
        >
          <span
            className="absolute top-[2px] rounded-full"
            style={{
              width: 14,
              height: 14,
              background: "#0a0a0f",
              left: thumbX,
              transition: "left 0.18s",
              boxShadow: on ? `0 0 6px ${GREEN}80` : "none",
            }}
          />
        </button>
      </div>
    </div>
  );
}

/* ── Numeric input row ── */
function NumericRow({
  field,
  value,
  status,
  onCommit,
}: {
  field: FieldDef;
  value: string | undefined;
  status: { s: FieldStatus; err?: string };
  onCommit: (value: string) => void;
}) {
  // Local draft so we don't overwrite while user is typing
  const [draft, setDraft] = useState<string>(value ?? "");
  const [focused, setFocused] = useState(false);

  // When upstream changes (save succeeded OR initial load) and we're not focused, sync.
  useEffect(() => {
    if (!focused) setDraft(value ?? "");
  }, [value, focused]);

  const saving = status.s === "saving";
  const err = status.s === "error" ? status.err : undefined;

  const borderColor = useMemo(() => {
    if (status.s === "error") return RED;
    if (focused) return GREEN;
    return BORDER;
  }, [focused, status.s]);

  const commit = () => {
    const trimmed = draft.trim();
    const original = (value ?? "").trim();
    if (trimmed === "" || trimmed === original) {
      setDraft(original);
      return;
    }
    onCommit(trimmed);
  };

  return (
    <div
      className="rounded border px-3 py-2"
      style={{
        background: INPUT_BG,
        borderColor,
        transition: "border-color 0.18s",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: MUTED }}>
          {field.label}
        </span>
        <FieldFlash status={status} />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        {field.suffix === "$" && (
          <span
            className="text-[12px]"
            style={{ color: MUTED }}
          >
            $
          </span>
        )}
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setDraft(value ?? "");
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-semibold"
          style={{
            color: TEXT,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            fontVariantNumeric: "tabular-nums",
            opacity: saving ? 0.6 : 1,
          }}
          aria-label={field.label}
        />
        {field.suffix && field.suffix !== "$" && (
          <span className="text-[11px]" style={{ color: MUTED }}>
            {field.suffix}
          </span>
        )}
      </div>
      {(field.hint || err) && (
        <div
          className="mt-0.5 text-[10px]"
          style={{ color: err ? RED : MUTED, opacity: err ? 1 : 0.7 }}
        >
          {err || field.hint}
        </div>
      )}
    </div>
  );
}

/* ── Small status indicator ── */
function FieldFlash({ status }: { status: { s: FieldStatus; err?: string } }) {
  if (status.s === "saved") {
    return (
      <span
        className="text-[10px] font-bold"
        style={{ color: GREEN, letterSpacing: "0.08em" }}
      >
        ✓ SAVED
      </span>
    );
  }
  if (status.s === "saving") {
    return (
      <span className="text-[10px]" style={{ color: AMBER }}>
        saving…
      </span>
    );
  }
  if (status.s === "error") {
    return (
      <span className="text-[10px]" style={{ color: RED }}>
        failed
      </span>
    );
  }
  return null;
}
