"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  SegmentedToggle,
  Pill,
  HapticButton,
} from "@/components/ui";
import type { SegmentedToggleOption } from "@/components/ui";
import { Download, FolderOpen, Archive, RotateCcw, Trash2 } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface DownloadFile {
  filename: string;
  original_name: string;
  created_at: string;
  size_bytes: number;
  archived: boolean;
  archived_at: string | null;
  discord_msg_id: number | null;
  file_type: string;
}

interface DownloadStats {
  active_count: number;
  archive_count: number;
  total_size_mb: number;
}

interface DownloadsResponse {
  files: ReadonlyArray<DownloadFile>;
  stats: DownloadStats;
  filter: string;
  error?: string;
}

type DownloadFilter = "all" | "active" | "archived";

const FILTER_OPTIONS: ReadonlyArray<SegmentedToggleOption<DownloadFilter>> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fileTypePillTone(
  ext: string,
): "cyan" | "red" | "violet" | "neutral" {
  const e = ext.toLowerCase();
  if (e === "md") return "cyan";
  if (e === "pdf") return "red";
  if (e === "zip" || e === "tar" || e === "gz") return "violet";
  return "neutral";
}

// ── File card ────────────────────────────────────────────────────────────────

interface FileCardProps {
  file: DownloadFile;
  archiving: boolean;
  deleting: boolean;
  onDownload: (filename: string) => void;
  onArchiveToggle: (filename: string, currentlyArchived: boolean) => void;
  onDelete: (filename: string) => Promise<boolean>;
}

