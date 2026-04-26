"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings, ChevronDown, ChevronRight } from "lucide-react";
import type { AutoTraderSummary } from "@/hooks/useAutoTraderStream";

// Editable auto_config panel.
// - Numeric fields commit on blur / Enter. Toggles commit on click.
// - Optimistic UI with a short "saved" flash and inline error text.
// - Per-ticker leverage is view-only (source-of-truth is the executor constant).
//
// 2026-04-26 — Premium pass: split into PAPER + LIVE sections with explicit
// LIVE_* edits, surfaces SDK error count and dead-man switch, and exposes
// the hard capital cap as view-only (code-enforced floor).

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

const PAPER_NUMERIC: FieldDef[] = [
  { key: "AGGRESSIVE_THRESHOLD", label: "Threshold", kind: "int", hint: "confidence floor" },
  { key: "MAX_CONCURRENT", label: "Max Concurrent", kind: "int" },
  { key: "MAX_TRADES_PER_DAY", label: "Max Daily", kind: "int" },
  { key: "LEVERAGE_DEFAULT", label: "Discovery Leverage", kind: "float", suffix: "x", hint: "non-mapped tickers" },
  {
    key: "PER_TRADE_USD",
    label: "Per-Trade (fallback)",
    kind: "float",
    suffix: "$",
    hint: "dynamic $5–15 by confidence",
  },
  { key: "CAPITAL_USD", label: "Starting Capital", kind: "float", suffix: "$" },
];

const LIVE_NUMERIC: FieldDef[] = [
  { key: "LIVE_PER_TRADE_USD", label: "Per-Trade", kind: "float", suffix: "$", hint: "real money per trade" },
  { key: "LIVE_MAX_CONCURRENT", label: "Max Concurrent", kind: "int" },
  { key: "LIVE_MAX_DAILY_TRADES", label: "Max Daily", kind: "int" },
  { key: "LIVE_LEVERAGE_DEFAULT", label: "Default Leverage", kind: "float", suffix: "x" },
  { key: "LIVE_CAPITAL_USD", label: "Starting Capital", kind: "float", suffix: "$" },
  { key: "LIVE_SLIPPAGE_PCT", label: "Slippage", kind: "float", suffix: "%", hint: "fraction (0.01 = 1%)" },
  {
    key: "LIVE_DEAD_MAN_SWITCH_MS",
    label: "Dead-Man Switch",
    kind: "int",
    suffix: "ms",
    hint: "halt if heartbeat misses",
  },
  {
    key: "LIVE_SDK_ERROR_THRESHOLD",
    label: "SDK Error Threshold",
    kind: "int",
    hint: "trigger pause after N errors",
  },
];

type ConfigResponse = {
  ok: boolean;
  config: Record<string, string>;
  allowed_write_keys: string[];
  error?: string;
};

type FieldStatus = "idle" | "saving" | "saved" | "error";

