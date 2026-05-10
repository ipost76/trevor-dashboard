"use client";

import { useMemo, useState } from "react";
import { Card, EmptyState, Pill, Skeleton } from "@/components/ui";
import {
  Building2,
  ExternalLink,
  FileText,
  Inbox,
  RefreshCw,
  UserSquare2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useScoutFetch } from "./use-fetch";
import { fetchFilings } from "./api";
import {
  formatDateOnly,
  formatRelativeDays,
  type Tone,
} from "./format";
import type { Filing8K, InsiderTrade, StakeAlert } from "./types";

type FilingKind = "8k" | "form4" | "13g";

interface UnifiedFiling {
  kind: FilingKind;
  filing_date: string;
  ticker: string;
  payload: Filing8K | InsiderTrade | StakeAlert;
}

const KIND_LABEL: Record<FilingKind | "all", string> = {
  all: "All",
  "8k": "8-K",
  form4: "Form 4",
  "13g": "13G/13D",
};

const ITEM_8K_LABEL: Record<string, string> = {
  "1.01": "Material Agreement",
  "1.02": "Terminated Agreement",
  "1.03": "Bankruptcy",
  "2.01": "Acquisition",
  "2.02": "Results",
  "2.03": "Material Obligation",
  "2.04": "Off-balance Sheet",
  "2.05": "Costs Associated",
  "2.06": "Impairment",
  "3.01": "Listing Notice",
  "3.02": "Unregistered Equity",
  "4.01": "Auditor Change",
  "4.02": "Restatement",
  "5.01": "Control Change",
  "5.02": "Officer/Director",
  "5.03": "Charter Amendment",
  "5.07": "Vote Result",
  "7.01": "FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Exhibits",
};

const ITEM_8K_TONE: Record<string, Tone> = {
  "1.01": "green",
  "2.01": "green",
  "2.02": "green",
  "5.07": "green",
  "7.01": "green",
  "1.02": "red",
  "1.03": "red",
  "2.06": "red",
  "4.01": "red",
  "4.02": "red",
  "3.01": "red",
  "5.01": "amber",
  "5.02": "amber",
  "5.03": "amber",
  "8.01": "amber",
  "2.03": "amber",
  "2.04": "amber",
  "2.05": "amber",
  "3.02": "amber",
  "9.01": "neutral",
};

function parseItemCodes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((s) => String(s));
  } catch {
    /* ignore */
  }
  return [];
}