function DownloadFileCard({
  file,
  archiving,
  deleting,
  onDownload,
  onArchiveToggle,
  onDelete,
}: FileCardProps) {
  const ext = file.file_type || "";
  const tone = fileTypePillTone(ext);
  const handleDownload = () => onDownload(file.filename);
  const handleToggle = () => onArchiveToggle(file.filename, file.archived);

  // Delete is a two-tap confirm: the first tap arms "Confirm Delete" for 3s,
  // a second tap within that window fires the delete. Guards accidental
  // mobile taps. A failed delete shows "Failed" for 2s, then reverts.
  const [deletePhase, setDeletePhase] = React.useState<
    "idle" | "confirm" | "error"
  >("idle");
  const deleteTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDeleteTimer = () => {
    if (deleteTimer.current) {
      clearTimeout(deleteTimer.current);
      deleteTimer.current = null;
    }
  };
  React.useEffect(() => {
    return () => {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
    };
  }, []);

  const handleDeleteClick = async () => {
    if (deletePhase === "idle") {
      clearDeleteTimer();
      setDeletePhase("confirm");
      deleteTimer.current = setTimeout(() => setDeletePhase("idle"), 3000);
      return;
    }
    if (deletePhase === "confirm") {
      clearDeleteTimer();
      const ok = await onDelete(file.filename);
      // On success the parent drops this card from the list (it unmounts);
      // on failure, surface a brief error state, then revert.
      if (!ok) {
        setDeletePhase("error");
        deleteTimer.current = setTimeout(() => setDeletePhase("idle"), 2000);
      }
    }
  };

  return (
    <Card
      padding="sm"
      className={file.archived ? "opacity-70 border-border-amber/40" : ""}
    >
      <div className="flex flex-col gap-3">
        {/* Filename + badges row */}
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="break-all font-mono text-caption text-fg-primary">
              {file.filename}
            </div>
            {file.original_name && file.original_name !== file.filename && (
              <div className="mt-0.5 break-all text-micro text-fg-muted">
                {file.original_name}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {ext && (
              <Pill tone={tone} size="sm">
                {ext}
              </Pill>
            )}
            {file.archived && (
              <Pill tone="amber" size="sm">
                <span aria-hidden>📦</span> Archived
              </Pill>
            )}
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-3 text-micro text-fg-muted">
          <span title={new Date(file.created_at).toLocaleString()}>
            {formatRelativeDate(file.created_at)}
          </span>
          <span className="text-fg-faint">·</span>
          <span>{formatFileSize(file.size_bytes)}</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <HapticButton
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            aria-label={`Download ${file.filename}`}
            className="border border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 hover:text-accent-cyan"
          >
            <Download size={14} />
            Download
          </HapticButton>
          <HapticButton
            variant="ghost"
            size="sm"
            disabled={archiving}
            onClick={handleToggle}
            aria-label={
              file.archived
                ? `Unarchive ${file.filename}`
                : `Archive ${file.filename}`
            }
            className={
              file.archived
                ? "border border-accent-green/30 bg-accent-green/10 text-accent-green hover:bg-accent-green/20 hover:text-accent-green disabled:opacity-50"
                : "border border-accent-amber/30 bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/20 hover:text-accent-amber disabled:opacity-50"
            }
          >
            {file.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
            {archiving ? "..." : file.archived ? "Unarchive" : "Archive"}
          </HapticButton>
          <HapticButton
            variant="ghost"
            size="sm"
            disabled={deleting}
            onClick={() => void handleDeleteClick()}
            aria-label={
              deletePhase === "confirm"
                ? `Confirm permanent deletion of ${file.filename}`
                : `Delete ${file.filename}`
            }
            className={
              deletePhase === "confirm"
                ? "animate-pulse border border-accent-red/60 bg-accent-red/25 text-accent-red hover:bg-accent-red/35 hover:text-accent-red disabled:opacity-50"
                : deletePhase === "error"
                  ? "border border-accent-red/30 bg-accent-red/10 text-fg-muted disabled:opacity-50"
                  : "border border-accent-red/30 bg-accent-red/10 text-accent-red hover:bg-accent-red/20 hover:text-accent-red disabled:opacity-50"
            }
          >
            <Trash2 size={14} />
            {deleting
              ? "..."
              : deletePhase === "confirm"
                ? "Confirm Delete"
                : deletePhase === "error"
                  ? "Failed"
                  : "Delete"}
          </HapticButton>
        </div>
      </div>
    </Card>
  );
}

// ── Main section ─────────────────────────────────────────────────────────────

export function DownloadsSection() {
  const [data, setData] = React.useState<DownloadsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<DownloadFilter>("all");
  const [archiving, setArchiving] = React.useState<Set<string>>(new Set());
  const [deleting, setDeleting] = React.useState<Set<string>>(new Set());

  const fetchData = React.useCallback(async (status: DownloadFilter) => {
    try {
      const res = await fetch(`/api/intel/downloads?status=${status}`, {
        cache: "no-store",
      });
      if (res.ok) setData((await res.json()) as DownloadsResponse);
    } catch {
      // swallow; UI surfaces error via data.error if backend returned one
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchData(filter);
    const id = setInterval(() => void fetchData(filter), 60_000);
    return () => clearInterval(id);
  }, [filter, fetchData]);

  const handleDownload = (filename: string) => {
    const link = document.createElement("a");
    link.href = `/api/intel/downloads/${encodeURIComponent(filename)}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleArchiveToggle = async (
    filename: string,
    currentlyArchived: boolean,
  ) => {
    setArchiving((prev) => new Set(prev).add(filename));
    try {
      const endpoint = currentlyArchived
        ? "/api/intel/downloads/unarchive"
        : "/api/intel/downloads/archive";
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      await fetchData(filter);
    } catch {
      // swallow; refetch will surface server-side state on next poll
    } finally {
      setArchiving((prev) => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
    }
  };

  const handleDelete = async (filename: string): Promise<boolean> => {
    setDeleting((prev) => new Set(prev).add(filename));
    try {
      const res = await fetch("/api/intel/downloads/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const result = (await res.json().catch(() => ({}))) as {
        success?: boolean;
      };
      const ok = res.ok && result.success === true;
      if (ok) {
        // Refetch — the file drops from the list and the stats (active /
        // archived counts + total size) refresh from server truth.
        await fetchData(filter);
      }
      return ok;
    } catch {
      return false;
    } finally {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(filename);
        return next;
      });
    }
  };

  const stats = data?.stats;
  const files = data?.files ?? [];

  return (
    <div className="space-y-4 p-4 animate-fade-in md:space-y-6 md:p-6 lg:px-8">
      {/* Header card — magenta glow (INTEL zone accent) */}
      <Card padding="md" glow="magenta">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Download size={14} />
              DOWNLOADS
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5 text-micro text-fg-muted">
            {stats && (
              <>
                <Pill tone="cyan" size="sm">
                  {stats.active_count} active
                </Pill>
                <Pill tone="amber" size="sm">
                  {stats.archive_count} archived
                </Pill>
                <span className="text-fg-faint">·</span>
                <span>{stats.total_size_mb.toFixed(1)} MB</span>
              </>
            )}
          </div>
        </CardHeader>

        <SegmentedToggle<DownloadFilter>
          ariaLabel="Filter downloads"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
          full
        />
      </Card>

      {/* Initial-load skeleton */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {/* Backend error */}
      {!loading && data?.error && (
        <EmptyState title="Failed to load downloads" body={data.error} />
      )}

      {/* Empty state */}
      {!loading && data && !data.error && files.length === 0 && (
        <EmptyState
          icon={<FolderOpen size={24} />}
          title={
            filter === "all"
              ? "No downloads yet"
              : filter === "active"
                ? "No active downloads"
                : "No archived downloads"
          }
          body={
            filter === "all"
              ? "Files delivered to #downloads will appear here automatically. React 📦 in Discord on a delivered message to archive it."
              : filter === "active"
                ? "All downloads are archived. Switch to 'Archived' to view them."
                : "No downloads have been archived yet. React 📦 in Discord to archive."
          }
        />
      )}

      {/* File list */}
      {!loading && files.length > 0 && (
        <ul className="space-y-3">
          {files.map((f) => (
            <li key={f.filename}>
              <DownloadFileCard
                file={f}
                archiving={archiving.has(f.filename)}
                deleting={deleting.has(f.filename)}
                onDownload={handleDownload}
                onArchiveToggle={handleArchiveToggle}
                onDelete={handleDelete}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
