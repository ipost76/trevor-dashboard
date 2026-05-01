"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, EmptyState, Skeleton, Pill, MoneyText } from "@/components/ui";
import { GitBranch, ArrowRight } from "lucide-react";

interface BaseTrade {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  pnl_pct: number;
  pnl_usd: number;
  closed_at: string;
  confidence_at_entry?: number | null;
  regime_at_entry?: string | null;
  leverage: number;
}
interface SimilarTrade {
  id: number;
  ticker: string;
  direction: "LONG" | "SHORT";
  pnl_pct: number;
  pnl_usd: number;
  closed_at: string;
  exit_reason?: string | null;
  similarity_score: number;
  distance: number;
}
interface SimilarResponse {
  base: BaseTrade;
  similar: ReadonlyArray<SimilarTrade>;
  method: "chromadb" | "feature_vector";
  top_k: number;
  error?: string;
}

interface JournalListResponse {
  trades: ReadonlyArray<{
    trade_uri: string;
    trade_source: string;
    trade_id: number;
    ticker: string;
    direction: "LONG" | "SHORT";
    pnl_pct: number;
    closed_at: string;
  }>;
}

export function SimilarTradesSection() {
  const [trades, setTrades] = React.useState<JournalListResponse["trades"] | null>(null);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [data, setData] = React.useState<SimilarResponse | null>(null);
  const [loadingPicker, setLoadingPicker] = React.useState(true);
  const [loadingSim, setLoadingSim] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/intel/journal?limit=30", { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as JournalListResponse;
          if (!cancelled) setTrades(j.trades);
        }
      } finally {
        if (!cancelled) setLoadingPicker(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const select = async (id: number) => {
    setSelectedId(id);
    setLoadingSim(true);
    setData(null);
    try {
      const res = await fetch(`/api/intel/similar/auto_trades/${id}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally {
      setLoadingSim(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <GitBranch size={14} />
              SIMILAR TRADES
            </span>
          </CardTitle>
          {data && (
            <Pill tone={data.method === "chromadb" ? "cyan" : "neutral"} size="sm">
              {data.method}
            </Pill>
          )}
        </CardHeader>

        <div className="space-y-2">
          <div className="text-micro text-fg-muted">Pick a base trade:</div>
          {loadingPicker && <Skeleton className="h-10 w-full" />}
          {!loadingPicker && trades && trades.length === 0 && (
            <EmptyState title="No trades to compare" body="Need closed AutoTrader trades." />
          )}
          {!loadingPicker && trades && trades.length > 0 && (
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 [&::-webkit-scrollbar]:hidden">
              {trades.slice(0, 20).map((t) => (
                <button
                  key={t.trade_uri}
                  type="button"
                  onClick={() => select(t.trade_id)}
                  className={`tap-target flex-none rounded-md border px-3 py-2 text-caption transition-colors duration-fast ${
                    selectedId === t.trade_id
                      ? "border-accent-cyan bg-accent-cyan/10 text-accent-cyan"
                      : "border-border-subtle bg-bg-elevated text-fg-muted hover:text-fg-primary"
                  }`}
                >
                  <span className="font-bold">{t.ticker}</span>{" "}
                  <span className={t.direction === "LONG" ? "text-accent-green" : "text-accent-red"}>
                    {t.direction}
                  </span>{" "}
                  <MoneyText value={t.pnl_pct} unit="%" size="sm" decimals={2} showSign />
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {selectedId !== null && (
        <Card padding="md">
          {loadingSim && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {!loadingSim && data?.error && (
            <EmptyState title="Failed to load similar" body={data.error} />
          )}

          {!loadingSim && data && data.similar.length === 0 && !data.error && (
            <EmptyState title="No similar trades" body="Sample too thin for cosine match." />
          )}

          {!loadingSim && data && data.similar.length > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between gap-2 text-caption">
                <div className="flex items-center gap-2">
                  <span className="text-fg-muted">Base:</span>
                  <span className="font-bold">
                    {data.base.ticker}{" "}
                    <span className={data.base.direction === "LONG" ? "text-accent-green" : "text-accent-red"}>
                      {data.base.direction}
                    </span>
                  </span>
                  <MoneyText value={data.base.pnl_pct} unit="%" size="sm" decimals={2} showSign />
                </div>
                {typeof data.base.confidence_at_entry === "number" && (
                  <Pill tone="cyan" size="sm">conf {data.base.confidence_at_entry.toFixed(0)}</Pill>
                )}
              </div>

              <ul className="divide-y divide-border-subtle">
                {data.similar.map((s) => (
                  <li
                    key={s.id}
                    className="grid grid-cols-[24px_1fr_auto] items-center gap-2 py-2.5 text-caption"
                  >
                    <ArrowRight size={14} className="text-fg-muted" />
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="font-bold">
                        {s.ticker}{" "}
                        <span className={s.direction === "LONG" ? "text-accent-green" : "text-accent-red"}>
                          {s.direction}
                        </span>
                      </span>
                      <Pill tone="violet" size="sm">
                        sim {(s.similarity_score * 100).toFixed(0)}%
                      </Pill>
                      {s.closed_at && (
                        <span className="text-fg-muted text-micro">
                          {new Date(s.closed_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      )}
                    </div>
                    <MoneyText value={s.pnl_pct} unit="%" size="md" showSign />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
