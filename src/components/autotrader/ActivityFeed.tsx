"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

// Real-time activity feed — last 50 events from auto_trades + active_signal_cards.
// Polls /api/auto-trader/activity every 15s.
// 4 filter pills, 60s pulse highlight on fresh events, fade for events > 1h old.

const GREEN = "#00ff88";
const RED = "#ff4757";
const CYAN = "#00d4ff";
const AMBER = "#ffa502";
const TEXT = "#e8e8f0";
const MUTED = "#8888a0";
const BORDER = "#1e2030";
const SURFACE = "#12131a";
const ROW_BG = "#0a0a0f";

type FilterKind = "all" | "live" | "trades" | "rejections";

type ActivityEvent = {
  id: string;
  timestamp: string;
  type: string;
  ticker: string;
  detail: string;
  trade_mode: string | null;
};

const FILTER_OPTS: { value: FilterKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "trades", label: "Trades" },
  { value: "rejections", label: "Rejects" },
];

function fmtTime(iso: string): string {
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!isFinite(t)) return "—";
  const d = new Date(t);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function ageMs(iso: string): number {
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (!isFinite(t)) return Infinity;
  return Date.now() - t;
}

function eventIcon(type: string, detail: string): string {
  if (type === "opened") return "🟢";
  if (type === "closed") return detail.includes("+$") ? "💰" : "🔴";
  if (type === "accepted") return "✅";
  if (type === "rejected") return "⏸️";
  if (type === "blocked") return "⚠️";
  if (type === "confidence") return "📊";
  return "🔍";
}

function eventTypeColor(type: string, detail: string): string {
  if (type === "opened") return GREEN;
  if (type === "closed") return detail.includes("+$") ? GREEN : RED;
  if (type === "accepted") return CYAN;
  if (type === "rejected") return AMBER;
  if (type === "blocked") return RED;
  return CYAN;
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0); // forces re-render every 5s for age-based styling

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function load() {
      try {
        const res = await fetch(
          `/api/auto-trader/activity?limit=50&filter=${filter}`
        );
        if (!res.ok || cancelled) {
          if (!cancelled) setErr(`HTTP ${res.status}`);
          return;
        }
        const body = (await res.json()) as { events: ActivityEvent[] };
        if (!cancelled) {
          setEvents(body.events || []);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [filter]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section>
      {/* Heading + filter pills */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <Activity size={14} style={{ color: MUTED }} />
          <span
            className="text-[11px] uppercase tracking-[0.12em]"
            style={{
              fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
              color: MUTED,
            }}
          >
            Recent Activity
          </span>
          <span className="text-[10px]" style={{ color: MUTED, opacity: 0.7 }}>
            {loading && events.length === 0
              ? "loading…"
              : `${events.length} events`}
          </span>
          {err && (
            <span className="text-[10px]" style={{ color: RED }}>
              · {err}
            </span>
          )}
        </div>

        <div
          className="flex items-center gap-0.5 rounded-full border p-0.5"
          style={{ borderColor: BORDER, background: "#0a0a0f" }}
        >
          {FILTER_OPTS.map((o) => {
            const active = o.value === filter;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setFilter(o.value)}
                className="rounded-full px-2 sm:px-2.5 py-0.5 text-[10px] sm:text-[11px] uppercase tracking-[0.06em] transition"
                style={{
                  fontFamily: "var(--font-display, 'Orbitron', sans-serif)",
                  background: active ? GREEN : "transparent",
                  color: active ? "#0a0a0f" : MUTED,
                  fontWeight: active ? 700 : 500,
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed body */}
      <div
        className="rounded-lg border overflow-hidden"
        style={{ background: SURFACE, borderColor: BORDER }}
      >
        {loading && events.length === 0 ? (
          <div
            className="py-8 text-center text-[11px]"
            style={{ color: MUTED }}
          >
            loading activity…
          </div>
        ) : events.length === 0 ? (
          <div
            className="py-8 text-center text-[11px]"
            style={{ color: MUTED }}
          >
            <div>no events match this filter</div>
            <div className="text-[10px] mt-1 opacity-70">
              {filter === "live"
                ? "no live trades yet"
                : filter === "rejections"
                ? "no signal rejections in window"
                : "waiting for activity"}
            </div>
          </div>
        ) : (
          <ul className="overflow-y-auto" style={{ maxHeight: 400 }}>
            {events.map((e) => {
              const age = ageMs(e.timestamp);
              const isFresh = age < 60_000;
              const isOld = age > 3_600_000;
              const color = eventTypeColor(e.type, e.detail);
              return (
                <li
                  key={e.id}
                  className={`border-b last:border-b-0 ${
                    isFresh ? "fresh-pulse" : ""
                  }`}
                  style={{
                    borderColor: BORDER,
                    background: isFresh ? `${GREEN}0a` : ROW_BG,
                    opacity: isOld ? 0.55 : 1,
                  }}
                >
                  <div
                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 sm:px-4 py-1.5 text-[11px] sm:text-[12px]"
                    style={{
                      fontFamily: "var(--font-mono, 'IBM Plex Mono', monospace)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span style={{ color: MUTED, minWidth: 38 }}>
                      {fmtTime(e.timestamp)}
                    </span>
                    <span style={{ width: 18 }} aria-hidden>
                      {eventIcon(e.type, e.detail)}
                    </span>
                    <b
                      style={{
                        color: TEXT,
                        fontFamily:
                          "var(--font-display, 'Orbitron', sans-serif)",
                        letterSpacing: "0.04em",
                        minWidth: 72,
                      }}
                    >
                      {e.ticker}
                    </b>
                    <span
                      style={{
                        color,
                        fontWeight: 600,
                        minWidth: 64,
                        textTransform: "lowercase",
                      }}
                    >
                      {e.type}
                    </span>
                    <span
                      style={{
                        color: TEXT,
                        opacity: 0.85,
                        flex: 1,
                        minWidth: 0,
                      }}
                      className="truncate"
                    >
                      {e.detail}
                    </span>
                    {e.trade_mode === "live" && (
                      <span
                        className="rounded px-1 py-0.5 text-[8px] font-bold"
                        style={{
                          background: `${GREEN}1a`,
                          color: GREEN,
                          border: `1px solid ${GREEN}55`,
                          fontFamily:
                            "var(--font-display, 'Orbitron', sans-serif)",
                          letterSpacing: "0.1em",
                        }}
                      >
                        LIVE
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes fresh-pulse-kf{0%,100%{box-shadow:inset 0 0 0 1px " +
            GREEN +
            "33}50%{box-shadow:inset 0 0 0 1px " +
            GREEN +
            "88}}.fresh-pulse{animation:fresh-pulse-kf 2s ease-in-out infinite}",
        }}
      />
    </section>
  );
}