function edgarTickerUrl(ticker: string, type: string): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(
    ticker,
  )}&type=${encodeURIComponent(type)}&dateb=&owner=include&count=40`;
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function formatShares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

export function FilingsStream() {
  const [days, setDays] = useState(7);
  const [kind, setKind] = useState<FilingKind | "all">("all");
  const [tickerFilter, setTickerFilter] = useState("");

  const { data, error, loading, refresh } = useScoutFetch(
    (signal) => fetchFilings({ days, signal }),
    [days],
    { refreshMs: 60_000 },
  );

  const unified = useMemo<UnifiedFiling[]>(() => {
    if (!data) return [];
    const out: UnifiedFiling[] = [];
    for (const f of data.filings_8k ?? []) {
      out.push({ kind: "8k", filing_date: f.filing_date, ticker: f.ticker, payload: f });
    }
    for (const t of data.insider_trades ?? []) {
      out.push({ kind: "form4", filing_date: t.filing_date, ticker: t.ticker, payload: t });
    }
    for (const s of data.stake_alerts ?? []) {
      out.push({ kind: "13g", filing_date: s.filing_date, ticker: s.ticker, payload: s });
    }
    return out
      .filter((f) => kind === "all" || f.kind === kind)
      .filter((f) => {
        if (!tickerFilter.trim()) return true;
        return f.ticker.toUpperCase().includes(tickerFilter.toUpperCase().trim());
      })
      .sort((a, b) => b.filing_date.localeCompare(a.filing_date));
  }, [data, kind, tickerFilter]);

  const counts = useMemo(() => {
    if (!data) return { all: 0, "8k": 0, form4: 0, "13g": 0 };
    return {
      all:
        (data.filings_8k?.length ?? 0) +
        (data.insider_trades?.length ?? 0) +
        (data.stake_alerts?.length ?? 0),
      "8k": data.filings_8k?.length ?? 0,
      form4: data.insider_trades?.length ?? 0,
      "13g": data.stake_alerts?.length ?? 0,
    };
  }, [data]);

  return (
    <Card padding="none" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-h3 text-fg-primary">FILINGS</h2>
          <span className="text-caption text-fg-muted">
            {counts.all} in last {days}d
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={tickerFilter}
            onChange={(e) => setTickerFilter(e.target.value.toUpperCase())}
            placeholder="TICKER"
            maxLength={8}
            className="w-28 rounded-md border border-border-subtle bg-bg-elevated px-2 py-1 text-caption uppercase tracking-wider text-fg-primary placeholder:text-fg-dim focus:border-border-accent focus:outline-none"
          />
          <DaysSelector days={days} setDays={setDays} />
          <button
            type="button"
            onClick={refresh}
            className="rounded-pill border border-border-subtle px-2 py-0.5 text-fg-muted transition-colors duration-fast hover:border-border-strong hover:text-accent-cyan"
            aria-label="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2">
        {(["all", "8k", "form4", "13g"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              "rounded-pill border px-3 py-0.5 text-micro uppercase tracking-wider transition-colors duration-fast",
              k === kind
                ? "border-border-accent bg-accent-cyan/10 text-accent-cyan"
                : "border-border-subtle text-fg-muted hover:border-border-strong hover:text-fg-primary",
            )}
          >
            {KIND_LABEL[k]}
            <span className="ml-1.5 text-fg-dim">{counts[k as keyof typeof counts]}</span>
          </button>
        ))}
      </div>

      {error && (
        <div className="border-b border-border-red bg-accent-red/5 px-4 py-2 text-caption text-accent-red">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-2 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : unified.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8 opacity-30" />}
          title="No filings match"
          body="Try widening the date range or clearing the ticker filter."
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {unified.slice(0, 200).map((f, i) => (
            <li key={`${f.kind}-${f.ticker}-${i}`}>
              <FilingRow filing={f} />
            </li>
          ))}
          {unified.length > 200 && (
            <li className="px-4 py-2 text-center text-micro text-fg-dim">
              showing 200 of {unified.length} — narrow the filter to see the rest
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

function DaysSelector({
  days,
  setDays,
}: {
  days: number;
  setDays: (n: number) => void;
}) {
  const opts = [3, 7, 14, 30] as const;
  return (
    <div className="flex items-center gap-1">
      {opts.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => setDays(d)}
          className={cn(
            "rounded-pill border px-2 py-0.5 text-micro uppercase tracking-wider transition-colors duration-fast",
            d === days
              ? "border-border-accent bg-accent-cyan/10 text-accent-cyan"
              : "border-border-subtle text-fg-muted hover:border-border-strong hover:text-fg-primary",
          )}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

function FilingRow({ filing }: { filing: UnifiedFiling }) {
  if (filing.kind === "8k") return <Filing8KRow row={filing.payload as Filing8K} />;
  if (filing.kind === "form4") return <Form4Row row={filing.payload as InsiderTrade} />;
  return <StakeRow row={filing.payload as StakeAlert} />;
}

function Filing8KRow({ row }: { row: Filing8K }) {
  const items = parseItemCodes(row.item_codes);
  return (
    <div className="flex items-start gap-3 px-4 py-3 transition-colors duration-fast hover:bg-bg-elevated/60">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent-cyan" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium text-fg-primary">{row.ticker}</span>
          <Pill tone="cyan" size="sm">8-K</Pill>
          <span className="text-micro text-fg-muted">
            {formatDateOnly(row.filing_date)} · {formatRelativeDays(row.filing_date)}
          </span>
        </div>
        {items.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {items.map((code) => (
              <Pill
                key={code}
                tone={(ITEM_8K_TONE[code] ?? "neutral") as Tone}
                size="sm"
              >
                {code} {ITEM_8K_LABEL[code] ?? "—"}
              </Pill>
            ))}
          </div>
        )}
        {row.summary && (
          <p className="mt-1.5 line-clamp-2 text-caption text-fg-muted">{row.summary}</p>
        )}
      </div>
      <a
        href={edgarTickerUrl(row.ticker, "8-K")}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-2 shrink-0 rounded-md border border-border-subtle px-2 py-1 text-micro uppercase tracking-wider text-fg-muted transition-colors duration-fast hover:border-border-strong hover:text-accent-cyan"
        aria-label="Open EDGAR"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function Form4Row({ row }: { row: InsiderTrade }) {
  const isPurchase = row.transaction_code === "P";
  const tone: Tone = isPurchase ? "green" : "red";
  const label = isPurchase ? "BUY" : row.transaction_code === "S" ? "SELL" : row.transaction_code;
  return (
    <div className="flex items-start gap-3 px-4 py-3 transition-colors duration-fast hover:bg-bg-elevated/60">
      <UserSquare2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-violet" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium text-fg-primary">{row.ticker}</span>
          <Pill tone="violet" size="sm">Form 4</Pill>
          <Pill tone={tone} size="sm">{label}</Pill>
          <span className="text-micro text-fg-muted">
            {formatDateOnly(row.filing_date)} · {formatRelativeDays(row.filing_date)}
          </span>
        </div>
        <div className="mt-1.5 text-caption text-fg-primary">
          <span className="text-fg-primary">{row.insider_name}</span>
          {row.insider_role && (
            <span className="ml-2 text-fg-muted">({row.insider_role})</span>
          )}
        </div>
        <div className="mt-0.5 text-micro text-fg-muted">
          {formatShares(row.shares)} shares
          {row.price != null && ` @ $${row.price.toFixed(2)}`}
          {row.value != null && ` = ${formatMoney(row.value)}`}
        </div>
      </div>
      <a
        href={edgarTickerUrl(row.ticker, "4")}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-2 shrink-0 rounded-md border border-border-subtle px-2 py-1 text-micro uppercase tracking-wider text-fg-muted transition-colors duration-fast hover:border-border-strong hover:text-accent-cyan"
        aria-label="Open EDGAR"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function StakeRow({ row }: { row: StakeAlert }) {
  const is13D = /13D/i.test(row.form_type);
  const tone: Tone = is13D ? "amber" : "cyan";
  return (
    <div className="flex items-start gap-3 px-4 py-3 transition-colors duration-fast hover:bg-bg-elevated/60">
      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-amber" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium text-fg-primary">{row.ticker}</span>
          <Pill tone={tone} size="sm">{is13D ? "13D activist" : "13G passive"}</Pill>
          <span className="text-micro text-fg-muted">
            {formatDateOnly(row.filing_date)} · {formatRelativeDays(row.filing_date)}
          </span>
        </div>
        <div className="mt-1.5 truncate text-caption text-fg-primary">{row.filer_name}</div>
        <div className="mt-0.5 text-micro text-fg-muted">
          {row.pct_ownership != null
            ? `${row.pct_ownership.toFixed(2)}% ownership`
            : "% n/a"}
          {row.shares != null && ` · ${formatShares(row.shares)} shares`}
        </div>
      </div>
      <a
        href={edgarTickerUrl(row.ticker, is13D ? "SC%2013D" : "SC%2013G")}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-2 shrink-0 rounded-md border border-border-subtle px-2 py-1 text-micro uppercase tracking-wider text-fg-muted transition-colors duration-fast hover:border-border-strong hover:text-accent-cyan"
        aria-label="Open EDGAR"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
