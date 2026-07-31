"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  MetricTile,
  Pill,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { ChevronDown, Download, Newspaper } from "lucide-react";
import { DigestMarkdown } from "./digest-markdown";
import { DigestDownloadSheet } from "./digest-download-sheet";

// Activity feed [B7] — READ-ONLY per-day nightly-digest cards.
//
// The nightly digest is generated ON THE VM (B1-B6) and written to the
// `digest` table in the live trevor.db; litestream replicates it to the
// read-only replica this Hub reads. Nothing here writes anything, anywhere.
//
// One card per digest_date, newest first. The card face is the flat preview
// columns (no JSON parsing); expanding a card fetches body_md and renders it
// inline. Each digest can be downloaded as .md or printed to PDF.
//
// 🚨 UNKNOWN IS RENDERED HONESTLY. The digest builder deliberately nulls any
// value it could not verify (B4) — an unreconciled equity delta, for example.
// A null renders as "UNKNOWN", never as 0 and never as a dash that reads like
// a real zero. The feed must not assert what the bot refused to assert.
//
// States: loading skeleton · error (loud, not blank) · empty ("no digests
// yet") · table-absent (replica mid-restore) · populated.

const LIST_ENDPOINT = "/api/health/digests";
// The digest lands once a night, so this poll exists only so a freshly
// replicated digest appears without a manual reload — not for liveness.
const POLL_MS = 300_000;
// Replica lag budget (CLAUDE.md: cite the bound, not the lucky sample).
const REPLICA_STALE_MINUTES = 30;

interface DigestPreview {
  digest_date: string;
  generated_at?: string | null;
  headline_pnl_usd?: number | null;
  equity_usd?: number | null;
  equity_delta_1d?: number | null;
  trades_closed_24h?: number | null;
  commits_24h?: number | null;
  errors_24h?: number | null;
  config_changes_24h?: number | null;
  top_severity?: string | null;
  level?: number | null;
  prior_digest_age_h?: number | null;
  schema_version?: number | null;
}

interface DigestListResponse {
  digests?: DigestPreview[];
  total?: number;
  returned?: number;
  limit?: number;
  table_present?: boolean;
  replica_age_seconds?: number | null;
  replica_mtime?: string | null;
  error?: string;
}

interface DigestDetail {
  found?: boolean;
  body_md?: string | null;
  generated_at?: string | null;
  error?: string;
}

type DetailState =
  | { phase: "loading" }
  | { phase: "ready"; body: string }
  | { phase: "error"; message: string };

/* ------------------------------------------------------------- severity -- */

const SEVERITY_META: Record<
  string,
  { border: string; pill: React.ReactNode }
> = {
  alert: {
    border: "border-l-accent-red",
    pill: (
      <Pill intent="error" size="sm">
        ALERT
      </Pill>
    ),
  },
  warn: {
    border: "border-l-accent-gold",
    pill: (
      <Pill intent="warn" size="sm">
        WARN
      </Pill>
    ),
  },
  clean: {
    border: "border-l-accent-mint",
    pill: (
      <Pill intent="live" size="sm">
        CLEAN
      </Pill>
    ),
  },
};

// An absent/unrecognised severity is NOT quietly treated as clean — a missing
// severity is unknown, and a false green is the one thing a health surface
// must never show.
const SEVERITY_UNKNOWN = {
  border: "border-l-border-subtle",
  pill: (
    <Pill tone="neutral" size="sm">
      UNKNOWN
    </Pill>
  ),
};

function severityMeta(sev: string | null | undefined) {
  if (!sev) return SEVERITY_UNKNOWN;
  return SEVERITY_META[sev.toLowerCase()] ?? SEVERITY_UNKNOWN;
}

/* ------------------------------------------------------------ formatting -- */

/** The one place a missing value is rendered. Never a number, never a zero. */
const Unknown = ({ title }: { title?: string }) => (
  <span
    className="font-mono text-fg-dim"
    title={title ?? "Not reported by this digest"}
  >
    UNKNOWN
  </span>
);

