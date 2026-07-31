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
import { ChevronDown, Download, Newspaper, Trash2 } from "lucide-react";
import { DigestMarkdown } from "./digest-markdown";
import { DigestDownloadSheet } from "./digest-download-sheet";

// Activity feed [B7] — per-day nightly-digest cards. READ-ONLY except for the
// D2 delete control (below).
//
// The nightly digest is generated ON THE VM (B1-B6) and written to the
// `digest` table in the live trevor.db; litestream replicates it to the
// read-only replica this Hub READS.
//
// 🚨 D2 (2026-07-31) — THE ONE WRITE. Every read on this surface still comes
// from the read-only replica. The per-card delete is the sole exception: it
// calls DELETE /api/health/digests/<date>, which reaches the VM LIVE db (a
// replica write is refused outright and would silently revert on the next
// ~20-min tailsync). Authority: BEHAVIOR_RULES Rule 15 exception #2
// (Ghost-directed, 2026-07-31, D1) — `digest` only, bounded to one named
// digest_date. It NEVER GENERALIZES; do not add a second delete here.
//
// 🚨 THE DELETE IS HARD (Ghost's explicit choice — not a soft-hide) and the
// confirm is TWO-STEP by position, not just by count: the confirm bar renders
// BELOW the header and puts Cancel where the trash icon was, so a double-tap on
// the same spot lands on Cancel. Confirm is never under the first click.
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

/* ---------------------------------------------------------------- delete -- */

// 🚨 The UI owns its own copy, keyed on the route's structured `outcome`. The
// helper's `error` string is NEVER rendered — a helper string reaching
// user-facing copy is the F1 defect class, and this is the one surface where a
// misleading sentence could make someone believe data is gone when it is not.
// An unrecognised outcome falls through to the honest unknown-state sentence
// rather than to a reassuring default.
function deleteFailureCopy(outcome: string | undefined): string {
  switch (outcome) {
    case "not_found":
      return "That digest was already gone — nothing was deleted. The list will refresh.";
    case "refused_multi":
    case "refused_rowcount":
      return "Refused: the delete would not have matched exactly one digest, so it was rolled back. Nothing was deleted.";
    case "invalid_date":
      return "That date was rejected before it reached the database. Nothing was deleted.";
    case "vm_unreachable":
      return "Couldn't reach the live database, so nothing was deleted. The digest is still there — try again shortly.";
    default:
      return "The delete did not complete. Treat this digest as still present until the list refreshes and shows otherwise.";
  }
}

type DeletePhase = "idle" | "confirming" | "deleting" | "error";

interface DeleteState {
  phase: DeletePhase;
  outcome?: string;
}

// Shared frozen default so an un-touched card does not get a fresh object every
// render (which would defeat the effect's dependency check).
const IDLE_DELETE: DeleteState = { phase: "idle" };

/* ------------------------------------------------------------------ card -- */

