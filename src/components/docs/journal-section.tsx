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

        {!loading && data && data.trades.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {data.trades.map((t) => (
              <li key={t.trade_uri}>
                <button
                  type="button"
                  onClick={() => openSheet(t)}
                  className="tap-target group flex w-full items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left text-caption transition-colors duration-fast hover:bg-bg-elevated/40"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-bold">
                      {t.ticker}{" "}
                      <span
                        className={
                          t.direction === "LONG" ? "text-accent-green" : "text-accent-red"
                        }
                      >
                        {t.direction}
                      </span>
                    </span>
                    <span className="text-micro text-fg-muted">
                      {new Date(t.closed_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {t.exit_reason && (
                      <span className="text-micro text-fg-faint">· {t.exit_reason}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <MoneyText value={t.pnl_pct} unit="%" size="md" showSign />
                    {t.has_narrative ? (
                      <Pill tone="cyan" size="sm">
                        📝
                      </Pill>
                    ) : (
                      <Pill tone="neutral" size="sm">
                        —
                      </Pill>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
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
              <span>closed {new Date(openTrade.closed_at).toLocaleString()}</span>
              {openTrade.exit_reason && <span>· {openTrade.exit_reason}</span>}
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
              <Card glow="amber" padding="md">
                <div className="flex items-start gap-2">
                  <Lock size={16} className="mt-0.5 text-accent-amber" />
                  <div className="text-caption text-accent-amber">
                    Daily budget exceeded ({narrative.tokens_used_today}/{narrative.tokens_cap}{" "}
                    tokens). Try again after reset, or raise{" "}
                    <code>ANTHROPIC_API_DAILY_BUDGET_TOKENS</code> via <code>auto_config</code>.
                  </div>
                </div>
              </Card>
            )}

            {narrative?.error && narrative.error !== "budget_exceeded" && (
              <EmptyState title="Failed to load" body={narrative.error} />
            )}

            {narrative?.narrative && (
              <Card padding="md" className="space-y-2">
                <div className="whitespace-pre-wrap text-body text-fg-primary">
                  {narrative.narrative}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2 text-micro text-fg-muted">
                  <Pill tone="neutral" size="sm">
                    {narrative.model ?? "haiku"}
                  </Pill>
                  {narrative.from_cache && (
                    <Pill tone="cyan" size="sm">
                      cached
                    </Pill>
                  )}
                  {!narrative.from_cache && narrative.tokens_output && (
                    <Pill tone="green" size="sm">
                      {narrative.tokens_input ?? 0}+{narrative.tokens_output} tokens
                    </Pill>
                  )}
                  {narrative.generated_at && (
                    <span>{new Date(narrative.generated_at).toLocaleString()}</span>
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
  const tone: "green" | "amber" | "red" = pct < 70 ? "green" : pct < 90 ? "amber" : "red";
  return (
    <Pill
      tone={tone}
      size="sm"
      title={`${used.toLocaleString()} / ${cap.toLocaleString()} tokens today`}
    >
      {pct.toFixed(0)}% budget
    </Pill>
  );
}
