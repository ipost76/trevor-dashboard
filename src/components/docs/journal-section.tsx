"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  MoneyText,
  Pill,
  HapticButton,
  BottomSheet,
} from "@/components/ui";
import { BookOpen, Sparkles, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface JournalTrade {
  trade_uri: string;
  trade_source: string;
  trade_id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  pnl_pct: number;
  pnl_usd: number;
  closed_at: string;
  opened_at: string;
  exit_reason?: string | null;
  has_narrative: boolean;
  narrative_id?: number | null;
}

interface BudgetState {
  used: number;
  cap: number;
  reset_date: string;
}

interface JournalListResponse {
  trades: ReadonlyArray<JournalTrade>;
  budget: BudgetState;
  error?: string;
}

interface NarrativeResponse {
  id?: number;
  narrative?: string;
  model?: string;
  tokens_input?: number;
  tokens_output?: number;
  generated_at?: string;
  generated_by?: string;
  from_cache?: boolean;
  error?: string;
  tokens_used_today?: number;
  tokens_cap?: number;
}

// ---- display helpers (presentation only; underlying data untouched) ----

const ACRONYMS = new Set([
  "rsi",
  "oi",
  "cvd",
  "atr",
  "ema",
  "sma",
  "macd",
  "vwap",
  "hmm",
  "pnl",
  "roi",
]);

function prettify(s: string): string {
  const tokens = s.replace(/[()]/g, " ").split(/[_\s]+/).filter(Boolean);
  if (tokens.length === 0) return s;
  return tokens
    .map((t, i) =>
      ACRONYMS.has(t.toLowerCase())
        ? t.toUpperCase()
        : i === 0
          ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
          : t.toLowerCase(),
    )
    .join(" ");
}

/**
 * Map a raw bot/DB exit-reason code to a terse human label. The exact raw code
 * is always preserved elsewhere (row secondary line + detail sheet), so an
 * unknown/new code never loses precision — it falls back to a gentle prettify
 * and the feed never breaks.
 */
function humanizeExitReason(raw: string | null | undefined): string {
  if (!raw) return "—";
  const code = raw.trim();
  if (!code || code.toLowerCase() === "none") return "—";
  const lc = code.toLowerCase();
  let m: RegExpMatchArray | null;
  if (/^momentum_exit_\d+$/.test(lc)) return "Momentum exit";
  if ((m = lc.match(/^stale_(\d+)min$/))) return `Stale (${m[1]}m)`;
  if ((m = lc.match(/^timeout_(\d+)min$/))) return `Timeout (${m[1]}m)`;
  if ((m = lc.match(/^hard_stop_(\d+)pct$/))) return `Hard stop (${m[1]}%)`;
  if ((m = lc.match(/^tech_signals?\((.+)\)$/))) return `Tech signal · ${prettify(m[1])}`;
  if (lc === "external_close") return "Closed externally";
  if (lc === "stop_hit") return "Stop hit";
  if (lc === "manual_orphan_close") return "Manual orphan close";
  return prettify(code);
}

/**
 * SQLite naive "YYYY-MM-DD HH:MM:SS" stamps are UTC — append Z so the browser
 * doesn't read them as local time (house standard: active-position-card,
 * shadow-table-card).
 */
function parseUTC(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = s.includes("T") ? s : s.replace(" ", "T");
  const withZ = /[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t}Z`;
  const d = new Date(withZ);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Tight time-of-day, e.g. "11:54p" (24h locales render "23:54"). */
function fmtTime(d: Date): string {
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(/\s?([AaPp])\.?[Mm]\.?$/, (_, ap) => ap.toLowerCase());
}

/** Day-divider label: Today / Yesterday / "Jun 9" / "Jun 9, 2025". */
function fmtDay(d: Date): string {
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const now = new Date();
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(
    undefined,
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function DirectionTag({ direction }: { direction: "LONG" | "SHORT" }) {
  const isLong = direction === "LONG";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide",
        isLong ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red",
      )}
    >
      <span aria-hidden>{isLong ? "▲" : "▼"}</span>
      {direction}
    </span>
  );
}

export function JournalSection() {
  const [data, setData] = React.useState<JournalListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [openTrade, setOpenTrade] = React.useState<JournalTrade | null>(null);
  const [narrative, setNarrative] = React.useState<NarrativeResponse | null>(null);
  const [generating, setGenerating] = React.useState(false);

  const fetchList = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/intel/journal?limit=30", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openSheet = async (t: JournalTrade) => {
    setOpenTrade(t);
    setNarrative(null);
    if (t.has_narrative) {
      try {
        const res = await fetch(`/api/intel/journal/${t.trade_source}/${t.trade_id}`, {
          cache: "no-store",
        });
        if (res.ok) setNarrative(await res.json());
      } catch (err) {
        setNarrative({ error: String(err) });
      }
    }
  };

  const generate = async () => {
    if (!openTrade) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/intel/journal/${openTrade.trade_source}/${openTrade.trade_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as NarrativeResponse;
      setNarrative(j);
      fetchList();
    } catch (err) {
      setNarrative({ error: String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const regenerate = async () => {
    if (!openTrade) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/intel/journal/${openTrade.trade_source}/${openTrade.trade_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const j = (await res.json()) as NarrativeResponse;
      setNarrative(j);
      fetchList();
    } catch (err) {
      setNarrative({ error: String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const renderFeed = (trades: ReadonlyArray<JournalTrade>) => {
    const items: React.ReactNode[] = [];
    let lastDay = "";
    for (const t of trades) {
      const closed = parseUTC(t.closed_at);
      const dk = closed ? dayKey(closed) : "no-date";
      if (dk !== lastDay) {
        lastDay = dk;
        items.push(
          <li key={`day-${dk}`} className="px-2 pb-1 pt-3 first:pt-1">
            <span className="text-micro font-semibold uppercase tracking-wider text-fg-faint">
              {closed ? fmtDay(closed) : "Unknown date"}
            </span>
          </li>,
        );
      }
      items.push(
        <li key={t.trade_uri}>
          <button
            type="button"
            onClick={() => openSheet(t)}
            className="tap-target group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast hover:bg-bg-elevated/40"
          >
            {/* line 1 — glance: direction · ticker · humanized reason · P&L */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <DirectionTag direction={t.direction} />
                <span className="font-bold text-fg-primary">{t.ticker}</span>
                <span className="truncate text-caption text-fg-muted">
                  {humanizeExitReason(t.exit_reason)}
                </span>
              </div>
              <MoneyText value={t.pnl_pct} unit="%" size="lg" showSign />
            </div>
            {/* line 2 — secondary: tight time · raw code · demoted narrative mark */}
            <div className="flex items-center gap-1.5 text-micro text-fg-faint">
              <span className="font-mono tabular-nums">{closed ? fmtTime(closed) : "—"}</span>
              {t.exit_reason && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate font-mono">{t.exit_reason}</span>
                </>
              )}
              {t.has_narrative && (
                <span
                  className="ml-auto shrink-0 text-accent-cyan-soft-strong"
                  title="Journal entry written"
                >
                  📝
                </span>
              )}
            </div>
          </button>
        </li>,
      );
    }
    return <ul className="divide-y divide-border-subtle">{items}</ul>;
  };

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <BookOpen size={14} />
              JOURNAL
            </span>
          </CardTitle>
          {data?.budget && data.budget.cap > 0 && (
            <BudgetPill used={data.budget.used} cap={data.budget.cap} />
          )}
        </CardHeader>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}

        {!loading && data?.error && <EmptyState title="Failed to load" body={data.error} />}

        {!loading && data && data.trades.length === 0 && (
          <EmptyState
            title="No closed trades"
            body="Journal entries appear after first closed AutoTrader trade."
          />
        )}

        {!loading && data && data.trades.length > 0 && renderFeed(data.trades)}
      </Card>

      <BottomSheet
        open={openTrade !== null}
        onClose={() => {
          setOpenTrade(null);
          setNarrative(null);
        }}
        title={
          openTrade
            ? `${openTrade.ticker} ${openTrade.direction} · ${openTrade.pnl_pct.toFixed(2)}%`
            : ""
        }
      >
        {openTrade && (
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-2 text-caption text-fg-muted">
              <Pill tone="neutral" size="sm">
                {openTrade.trade_uri}
              </Pill>
              <span>
                closed {parseUTC(openTrade.closed_at)?.toLocaleString() ?? openTrade.closed_at}
              </span>
              {openTrade.exit_reason && (
                <span>
                  · {humanizeExitReason(openTrade.exit_reason)}
                  <span className="ml-1 font-mono text-fg-faint">({openTrade.exit_reason})</span>
                </span>
              )}
            </div>

            {!narrative && !generating && (
              <EmptyState
                icon={<Sparkles size={20} />}
                title="No journal entry yet"
                body="Generate a Haiku-written summary for this trade. Spends ~600 tokens (≈$0.0006)."
                action={
                  <HapticButton variant="primary" size="md" onClick={generate}>
                    Generate
                  </HapticButton>
                }
              />
            )}

            {generating && <Skeleton className="h-32 w-full" />}

            {narrative?.error === "budget_exceeded" && (
              <Card padding="md" className="card-warn">
                <div className="flex items-start gap-2">
                  <Lock size={16} className="mt-0.5 text-accent-gold" />
                  <div className="font-sans text-caption text-accent-gold-strong">
                    Daily budget exceeded ({narrative.tokens_used_today}/{narrative.tokens_cap}{" "}
                    tokens). Try again after reset, or raise{" "}
                    <code className="font-mono">ANTHROPIC_API_DAILY_BUDGET_TOKENS</code> via{" "}
                    <code className="font-mono">auto_config</code>.
                  </div>
                </div>
              </Card>
            )}

            {narrative?.error && narrative.error !== "budget_exceeded" && (
              <EmptyState title="Failed to load" body={narrative.error} />
            )}

            {narrative?.narrative && (
              <Card padding="md" className="card-base space-y-2">
                <div className="whitespace-pre-wrap font-sans text-body leading-relaxed text-fg-primary">
                  {narrative.narrative}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 font-sans text-micro text-fg-muted">
                  <Pill tone="neutral" size="sm">
                    {narrative.model ?? "haiku"}
                  </Pill>
                  {narrative.from_cache && (
                    <Pill
                      tone="cyan"
                      size="sm"
                      className="bg-accent-cyan-soft/10 text-accent-cyan-soft-strong border-accent-cyan-soft/30"
                    >
                      cached
                    </Pill>
                  )}
                  {!narrative.from_cache && narrative.tokens_output && (
                    <Pill intent="active" size="sm">
                      {narrative.tokens_input ?? 0}+{narrative.tokens_output} tokens
                    </Pill>
                  )}
                  {narrative.generated_at && (
                    <span className="font-mono">{new Date(narrative.generated_at).toLocaleString()}</span>
                  )}
                </div>
                {narrative.from_cache && (
                  <HapticButton variant="ghost" size="sm" onClick={regenerate}>
                    Regenerate
                  </HapticButton>
                )}
              </Card>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function BudgetPill({ used, cap }: { used: number; cap: number }) {
  const pct = cap > 0 ? (used / cap) * 100 : 0;
  const intent: "live" | "warn" | "error" =
    pct < 70 ? "live" : pct < 90 ? "warn" : "error";
  return (
    <Pill
      intent={intent}
      size="sm"
      title={`${used.toLocaleString()} / ${cap.toLocaleString()} tokens today`}
    >
      {pct.toFixed(0)}% budget
    </Pill>
  );
}
