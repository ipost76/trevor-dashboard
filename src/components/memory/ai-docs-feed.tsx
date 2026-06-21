"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  EmptyState,
  Skeleton,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { FileText, Download } from "lucide-react";

// B4 AI engine (Hub read-side) — AI Docs feed (Health zone "docs" sub-tab).
//
// A document feed of AI-engine recon write-ups. Reads /api/health/ai-findings and
// shows the findings that carry a recon doc (has_recon); each links to
// /api/health/ai-findings/[id]/recon to download the inline recon_md.
//
// ⚠️ DISTINCT from the bottom-nav DOCS zone: different zone, route, and storage —
// this reads ai_findings.recon_md, NOT the downloads file system. No shared
// module, route, or storage with the downloads surface.
//
// EMPTY until the engine produces a finding with a recon doc (capped until
// 2026-07-01) — renders a clean EmptyState, never errors.

const ENDPOINT = "/api/health/ai-findings";
const POLL_MS = 60_000;

interface AiFinding {
  id: number;
  created_at: string;
  category: string | null;
  severity: string | null;
  title: string | null;
  summary: string | null;
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

export function AiDocsFeed() {
  const [docs, setDocs] = React.useState<AiFinding[] | null>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(ENDPOINT, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = (await res.json()) as FindingsShape;
          setDocs((data.findings ?? []).filter((f) => f.has_recon));
        } else if (!cancelled) {
          setDocs([]);
        }
      } catch {
        if (!cancelled) setDocs([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void run();
    const id = setInterval(() => void run(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const list = docs ?? [];

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2 uppercase tracking-wider">
              <FileText size={14} aria-hidden />
              AI Recon Docs
            </span>
          </CardTitle>
          {list.length > 0 && (
            <Pill tone="neutral" size="sm">
              {list.length}
            </Pill>
          )}
        </CardHeader>

        {!loaded && <Skeleton className="h-20 w-full" />}

        {loaded && list.length === 0 && (
          <EmptyState
            icon={<FileText size={28} />}
            title="No recon documents yet"
            body="Deep-dive recon write-ups produced by the AI Analysis Engine appear here as downloadable docs. The engine is capped until 2026-07-01."
          />
        )}

        {loaded && list.length > 0 && (
          <div className="flex flex-col gap-2">
            {list.map((d) => (
              <a
                key={d.id}
                href={`${ENDPOINT}/${d.id}/recon`}
                className={cn(
                  "group flex items-center gap-3 rounded-md border border-border-subtle",
                  "bg-bg-elevated/40 p-3 transition-colors hover:border-accent-cyan-soft/50",
                )}
              >
                <FileText
                  size={18}
                  className="shrink-0 text-accent-cyan-soft"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-sans text-body font-semibold text-fg-primary">
                    {d.title ?? d.recon_md_filename ?? `Finding #${d.id}`}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-micro text-fg-muted">
                    {d.category && <span>{d.category}</span>}
                    {d.recon_md_filename && <span>{d.recon_md_filename}</span>}
                    <span>{fmtAge(d.created_at)}</span>
                  </div>
                </div>
                <Download
                  size={15}
                  className="shrink-0 text-fg-muted group-hover:text-accent-cyan-soft"
                  aria-hidden
                />
              </a>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
