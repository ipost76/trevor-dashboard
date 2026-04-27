"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

// Empty-state component for AutoTrader when no positions are open.
// Replaces the giant pause-icon EmptyState with informative scanning radar +
// 5 sacred-ticker pills that show per-ticker scan status.
//
// Status → dot color mapping:
//   scanning      = green (passing filters)
//   cooldown      = amber (recent fire still in 60min window)
//   recent_reject = gray  (last scan within 60min was rejected)
//
// Tap a ticker pill to expand and see last-3 confidence scores + reject reason.
// Polls /api/auto-trader/scan-status every 30s.

const GREEN = "#00ff88";
const AMBER = "#ffa502";
const GRAY = "#5a5a6a";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#0e1015";

type ScanStatus = {
  ticker: string;
  status: "scanning" | "cooldown" | "recent_reject";
  on_cooldown: boolean;
  cooldown_remaining_minutes: number | null;
  cooldown_direction: string | null;
  last_confidence: number | null;
  last_reject_reason: string | null;
  last_scan_at: string | null;
  recent_confidences: Array<{
    ts: string;
    direction: string;
    original: number | null;
    current: number | null;
    peak: number | null;
    removed: string | null;
  }>;
};

type Props = {
  enabled: boolean;
};

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!isFinite(t)) return "—";
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function dotColor(s: ScanStatus["status"]): string {
  if (s === "cooldown") return AMBER;
  if (s === "recent_reject") return GRAY;
  return GREEN;
}

export function ScanningEmptyState({ enabled }: Props) {
  const [data, setData] = useState<ScanStatus[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/auto-trader/scan-status");
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { tickers: ScanStatus[] };
        if (!cancelled) setData(body.tickers || []);
      } catch {
        /* swallow — empty state degrades gracefully */
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Disabled state — minimal, no radar
  if (!enabled) {
    return (
      <div
        className="rounded-lg flex flex-col items-center justify-center px-4 py-5"
        style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
      >
        <span
          className="text-[11px] uppercase tracking-[0.1em]"
          style={{
            color: MUTED,
            fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
          }}
        >
          Auto Trader OFF
        </span>
      </div>
    );
  }

  const expandedRow = expanded ? data.find((x) => x.ticker === expanded) : null;

  return (
    <div
      className="rounded-lg px-3 sm:px-4 py-3"
      style={{ background: SURFACE, border: `1px solid ${BORDER}` }}
    >
      {/* Title bar with radar */}
      <div className="flex items-center gap-2">
        <div
          className="relative inline-flex items-center justify-center"
          style={{ width: 28, height: 28, flexShrink: 0 }}
          aria-hidden
        >
          <span
            className="absolute inset-0 rounded-full radar-pulse"
            style={{
              background: `radial-gradient(circle, ${GREEN}33 0%, transparent 65%)`,
            }}
          />
          <Radio
            size={13}
            style={{ color: GREEN, opacity: 0.95, position: "relative" }}
          />
        </div>
        <span
          className="text-[11px] sm:text-[12px]"
          style={{
            color: TEXT,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            opacity: 0.9,
          }}
        >
          scanning 5 tickers for entry signals
        </span>
      </div>

      {/* Ticker pills */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {data.length === 0 ? (
          <span className="text-[10px]" style={{ color: MUTED }}>
            loading scan data…
          </span>
        ) : (
          data.map((t) => {
            const isExpanded = expanded === t.ticker;
            const c = dotColor(t.status);
            return (
              <button
                key={t.ticker}
                type="button"
                onClick={() =>
                  setExpanded((cur) => (cur === t.ticker ? null : t.ticker))
                }
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] sm:text-[11px] transition"
                style={{
                  background: isExpanded ? "#191c25" : "#0a0a0f",
                  border: `1px solid ${isExpanded ? c : BORDER}`,
                  color: TEXT,
                  fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                  cursor: "pointer",
                }}
                aria-expanded={isExpanded}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: c }}
                  aria-hidden
                />
                <b
                  style={{
                    fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {t.ticker}
                </b>
                {t.status === "cooldown" &&
                  t.cooldown_remaining_minutes != null && (
                    <span style={{ color: AMBER, opacity: 0.85 }}>
                      {t.cooldown_remaining_minutes < 1
                        ? "<1m"
                        : `${Math.round(t.cooldown_remaining_minutes)}m`}
                    </span>
                  )}
                {t.status === "recent_reject" && t.last_confidence != null && (
                  <span style={{ color: GRAY, opacity: 0.85 }}>
                    {Math.round(t.last_confidence)}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Expanded detail */}
      {expandedRow && (
        <div
          className="mt-2.5 rounded px-2.5 py-2 text-[10px] sm:text-[11px]"
          style={{
            background: "#0a0a0f",
            border: `1px solid ${dotColor(expandedRow.status)}33`,
            fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
            color: MUTED,
          }}
        >
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <b
              style={{
                color: TEXT,
                fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                letterSpacing: "0.04em",
              }}
            >
              {expandedRow.ticker}
            </b>
            {expandedRow.status === "cooldown" && (
              <span style={{ color: AMBER }}>
                {expandedRow.cooldown_direction} cooldown
                {expandedRow.cooldown_remaining_minutes != null
                  ? ` · ${expandedRow.cooldown_remaining_minutes.toFixed(0)}m left`
                  : ""}
              </span>
            )}
            {expandedRow.status === "scanning" && (
              <span style={{ color: GREEN }}>passing filters</span>
            )}
            {expandedRow.status === "recent_reject" && (
              <span style={{ color: GRAY }}>recently rejected</span>
            )}
          </div>

          {expandedRow.recent_confidences.length === 0 ? (
            <span style={{ opacity: 0.7 }}>no recent scans on record</span>
          ) : (
            <div className="space-y-0.5">
              {expandedRow.recent_confidences.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-x-2">
                  <span style={{ color: MUTED, opacity: 0.7, minWidth: 70 }}>
                    {fmtAgo(c.ts)}
                  </span>
                  <span style={{ color: TEXT }}>
                    {c.direction}{" "}
                    <b>{c.original != null ? c.original.toFixed(0) : "—"}</b>
                    {c.peak != null &&
                      c.original != null &&
                      c.peak > c.original + 0.5 && (
                        <span style={{ opacity: 0.7 }}>
                          {" "}
                          (peak {c.peak.toFixed(0)})
                        </span>
                      )}
                  </span>
                  {c.removed && (
                    <span style={{ color: MUTED, opacity: 0.7 }}>
                      · {c.removed}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Radar pulse animation */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes radar-pulse-kf{0%{transform:scale(0.6);opacity:0.9}100%{transform:scale(1.6);opacity:0}}.radar-pulse{animation:radar-pulse-kf 2s ease-out infinite}",
        }}
      />
    </div>
  );
}
