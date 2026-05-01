"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, Pill, EmptyState, Skeleton } from "@/components/ui";
import { Database } from "lucide-react";

interface Entry {
  id: string;
  ts: string | null;
  tag: string | null;
  content: string;
  size_bytes: number;
}
interface ListResponse {
  entries: ReadonlyArray<Entry>;
  total: number;
  data_available: boolean;
  filter: string;
  error?: string;
}

const PREVIEW_CHARS = 600;

export function MemorySection() {
  const [q, setQ] = React.useState("");
  const [pendingQ, setPendingQ] = React.useState("");
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const id = setTimeout(() => setQ(pendingQ.trim()), 350);
    return () => clearTimeout(id);
  }, [pendingQ]);

  React.useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const url = q
          ? `/api/memory/journal?limit=50&q=${encodeURIComponent(q)}`
          : "/api/memory/journal?limit=50";
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) setData((await res.json()) as ListResponse);
      } finally {
        setLoading(false);
      }
    };
    void fetchData();
  }, [q]);

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Database size={14} />
              MEMORY JOURNAL
            </span>
          </CardTitle>
          {data && <Pill tone="cyan" size="sm">{data.total} entries</Pill>}
        </CardHeader>
        <input
          type="text"
          value={pendingQ}
          onChange={(e) => setPendingQ(e.target.value)}
          placeholder="Search daily checkpoints…"
          className="w-full rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-caption text-fg-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-cyan/60"
        />
        <div className="mt-2 text-micro text-fg-muted">
          Source: <code>brain/memory/*.md</code> daily session checkpoints (read-only).
        </div>
      </Card>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      )}

      {!loading && data?.error && <EmptyState title="Failed to load" body={data.error} />}

      {!loading && data && !data.data_available && (
        <EmptyState
          title={q ? "No matches" : "No memory entries"}
          body={q ? `Nothing matching "${q}".` : "No daily checkpoints found in brain/memory/."}
        />
      )}

      {!loading && data && data.data_available && data.entries.length > 0 && (
        <ul className="space-y-2">
          {data.entries.map((e) => {
            const isOpen = !!expanded[e.id];
            const truncated = e.content.length > PREVIEW_CHARS && !isOpen;
            const body = truncated ? e.content.slice(0, PREVIEW_CHARS) : e.content;
            return (
              <li key={e.id}>
                <Card padding="md" className="space-y-2">
                  <div className="flex items-center gap-2 text-micro text-fg-muted">
                    <Pill tone="violet" size="sm">{e.id}</Pill>
                    {e.tag && <Pill tone="cyan" size="sm">{e.tag}</Pill>}
                    {e.ts && <span>{e.ts}</span>}
                    <span className="ml-auto">{(e.size_bytes / 1024).toFixed(1)}KB</span>
                  </div>
                  <pre className="text-caption text-fg-primary whitespace-pre-wrap break-words font-mono">
                    {body}{truncated ? "…" : ""}
                  </pre>
                  {e.content.length > PREVIEW_CHARS && (
                    <button
                      type="button"
                      onClick={() => toggle(e.id)}
                      className="text-micro text-accent-cyan hover:underline tap-target"
                    >
                      {isOpen ? "Collapse" : "Expand full"}
                    </button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