function money(v: number): string {
  const sign = v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function moneySigned(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

/** Render a nullable number, or UNKNOWN. Null NEVER becomes 0. */
function orUnknown(
  v: number | null | undefined,
  render: (n: number) => React.ReactNode,
): React.ReactNode {
  if (v === null || v === undefined || Number.isNaN(v)) return <Unknown />;
  return render(v);
}

function fmtDate(iso: string): string {
  // digest_date is a plain YYYY-MM-DD calendar label (ET) — parsed as UTC and
  // formatted in UTC so it can never shift a day in the local timezone.
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function replicaLabel(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  const mins = Math.round(seconds / 60);
  return mins < 1 ? "REPLICA <1m" : `REPLICA ~${mins}m`;
}

/* ------------------------------------------------------------------ card -- */

function DigestCard({
  d,
  expanded,
  detail,
  onToggle,
  onDownload,
}: {
  d: DigestPreview;
  expanded: boolean;
  detail: DetailState | undefined;
  onToggle: () => void;
  onDownload: () => void;
}) {
  const meta = severityMeta(d.top_severity);
  const panelId = `digest-panel-${d.digest_date}`;
  const errors = d.errors_24h;

  return (
    <Card padding="md" className={cn("border-l-4", meta.border)}>
      {/* Header row — the toggle and the download control are siblings, never
          nested (a button inside a button is invalid and breaks keyboard nav). */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="tap-target flex flex-1 items-center justify-between gap-2 rounded-md text-left transition-colors duration-fast hover:bg-bg-elevated/40 focus-visible:outline-2 focus-visible:outline-accent-cyan/60 focus-visible:outline-offset-2"
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-sans text-h3 text-fg-primary">
              {fmtDate(d.digest_date)}
            </span>
            {meta.pill}
          </span>
          <ChevronDown
            size={16}
            aria-hidden
            className={cn(
              "shrink-0 text-fg-muted transition-transform duration-fast",
              expanded && "rotate-180",
            )}
          />
        </button>
        <button
          type="button"
          onClick={onDownload}
          aria-label={`Download the ${d.digest_date} digest`}
          className="tap-target shrink-0 rounded-md border border-border-subtle px-2 py-1.5 text-fg-muted transition-colors duration-fast hover:border-border-strong hover:text-accent-cyan-soft focus-visible:outline-2 focus-visible:outline-accent-cyan/60 focus-visible:outline-offset-2"
        >
          <Download size={14} aria-hidden />
        </button>
      </div>

      {/* Preview metrics — straight from the flat card columns, no JSON parse. */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile
          label="HEADLINE P&L"
          size="sm"
          tone={
            d.headline_pnl_usd == null
              ? "neutral"
              : d.headline_pnl_usd > 0
                ? "positive"
                : d.headline_pnl_usd < 0
                  ? "negative"
                  : "neutral"
          }
          value={orUnknown(d.headline_pnl_usd, (n) => moneySigned(n))}
          sub="24h realized"
        />
        <MetricTile
          label="EQUITY"
          size="sm"
          value={orUnknown(d.equity_usd, (n) => money(n))}
          sub={
            d.equity_delta_1d == null ? (
              <span className="text-fg-dim">&Delta;24h UNKNOWN</span>
            ) : (
              `Δ 24h ${moneySigned(d.equity_delta_1d)}`
            )
          }
        />
        <MetricTile
          label="TRADES"
          size="sm"
          value={orUnknown(d.trades_closed_24h, (n) => n)}
          sub="closed 24h"
        />
        <MetricTile
          label="COMMITS"
          size="sm"
          value={orUnknown(d.commits_24h, (n) => n)}
          sub="24h"
        />
        <MetricTile
          label="ERRORS"
          size="sm"
          tone={errors == null ? "neutral" : errors > 0 ? "negative" : "neutral"}
          value={orUnknown(errors, (n) => n)}
          sub="24h"
        />
      </div>

      {/* Footer line — secondary facts, still UNKNOWN-honest. */}
      <p className="mt-2 font-sans text-micro text-fg-muted">
        {d.config_changes_24h == null
          ? "config changes UNKNOWN"
          : `${d.config_changes_24h} config change${d.config_changes_24h === 1 ? "" : "s"}`}
        {" · "}
        {d.level == null ? "level UNKNOWN" : `level ${d.level}`}
        {d.generated_at ? ` · generated ${d.generated_at}` : " · generated UNKNOWN"}
      </p>

      {/* Expanded full digest — inline, never a navigation away. */}
      <div id={panelId} role="region" hidden={!expanded}>
        {expanded && (
          <div className="mt-4 border-t border-border-subtle pt-3">
            {!detail || detail.phase === "loading" ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : detail.phase === "error" ? (
              <p className="text-caption leading-relaxed text-accent-gold-strong">
                Couldn&apos;t load this summary. Showing nothing rather than a
                partial document; try again shortly.
              </p>
            ) : (
              <DigestMarkdown source={detail.body} />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- section -- */

export function ActivityFeedSection() {
  const [data, setData] = React.useState<DigestListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<Record<string, DetailState>>({});
  const [sheetDate, setSheetDate] = React.useState<string | null>(null);
  // Print source. Deliberately NOT the expanded card's DOM: a user can hit
  // Download on a collapsed card, so the printable copy is rendered off-screen
  // for whichever digest the sheet is open on, independent of expansion.
  const printRef = React.useRef<HTMLDivElement | null>(null);

  const getPrintNode = React.useCallback(() => printRef.current, []);

  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(LIST_ENDPOINT, { cache: "no-store" });
        const json = (await res.json()) as DigestListResponse;
        if (!alive) return;
        setData(json);
        setFetchError(json.error ?? null);
      } catch (err) {
        if (!alive) return;
        setFetchError(String(err));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const loadDetail = React.useCallback(
    async (date: string) => {
      setDetails((prev) =>
        prev[date]?.phase === "ready" ? prev : { ...prev, [date]: { phase: "loading" } },
      );
      try {
        const res = await fetch(`/api/health/digests/${encodeURIComponent(date)}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as DigestDetail;
        if (json.error) throw new Error(json.error);
        if (!json.found || !json.body_md) throw new Error("no document returned");
        setDetails((prev) => ({
          ...prev,
          [date]: { phase: "ready", body: json.body_md as string },
        }));
      } catch (err) {
        setDetails((prev) => ({
          ...prev,
          [date]: { phase: "error", message: String(err) },
        }));
      }
    },
    [],
  );

  const toggle = React.useCallback(
    (date: string) => {
      setExpanded((cur) => {
        if (cur === date) return null;
        if (details[date]?.phase !== "ready") void loadDetail(date);
        return date;
      });
    },
    [details, loadDetail],
  );

  const openDownload = React.useCallback(
    (date: string) => {
      setSheetDate(date);
      // The PDF path prints the rendered document, so make sure it is fetched
      // even when the card was never expanded.
      if (details[date]?.phase !== "ready") void loadDetail(date);
    },
    [details, loadDetail],
  );

  const digests = data?.digests ?? [];
  const sheetDetail = sheetDate ? details[sheetDate] : undefined;
  const printReady = sheetDetail?.phase === "ready";
  const replica = replicaLabel(data?.replica_age_seconds);
  const replicaStale =
    data?.replica_age_seconds != null &&
    data.replica_age_seconds > REPLICA_STALE_MINUTES * 60;

  const Header = () => (
    <CardHeader>
      <CardTitle className="flex items-center gap-2 uppercase tracking-wider">
        <Newspaper size={13} aria-hidden />
        Nightly digest
      </CardTitle>
      {replica && (
        <span
          className={cn(
            "shrink-0 font-mono text-micro",
            replicaStale ? "text-accent-gold" : "text-fg-faint",
          )}
        >
          {replica}
        </span>
      )}
    </CardHeader>
  );

  if (loading) {
    return (
      <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
        <Card padding="md">
          <Header />
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  // A read failure is stated plainly. It is never rendered as "no digests" —
  // "the read broke" and "there is nothing to show" are different facts.
  if (fetchError) {
    return (
      <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
        <Card padding="md" className="border-l-4 border-l-accent-gold">
          <Header />
          <p className="text-caption leading-relaxed text-fg-muted">
            The digest feed could not be read &mdash; {fetchError}. Showing
            nothing rather than a stale or partial list; it retries
            automatically.
          </p>
        </Card>
      </div>
    );
  }

  if (digests.length === 0) {
    return (
      <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
        <Card padding="md">
          <Header />
          <EmptyState
            icon={<Newspaper size={28} aria-hidden />}
            title="No digests yet"
            body={
              data?.table_present === false
                ? "The digest table hasn't reached this replica yet. The first nightly digest runs at 05:30 ET — it will appear here once it has replicated across."
                : "The first nightly digest runs at 05:30 ET. When it lands, every day since will be listed here, newest first."
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md">
        <Header />
        <p className="font-sans text-caption text-fg-muted">
          One card per night, newest first. Tap a day to read the full digest;
          use the download control for Markdown or PDF.
        </p>
      </Card>

      <div className="space-y-3">
        {digests.map((d) => (
          <DigestCard
            key={d.digest_date}
            d={d}
            expanded={expanded === d.digest_date}
            detail={details[d.digest_date]}
            onToggle={() => toggle(d.digest_date)}
            onDownload={() => openDownload(d.digest_date)}
          />
        ))}
      </div>

      {data?.total != null && data.total > digests.length && (
        <p className="px-1 font-sans text-micro text-fg-muted">
          Showing the {digests.length} most recent of {data.total} digests.
        </p>
      )}

      {/* Off-screen printable copy for the digest the download sheet is open
          on. `hidden` keeps it out of the a11y tree and the visual flow while
          leaving innerHTML intact for the print clone. */}
      <div hidden ref={printRef}>
        {sheetDetail?.phase === "ready" && (
          <DigestMarkdown source={sheetDetail.body} />
        )}
      </div>

      <DigestDownloadSheet
        open={sheetDate !== null}
        onClose={() => setSheetDate(null)}
        date={sheetDate}
        getPrintNode={getPrintNode}
        printReady={printReady}
      />
    </div>
  );
}
