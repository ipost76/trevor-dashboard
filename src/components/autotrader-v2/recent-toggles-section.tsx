"use client";
import * as React from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  EmptyState,
  Skeleton,
  ActivityRow,
} from "@/components/ui";
import { History, ArrowRight } from "lucide-react";

interface ActivityEntry {
  id: number;
  timestamp: string;
  table_name: string;
  row_id: number | null;
  key: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: string;
  source_type: string;
  session_id: string | null;
  prompt_id: string | null;
  notes: string | null;
}

interface ActivityResponse {
  entries: ActivityEntry[];
  total: number;
  returned: number;
  limit: number;
  offset: number;
  error?: string;
}

const POLL_MS = 30_000;
const FETCH_LIMIT = 50;
const RENDER_LIMIT = 10;

function isBoolFlip(entry: ActivityEntry): boolean {
  const nv = (entry.new_value ?? "").trim().toLowerCase();
  const ov = (entry.old_value ?? "").trim().toLowerCase();
  return (
    nv === "true" || nv === "false" || ov === "true" || ov === "false"
  );
}

export function RecentTogglesSection() {
  const [entries, setEntries] = React.useState<ActivityEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const fetchActivity = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/auto/activity?limit=${FETCH_LIMIT}&table_name=auto_config`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as ActivityResponse;
      if (data.error) {
        setError(data.error);
        return;
      }
      const toggleFlips = (data.entries || [])
        .filter(isBoolFlip)
        .slice(0, RENDER_LIMIT);
      setEntries(toggleFlips);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchActivity();
    const id = setInterval(() => void fetchActivity(), POLL_MS);
    return () => clearInterval(id);
  }, [fetchActivity]);

  if (loading && entries.length === 0) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <Card padding="md" className="card-elevated">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History size={16} className="text-fg-muted" aria-hidden />
            <CardTitle>Recent Toggle Changes</CardTitle>
          </div>
          <Pill intent="blue-chip" size="sm">
            {entries.length} shown
          </Pill>
        </div>
      </CardHeader>

      {error && (
        <div className="mb-3 rounded-md border border-accent-red/40 bg-accent-red/10 p-3 font-sans text-caption text-accent-red">
          Activity load failed: {error}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<History size={28} />}
          title="No toggle changes"
          body="No boolean flips recorded in change_log yet."
        />
      ) : (
        <div className="-mx-3">
          {entries.map((entry) => (
            <ActivityRow
              key={entry.id}
              timestamp={entry.timestamp}
              keyName={entry.key ?? "(unknown)"}
              oldValue={entry.old_value}
              newValue={entry.new_value ?? ""}
              actor={entry.actor}
              sourceType={entry.source_type}
              promptId={entry.prompt_id ?? undefined}
              notes={entry.notes ?? undefined}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Link
          href="/autotrader?tab=activity"
          className="inline-flex items-center gap-1 font-sans text-caption text-accent-cyan-soft hover:text-accent-cyan-soft-strong"
        >
          View all activity
          <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
    </Card>
  );
}