export function ConfigPanel({
  summary,
}: {
  summary: AutoTraderSummary | null;
}) {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, { s: FieldStatus; err?: string }>>({});
  const [paperOpen, setPaperOpen] = useState(true);
  const [liveOpen, setLiveOpen] = useState(true);
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

  const isLiveMode = (config["AUTO_LIVE_ENABLED"] || "false").toLowerCase() === "true";
  const sdkErrors = Number(summary?.sdk_errors ?? 0);
  const liveCap = Number(
    summary?.live_hard_cap ?? config["LIVE_HARD_CAPITAL_CAP_USD"] ?? 50
  );
  const deadManMs = Number(config["LIVE_DEAD_MAN_SWITCH_MS"] ?? 300000);
  const orderType = (config["LIVE_ORDER_TYPE"] || "market").toLowerCase();

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
          {/* Master toggles */}
          <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ToggleRow
              field={{
                key: "AUTO_TRADER_ENABLED",
                label: "Auto Trader",
                kind: "bool",
              }}
              value={config["AUTO_TRADER_ENABLED"]}
              status={status["AUTO_TRADER_ENABLED"] || { s: "idle" }}
              onChange={(v) => save("AUTO_TRADER_ENABLED", v ? "true" : "false")}
            />
            <ToggleRow
              field={{
                key: "AUTO_LIVE_ENABLED",
                label: "🟢 Live Mode (real money)",
                kind: "bool",
              }}
              value={config["AUTO_LIVE_ENABLED"]}
              status={status["AUTO_LIVE_ENABLED"] || { s: "idle" }}
              onChange={(v) => save("AUTO_LIVE_ENABLED", v ? "true" : "false")}
              danger
            />
          </div>

          <div className="mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ToggleRow
              field={{
                key: "TICKER_DISCOVERY",
                label: "Ticker Discovery",
                kind: "bool",
              }}
              value={config["TICKER_DISCOVERY"]}
              status={status["TICKER_DISCOVERY"] || { s: "idle" }}
              onChange={(v) => save("TICKER_DISCOVERY", v ? "true" : "false")}
            />
            {/* spacer to keep grid alignment on desktop */}
            <div className="hidden sm:block" />
          </div>

          {/* LIVE section (highlighted when live mode active) */}
          <SectionHeader
            label="🟢 Live Trading"
            sub="real-money parameters"
            isOpen={liveOpen}
            highlight={isLiveMode}
            onToggle={() => setLiveOpen((v) => !v)}
          />
          {liveOpen && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {LIVE_NUMERIC.map((f) => (
                  <NumericRow
                    key={f.key}
                    field={f}
                    value={config[f.key]}
                    status={status[f.key] || { s: "idle" }}
                    onCommit={(v) => save(f.key, v)}
                    accent={isLiveMode}
                  />
                ))}
              </div>

              {/* Live view-only block */}
              <div
                className="mt-3 rounded border px-3 py-2"
                style={{ borderColor: BORDER, background: INPUT_BG }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-[10px] uppercase tracking-[0.1em]"
                    style={{ color: MUTED }}
                  >
                    Live Status (view-only)
                  </span>
                  <span className="text-[10px]" style={{ color: MUTED, opacity: 0.7 }}>
                    code-enforced
                  </span>
                </div>
                <div
                  className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[12px]"
                  style={{
                    fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <ViewOnly
                    label="Hard Cap"
                    value={`$${liveCap.toFixed(0)}`}
                    color={GREEN}
                    title="LIVE_HARD_CAPITAL_CAP_USD — uneditable floor"
                  />
                  <ViewOnly
                    label="SDK Errors"
                    value={String(sdkErrors)}
                    color={sdkErrors > 0 ? AMBER : TEXT}
                  />
                  <ViewOnly
                    label="Dead-Man"
                    value={`${(deadManMs / 1000).toFixed(0)}s`}
                    color={TEXT}
                    title={`${deadManMs}ms`}
                  />
                  <ViewOnly
                    label="Order Type"
                    value={orderType}
                    color={TEXT}
                    title="LIVE_ORDER_TYPE — code-enforced"
                  />
                </div>
              </div>
            </>
          )}

          {/* PAPER section */}
          <div className="mt-4">
            <SectionHeader
              label="📄 Paper Trading"
              sub="simulated parameters"
              isOpen={paperOpen}
              highlight={!isLiveMode}
              onToggle={() => setPaperOpen((v) => !v)}
            />
            {paperOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PAPER_NUMERIC.map((f) => (
                  <NumericRow
                    key={f.key}
                    field={f}
                    value={config[f.key]}
                    status={status[f.key] || { s: "idle" }}
                    onCommit={(v) => save(f.key, v)}
                    accent={!isLiveMode}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Per-ticker leverage view-only */}
          <div
            className="mt-4 rounded border px-3 py-2"
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

/* ── Section header with collapse chevron ── */
function SectionHeader({
  label,
  sub,
  isOpen,
  highlight,
  onToggle,
}: {
  label: string;
  sub?: string;
  isOpen: boolean;
  highlight?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2 transition"
      style={{ color: highlight ? GREEN : MUTED }}
    >
      <div className="flex items-center gap-2">
        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span
          className="text-[11px] uppercase tracking-[0.12em]"
          style={{
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
            color: highlight ? GREEN : MUTED,
          }}
        >
          {label}
        </span>
        {sub && (
          <span className="text-[10px] opacity-60 normal-case tracking-normal">
            {sub}
          </span>
        )}
      </div>
    </button>
  );
}

function ViewOnly({
  label,
  value,
  color,
  title,
}: {
  label: string;
  value: string;
  color: string;
  title?: string;
}) {
  return (
    <div className="flex flex-col" title={title}>
      <span className="text-[9px] uppercase tracking-[0.1em] opacity-70" style={{ color: MUTED }}>
        {label}
      </span>
      <b style={{ color }}>{value}</b>
    </div>
  );
}

/* ── Toggle switch ── */
function ToggleRow({
  field,
  value,
  status,
  onChange,
  danger,
}: {
  field: FieldDef;
  value: string | undefined;
  status: { s: FieldStatus; err?: string };
  onChange: (on: boolean) => void;
  danger?: boolean;
}) {
  const on = (value || "false").toLowerCase() === "true";
  const saving = status.s === "saving";
  const trackBg = on ? (danger ? GREEN : GREEN) : "#2a2d3a";
  const thumbX = on ? 18 : 2;

  return (
    <div
      className="flex items-center justify-between rounded border px-3 py-2"
      style={{
        background: INPUT_BG,
        borderColor: danger && on ? GREEN : BORDER,
        boxShadow: danger && on ? `inset 0 0 16px ${GREEN}22` : "none",
      }}
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
  accent,
}: {
  field: FieldDef;
  value: string | undefined;
  status: { s: FieldStatus; err?: string };
  onCommit: (value: string) => void;
  accent?: boolean;
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
    if (accent) return `${GREEN}33`;
    return BORDER;
  }, [focused, status.s, accent]);

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
