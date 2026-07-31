"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  FilterChips,
  ActivityRow,
  EmptyState,
  Skeleton,
} from "@/components/ui";
import { Activity } from "lucide-react";

interface ActivityEntry {
  id: string;
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
  returned?: number;
  limit?: number;
  offset?: number;
  error?: string;
}

const PAGE_SIZE = 50;

// Display label → API source_type value (from audit_logger.py SOURCE_TYPES enum).
// Empty value = no filter param sent.
const SOURCE_FILTER_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "All", value: "" },
  { label: "UI", value: "UI" },
  { label: "Discord", value: "Discord" },
  { label: "Autonomous", value: "Autonomous" },
  { label: "CC Prompt", value: "API" },
  { label: "CLI-Script", value: "CLI-Script" },
];
const CHIP_LABELS: ReadonlyArray<string> = SOURCE_FILTER_OPTIONS.map((o) => o.label);

function labelToValue(label: string): string {
  return SOURCE_FILTER_OPTIONS.find((o) => o.label === label)?.value ?? "";
}

export function ActivityTab() {
  const [entries, setEntries] = React.useState<ActivityEntry[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [initialLoad, setInitialLoad] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [chipLabel, setChipLabel] = React.useState<string>("All");

  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const loadingRef = React.useRef(false);

  const sourceValue = labelToValue(chipLabel);
  const hasMore = entries.length < total;
  const filterActive = chipLabel !== "All";

  // Reset + first-page fetch on filter change (and on mount).
  React.useEffect(() => {
    let cancelled = false;
    setEntries([]);
    setTotal(0);
    setInitialLoad(true);
    setError(null);
    loadingRef.current = true;
    setLoading(true);

    (async () => {
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: "0",
        });
        if (sourceValue) params.set("source_type", sourceValue);
        const res = await fetch(`/api/auto/activity?${params.toString()}`, {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          setError("Couldn't load the activity log. Retrying.");
          return;
        }
        const j = (await res.json()) as ActivityResponse;
        if (cancelled) return;
        if (j.error) setError(j.error);
        setEntries(j.entries ?? []);
        setTotal(j.total ?? 0);
      } catch {
        // Network-down branch — same sentence as the bad-status branch above.
        if (!cancelled) setError("Couldn't load the activity log. Retrying.");
      } finally {
        if (!cancelled) {
          loadingRef.current = false;
          setLoading(false);
          setInitialLoad(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceValue]);

  // Append-mode loader (called by IntersectionObserver).
  const loadMore = React.useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(entries.length),
      });
      if (sourceValue) params.set("source_type", sourceValue);
      const res = await fetch(`/api/auto/activity?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Couldn't load more activity. Retrying.");
        return;
      }
      const j = (await res.json()) as ActivityResponse;
      if (j.error) setError(j.error);
      const fresh = j.entries ?? [];
      setTotal(j.total ?? 0);
      setEntries((prev) => [...prev, ...fresh]);
      // Defensive: API claimed more rows but returned none → force-stop.
      if (fresh.length === 0) setTotal((t) => Math.min(t, entries.length));
    } catch {
      // Network-down branch — same sentence as the bad-status branch above.
      setError("Couldn't load more activity. Retrying.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [entries.length, sourceValue]);

  // IntersectionObserver: sentinel-at-bottom → loadMore.
  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (initialLoad || loading || !hasMore) return;

    const observer = new IntersectionObserver(
      (obs) => {
        if (obs[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, initialLoad, loadMore]);

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <FilterChips
        options={CHIP_LABELS}
        selected={chipLabel}
        onChange={setChipLabel}
        ariaLabel="Filter activity by source"
      />

      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2 uppercase tracking-wider">
              <Activity size={14} aria-hidden />
              Activity Log
              {total > 0 && (
                <span className="ml-1 font-mono text-micro text-fg-muted tabular-nums">
                  {entries.length}/{total}
                </span>
              )}
            </span>
          </CardTitle>
        </CardHeader>

        {error && (
          <div className="mb-3 rounded-md border border-accent-red/40 bg-accent-red/5 px-3 py-2 font-sans text-caption text-accent-red">
            {error}
          </div>
        )}

        {initialLoad && <Skeleton className="h-32 w-full" />}

        {!initialLoad && entries.length === 0 && !error && (
          <EmptyState
            title={
              filterActive
                ? `No ${chipLabel} activity found`
                : "No activity recorded yet"
            }
            body={
              filterActive
                ? "Try a different source filter."
                : "Changes will appear here once you edit configs or toggles."
            }
            className="min-h-[120px]"
          />
        )}

        {entries.length > 0 && (
          <div className="-mx-3">
            {entries.map((e) => (
              <ActivityRow
                key={e.id}
                timestamp={e.timestamp}
                keyName={e.key ?? `${e.table_name}#${e.row_id ?? "?"}`}
                oldValue={e.old_value}
                newValue={e.new_value ?? "—"}
                actor={e.actor}
                sourceType={e.source_type}
                promptId={e.prompt_id ?? undefined}
                notes={e.notes ?? undefined}
              />
            ))}

            <div ref={sentinelRef} aria-hidden className="h-1" />

            {loading && !initialLoad && (
              <div className="flex justify-center py-3">
                <Skeleton className="h-4 w-32" />
              </div>
            )}

            {!hasMore && !loading && (
              <div className="flex items-center justify-center py-3">
                <span className="font-sans text-micro uppercase tracking-wider text-fg-faint">
                  — No more entries —
                </span>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
