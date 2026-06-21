"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  EmptyState,
  Skeleton,
  HapticButton,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { Sparkles, Play, Download } from "lucide-react";

// B4 AI engine (Hub read-side) — AI findings panel on the Health home (default tab).
//
// Reads /api/health/ai-findings (findings WHERE status != 'resolved') and renders
// each finding as a card. The "Analyze now" button POSTs to the same endpoint →
// set_ai_command.py → enqueues a 'pending' row on the VM LIVE ai_engine_commands
// queue. READ + one write surface; the engine is capped until 2026-07-01, so the
// list is EMPTY today and Analyze-now just queues — this NEVER errors on empty.

const ENDPOINT = "/api/health/ai-findings";
const POLL_MS = 60_000;

interface AiFinding {
  id: number;
  created_at: string;
  trigger_type: string | null;
  severity: string | null;
  category: string | null;
  title: string | null;
  summary: string | null;
  root_cause: string | null;
  recommendation: string | null;
  confidence: number | null;
  status: string | null;
  model_used: string | null;
  cost_usd: number | null;
  tokens_used: number | null;
  recon_md_filename: string | null;
  has_recon: boolean;
}
interface FindingsShape {
  findings?: AiFinding[];
  replica_age_seconds?: number | null;
  error?: string | null;
}

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const norm = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(" ", "T") + "Z";
  const t = Date.parse(norm);
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function severityPill(sev: string | null): React.ReactNode {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical" || s === "error")
    return <Pill intent="error" size="sm">{s.toUpperCase()}</Pill>;
  if (s === "warn" || s === "warning")
    return <Pill intent="warn" size="sm">{s.toUpperCase()}</Pill>;
  return <Pill tone="neutral" size="sm">{(sev ?? "info").toUpperCase()}</Pill>;
}

function sevBorder(sev: string | null): string {
  const s = (sev ?? "").toLowerCase();
  if (s === "critical" || s === "error") return "border-l-accent-red";
  if (s === "warn" || s === "warning") return "border-l-accent-gold";
  return "border-l-border-subtle";
}

export function AiFindingsPanel() {
  const [findings, setFindings] = React.useState<AiFinding[] | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [toast, setToast] = React.useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(ENDPOINT, { cache: "no-store", signal });
      if (res.ok) {
        const data = (await res.json()) as FindingsShape;
        setFindings(data.findings ?? []);
      } else {
        setFindings([]);
      }
    } catch {
      // aborted or network — leave prior state, just mark loaded
      setFindings((prev) => prev ?? []);
    } finally {
      setLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [load]);

  const analyzeNow = React.useCallback(async () => {
    if (analyzing) return;
    setAnalyzing(true);
    setToast(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "analyze_now" }),
      });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: number; error?: string };
      if (res.ok && out.ok) {
        setToast({ kind: "ok", msg: `Queued analysis #${out.id ?? "?"} — engine runs it when uncapped.` });
        void load();
      } else {
        setToast({ kind: "err", msg: out.error ?? `Failed (HTTP ${res.status})` });
      }
    } catch (e) {
      setToast({ kind: "err", msg: String(e) });
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, load]);

  const list = findings ?? [];

  return (
    <Card padding="md" className="border-l-4 border-l-accent-cyan-soft">
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2 uppercase tracking-wider">
            <Sparkles size={14} aria-hidden />
            AI Analysis
          </span>
        </CardTitle>
        <HapticButton
          variant="primary"
          size="sm"
          onClick={analyzeNow}
          disabled={analyzing}
          aria-label="Enqueue an AI analysis now"
        >
          <Play size={12} aria-hidden />
          {analyzing ? "Queuing…" : "Analyze now"}
        </HapticButton>
      </CardHeader>

      {toast && (
        <div
          className={cn(
            "mb-3 rounded-md border px-3 py-2 text-caption",
            toast.kind === "ok"
              ? "border-accent-mint/40 text-accent-mint"
              : "border-accent-red/40 text-accent-red",
          )}
        >
          {toast.msg}
        </div>
      )}

      {!loaded && <Skeleton className="h-20 w-full" />}

      {loaded && list.length === 0 && (
        <EmptyState
          icon={<Sparkles size={28} />}
          title="No active findings"
          body="The AI Analysis Engine surfaces triaged findings here. The engine is capped until 2026-07-01 — “Analyze now” queues a run; findings appear once it processes them."
        />
      )}

      {loaded && list.length > 0 && (
        <div className="flex flex-col gap-2">
          {list.map((f) => (
            <div
              key={f.id}
              className={cn(
                "rounded-md border border-border-subtle border-l-4 bg-bg-elevated/40 p-3",
                sevBorder(f.severity),
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                {severityPill(f.severity)}
                {f.category && (
                  <Pill tone="neutral" size="sm">
                    {f.category}
                  </Pill>
                )}
                <span className="font-sans text-body font-semibold text-fg-primary">
                  {f.title ?? "Untitled finding"}
                </span>
              </div>
              {f.summary && (
                <p className="mt-1.5 text-caption text-fg-muted">{f.summary}</p>
              )}
              {f.recommendation && (
                <p className="mt-1 text-caption text-fg-primary">
                  <span className="text-fg-muted">→ </span>
                  {f.recommendation}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro text-fg-muted">
                {f.model_used && <span>{f.model_used}</span>}
                {f.confidence != null && <span>conf {Math.round(f.confidence * 100)}%</span>}
                {f.cost_usd != null && <span>${f.cost_usd.toFixed(4)}</span>}
                <span>{fmtAge(f.created_at)}</span>
                {f.has_recon && (
                  <a
                    href={`${ENDPOINT}/${f.id}/recon`}
                    className="inline-flex items-center gap-1 text-accent-cyan-soft hover:text-accent-cyan-soft-strong"
                  >
                    <Download size={11} aria-hidden />
                    recon
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