function DigestCard({
  d,
  expanded,
  detail,
  del,
  onToggle,
  onDownload,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  d: DigestPreview;
  expanded: boolean;
  detail: DetailState | undefined;
  del: DeleteState;
  onToggle: () => void;
  onDownload: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  const meta = severityMeta(d.top_severity);
  const panelId = `digest-panel-${d.digest_date}`;
  const errors = d.errors_24h;

  const confirmId = `digest-confirm-${d.digest_date}`;
  const trashRef = React.useRef<HTMLButtonElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const confirming = del.phase === "confirming" || del.phase === "deleting";
  const busy = del.phase === "deleting";

  // Cancel takes focus when the confirm bar opens — the safe action is the
  // default for the keyboard exactly as it is for the pointer.
  React.useEffect(() => {
    if (del.phase === "confirming") cancelRef.current?.focus();
  }, [del.phase]);

  const cancel = React.useCallback(() => {
    onDeleteCancel();
    // Return focus to where the interaction started.
    trashRef.current?.focus();
  }, [onDeleteCancel]);

  return (
    <Card padding="md" className={cn("border-l-4", meta.border)}>
      {/* Header row — the toggle, download and delete controls are siblings,
          never nested (a button inside a button is invalid and breaks keyboard
          nav). */}
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
        {/* STEP 1. Deliberately gold-bordered, so it reads as destructive and
            cannot be mistaken for the cyan download control beside it. It only
            ever OPENS the confirm bar — this button never deletes anything. */}
        <button
          ref={trashRef}
          type="button"
          onClick={onDeleteRequest}
          disabled={confirming}
          aria-expanded={confirming}
          aria-controls={confirmId}
          aria-label={`Delete the ${d.digest_date} digest`}
          className="tap-target shrink-0 rounded-md border border-accent-gold/40 px-2 py-1.5 text-accent-gold transition-colors duration-fast hover:border-accent-gold hover:text-accent-gold-strong focus-visible:outline-2 focus-visible:outline-accent-gold/60 focus-visible:outline-offset-2 disabled:opacity-40"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>

      {/* STEP 2 — the confirm bar. Rendered BELOW the header, never over it, so
          the destructive button is not where the first click landed. Cancel sits
          on the RIGHT, under the trash icon: a double-tap in the same spot hits
          Cancel. Escape cancels. */}
      {confirming && (
        <div
          id={confirmId}
          role="group"
          aria-label={`Confirm deleting the ${d.digest_date} digest`}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) {
              e.stopPropagation();
              cancel();
            }
          }}
          className="mt-3 rounded-md border border-accent-gold/40 bg-accent-gold/5 p-3"
        >
          <p className="font-sans text-caption text-fg-primary">
            Delete the {fmtDate(d.digest_date)} digest?
          </p>
          <p className="mt-1 font-sans text-micro text-fg-muted">
            This removes it from the live database for good. It cannot be undone
            from here.
          </p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onDeleteConfirm}
              disabled={busy}
              className="tap-target rounded-md border border-accent-red/60 px-3 py-1.5 font-sans text-caption text-accent-red transition-colors duration-fast hover:border-accent-red hover:bg-accent-red/10 focus-visible:outline-2 focus-visible:outline-accent-red/60 focus-visible:outline-offset-2 disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </button>
            <button
              ref={cancelRef}
              type="button"
              onClick={cancel}
              disabled={busy}
              className="tap-target rounded-md border border-border-strong px-3 py-1.5 font-sans text-caption text-fg-primary transition-colors duration-fast hover:bg-bg-elevated focus-visible:outline-2 focus-visible:outline-accent-cyan/60 focus-visible:outline-offset-2 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* A failed delete is stated on the card, and the card STAYS. A card that
          vanishes on a delete that did not happen is the worst outcome here. */}
      {del.phase === "error" && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-accent-gold/40 bg-accent-gold/5 p-3 font-sans text-caption leading-relaxed text-accent-gold-strong"
        >
          {deleteFailureCopy(del.outcome)}
        </p>
      )}

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
  // 🚨 F1: a BOOLEAN, not the error text. This held `json.error` / `String(err)`
  // and the panel printed it verbatim. Fixing only the renderer would have left
  // the raw string in state for the next consumer to pick up — the failure mode
  // C2 already hit once — so the writer never stores it in the first place.
  const [fetchFailed, setFetchFailed] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<Record<string, DetailState>>({});
  const [sheetDate, setSheetDate] = React.useState<string | null>(null);
  // Keyed by digest_date. Holds the route's structured `outcome`, never a
  // message — the copy is chosen at render time by deleteFailureCopy().
  const [deletes, setDeletes] = React.useState<Record<string, DeleteState>>({});
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
        setFetchFailed(Boolean(json.error));
      } catch (err) {
        if (!alive) return;
        setFetchFailed(true);
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

  /* ---------------------------------------------------------------- delete -- */

  // 🚨 Only ONE card may be in a confirm/deleting state at a time. Opening a
  // second confirm closes the first, so there is never an armed delete sitting
  // off-screen waiting for a stray Enter.
  const requestDelete = React.useCallback((date: string) => {
    setDeletes({ [date]: { phase: "confirming" } });
  }, []);

  const cancelDelete = React.useCallback((date: string) => {
    setDeletes((prev) => {
      if (prev[date]?.phase === "deleting") return prev; // in flight — not cancellable
      const next = { ...prev };
      delete next[date];
      return next;
    });
  }, []);

  const confirmDelete = React.useCallback(async (date: string) => {
    setDeletes({ [date]: { phase: "deleting" } });
    try {
      const res = await fetch(
        `/api/health/digests/${encodeURIComponent(date)}`,
        { method: "DELETE", cache: "no-store" },
      );
      let outcome: string | undefined;
      try {
        const j = (await res.json()) as { outcome?: string };
        outcome = typeof j?.outcome === "string" ? j.outcome : undefined;
      } catch {
        outcome = undefined;
      }

      // 🚨 SUCCESS IS NARROW ON PURPOSE: HTTP 200 *and* outcome==="deleted".
      // Anything else — including a 200 whose body we could not read — keeps the
      // card and shows an error. Never remove a card on an unconfirmed delete.
      if (res.ok && outcome === "deleted") {
        setData((prev) =>
          prev
            ? {
                ...prev,
                digests: (prev.digests ?? []).filter(
                  (x) => x.digest_date !== date,
                ),
                total: Math.max(0, (prev.total ?? 1) - 1),
                returned: Math.max(0, (prev.returned ?? 1) - 1),
              }
            : prev,
        );
        setExpanded((cur) => (cur === date ? null : cur));
        setDeletes({});
        return;
      }
      setDeletes({ [date]: { phase: "error", outcome } });
    } catch {
      // Transport failure — the delete may or may not have landed. Say exactly
      // that (the default copy branch) rather than guessing either way.
      setDeletes({ [date]: { phase: "error", outcome: undefined } });
    }
  }, []);

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
  if (fetchFailed) {
    return (
      <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
        <Card padding="md" className="border-l-4 border-l-accent-gold">
          <Header />
          <p className="text-caption leading-relaxed text-fg-muted">
            The digest feed could not be read. Showing nothing rather than a
            stale or partial list; it retries automatically.
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
            del={deletes[d.digest_date] ?? IDLE_DELETE}
            onToggle={() => toggle(d.digest_date)}
            onDownload={() => openDownload(d.digest_date)}
            onDeleteRequest={() => requestDelete(d.digest_date)}
            onDeleteConfirm={() => void confirmDelete(d.digest_date)}
            onDeleteCancel={() => cancelDelete(d.digest_date)}
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
