"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Pill,
  HapticButton,
} from "@/components/ui";
import {
  Download,
  FolderOpen,
  Trash2,
  FolderInput,
  Settings,
} from "lucide-react";
import { CategoryTabs, UNCATEGORIZED_KEY, type DocsCategory } from "./category-tabs";
import { MoveToSheet } from "./move-to-sheet";
import { CategorySettingsSheet } from "./category-settings-sheet";
import { DownloadFormatSheet, isPrintable } from "./download-format-sheet";
import { DigestMarkdown } from "@/components/memory/digest-markdown";
import { MarkdownPrintDocument } from "@/components/ui/markdown-print-document";

// B4 — Docs → PDF source state.
//
// 🚨 The PDF prints from the FILE'S OWN BYTES, fetched here, never from the
// DOM: the Docs zone is a file browser and renders no document on screen at
// all, so there would be nothing to clone even if cloning were acceptable.
// This is the same invariant the digest print path holds.
//
// The fetch reuses the existing .md download route rather than adding one.
// That route sets Content-Disposition: attachment, which `fetch` ignores — it
// only affects how a browser NAVIGATION is handled — so reading the body as
// text is correct and needs no new endpoint.
type DocSource =
  | { phase: "loading" }
  | { phase: "ready"; body: string }
  | { phase: "error" };

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
  /** Category folder id, or null when the file is Uncategorized (Wave B1). */
  category_id: string | null;
}

interface DownloadStats {
  active_count: number;
  archive_count: number;
  total_size_mb: number;
}

interface DownloadsResponse {
  files: ReadonlyArray<DownloadFile>;
  stats: DownloadStats;
  /** Kept for backend-response parity; the UI no longer filters by status
   *  (the All/Active/Archived toggle was removed 2026-05-20 — categories
   *  replaced the archive concept). */
  filter?: string;
  error?: string;
}

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
  deleting: boolean;
  moving: boolean;
  onDownload: (filename: string) => void;
  onDelete: (filename: string) => Promise<boolean>;
  onMove: (file: DownloadFile) => void;
}

function DownloadFileCard({
  file,
  deleting,
  moving,
  onDownload,
  onDelete,
  onMove,
}: FileCardProps) {
  const ext = file.file_type || "";
  const tone = fileTypePillTone(ext);
  const handleDownload = () => onDownload(file.filename);

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
    <Card padding="sm">
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
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-3 font-sans text-micro text-fg-muted">
          <span title={new Date(file.created_at).toLocaleString()}>
            {formatRelativeDate(file.created_at)}
          </span>
          <span className="text-fg-faint">·</span>
          <span className="font-mono">{formatFileSize(file.size_bytes)}</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2">
          <HapticButton
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            aria-label={`Download ${file.filename}`}
            className="border border-accent-cyan-soft/30 bg-accent-cyan-soft/10 text-accent-cyan-soft-strong hover:bg-accent-cyan-soft/20 hover:text-accent-cyan-soft-strong"
          >
            <Download size={14} />
            Download
          </HapticButton>
          <HapticButton
            variant="ghost"
            size="sm"
            disabled={moving}
            onClick={() => onMove(file)}
            aria-label={`Move ${file.filename} to another category`}
            className="border border-accent-plum/30 bg-accent-plum/10 text-accent-plum-strong hover:bg-accent-plum/20 hover:text-accent-plum-strong disabled:opacity-50"
          >
            <FolderInput size={14} />
            {moving ? "..." : "Move"}
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
                  ? "border border-accent-red-subtle bg-accent-red/10 text-fg-muted disabled:opacity-50"
                  : "border border-accent-red-subtle bg-accent-red/10 text-accent-red hover:bg-accent-red/20 hover:text-accent-red disabled:opacity-50"
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
  const [deleting, setDeleting] = React.useState<Set<string>>(new Set());
  // In-flight set for the MOVE button (Wave B2). Mirrors the `deleting` set
  // pattern (the parallel `archiving` set was removed 2026-05-20 along with
  // the Archive button).
  const [moving, setMoving] = React.useState<Set<string>>(new Set());
  // The file currently targeted by the Move-to sheet. `null` = sheet closed.
  const [moveSheetFile, setMoveSheetFile] = React.useState<DownloadFile | null>(
    null,
  );
  // Settings (category management) sheet visibility — Wave B2.
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  // Filename currently targeted by the Download-format sheet (.md vs PDF
  // picker). `null` = sheet closed. The Download button on a file card now
  // opens this sheet instead of firing a direct .md download.
  const [downloadSheetFile, setDownloadSheetFile] = React.useState<
    string | null
  >(null);
  // B4 — the fetched markdown behind the PDF print path, keyed by filename so
  // reopening a sheet for a file already read does not refetch it.
  const [docSources, setDocSources] = React.useState<
    Record<string, DocSource>
  >({});
  // Category folders (Wave B1). `null` = the categories fetch has not resolved
  // yet; `[]` = resolved empty / endpoint unavailable → a lone Uncategorized
  // tab. `activeCategory` holds a category id or UNCATEGORIZED_KEY; it stays
  // null until the first load picks a default (see the init effect below).
  const [categories, setCategories] = React.useState<
    ReadonlyArray<DocsCategory> | null
  >(null);
  const [activeCategory, setActiveCategory] = React.useState<string | null>(
    null,
  );
  const categoryInitRef = React.useRef(false);

  // Archive concept retired 2026-05-20 — categories replaced it, so the
  // listing now requests the full set (no `?status=` filter). The backend
  // route still accepts `?status=` and returns `stats.archive_count` for
  // backend-response parity; the UI just no longer surfaces either.
  const fetchData = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/intel/downloads`, {
        cache: "no-store",
      });
      if (res.ok) setData((await res.json()) as DownloadsResponse);
    } catch {
      // swallow; UI surfaces error via data.error if backend returned one
    } finally {
      setLoading(false);
    }
  }, []);

  // Category list — fetched once on mount. A 404/500 (e.g. before the Wave B1
  // build lands the /api/docs/categories route) degrades to `[]`: the strip
  // then shows only the Uncategorized tab and every file falls under it.
  const fetchCategories = React.useCallback(async () => {
    try {
      const res = await fetch("/api/docs/categories", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as { categories?: DocsCategory[] };
        setCategories(json.categories ?? []);
      } else {
        setCategories([]);
      }
    } catch {
      setCategories([]);
    }
  }, []);

  React.useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  React.useEffect(() => {
    void fetchCategories();
  }, [fetchCategories]);

  // If the active tab's category gets deleted (via the settings sheet), fall
  // back to Uncategorized so the file list / count badges don't reference a
  // stale id. Runs whenever the categories array changes (Wave B2).
  React.useEffect(() => {
    if (categories === null || activeCategory === null) return;
    if (activeCategory === UNCATEGORIZED_KEY) return;
    if (categories.some((c) => c.id === activeCategory)) return;
    setActiveCategory(UNCATEGORIZED_KEY);
  }, [categories, activeCategory]);

  // Single-fetch design: the status-filtered listing already carries every
  // file's category_id, so tab switches filter in-memory — no extra request.
  const files = React.useMemo(() => data?.files ?? [], [data]);

  // Per-tab counts — keyed by category id, plus UNCATEGORIZED_KEY. Derived
  // from the current listing so each badge matches exactly what its tab shows.
  const counts = React.useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const f of files) {
      const key = f.category_id ?? UNCATEGORIZED_KEY;
      m[key] = (m[key] ?? 0) + 1;
    }
    return m;
  }, [files]);

  // First load picks the default tab: the first category (by sort_order) that
  // has files, else Uncategorized. Runs once — later polls and filter changes
  // must not yank the user off the tab they selected. Keyed off `loading` (not
  // `data`) so a failed listing still resolves the tab to Uncategorized.
  React.useEffect(() => {
    if (categoryInitRef.current) return;
    if (loading || categories === null) return;
    const fileList = data?.files ?? [];
    const firstWithFiles = [...categories]
      .sort((a, b) => a.sort_order - b.sort_order)
      .find((c) => fileList.some((f) => f.category_id === c.id));
    setActiveCategory(firstWithFiles ? firstWithFiles.id : UNCATEGORIZED_KEY);
    categoryInitRef.current = true;
  }, [loading, categories, data]);

  const activeKey = activeCategory ?? UNCATEGORIZED_KEY;
  const isUncategorized = activeKey === UNCATEGORIZED_KEY;

  // Files for the selected tab — client-side filter on the single listing.
  const visibleFiles = React.useMemo(
    () =>
      isUncategorized
        ? files.filter((f) => f.category_id == null)
        : files.filter((f) => f.category_id === activeKey),
    [files, activeKey, isUncategorized],
  );

  const activeCategoryName = isUncategorized
    ? "Uncategorized"
    : (categories?.find((c) => c.id === activeKey)?.name ?? activeKey);

  // B4 — read a file's markdown so the print document has something to render.
  // Only .md is fetched: it is the only thing the renderer parses, and pulling
  // a multi-MB .zip into memory to print it would be worse than useless.
  const loadDocSource = React.useCallback(async (filename: string) => {
    setDocSources((prev) =>
      prev[filename]?.phase === "ready"
        ? prev
        : { ...prev, [filename]: { phase: "loading" } },
    );
    try {
      const res = await fetch(
        `/api/intel/downloads/${encodeURIComponent(filename)}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error("read failed");
      const body = await res.text();
      if (!body) throw new Error("empty document");
      setDocSources((prev) => ({
        ...prev,
        [filename]: { phase: "ready", body },
      }));
    } catch {
      // 🚨 The FAILURE is stored, never the error text. A route's error string
      // reaching user-facing copy is the F1 defect class; the sheet chooses its
      // own sentence from this phase.
      setDocSources((prev) => ({ ...prev, [filename]: { phase: "error" } }));
    }
  }, []);

  // Opens the DownloadFormatSheet — the sheet hosts both the .md and PDF
  // download triggers. (Pre-Phase 2 this was a direct-link click; the sheet
  // now mediates so users can pick a format on every tap.)
  const handleDownload = (filename: string) => {
    setDownloadSheetFile(filename);
    // The PDF path prints the rendered document, so fetch it on open — the
    // Docs zone never renders the file on screen, so nothing else would.
    if (isPrintable(filename) && docSources[filename]?.phase !== "ready") {
      void loadDocSource(filename);
    }
  };

  const handleMove = async (
    filename: string,
    category_id: string | null,
  ): Promise<boolean> => {
    setMoving((prev) => new Set(prev).add(filename));
    try {
      const res = await fetch(
        `/api/docs/downloads/${encodeURIComponent(filename)}/move`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category_id }),
        },
      );
      const result = (await res.json().catch(() => ({}))) as {
        success?: boolean;
      };
      const ok = res.ok && result.success !== false;
      if (ok) {
        // Single-fetch design (Wave B1): one refetch yields the moved file's
        // new category_id, which the counts useMemo derives — tab badges
        // increment/decrement automatically and the card drops from the
        // current tab.
        await fetchData();
      }
      return ok;
    } catch {
      return false;
    } finally {
      setMoving((prev) => {
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
        // Refetch — the file drops from the list and the stats (file count +
        // total size) refresh from server truth.
        await fetchData();
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
  // Initial paint waits for the listing AND the default-tab pick so the file
  // list never flashes Uncategorized before resolving to the chosen tab.
  const initializing = loading || activeCategory === null;

  return (
    <div className="space-y-4 p-4 animate-fade-in md:space-y-6 md:p-6 lg:px-8">
      {/* Header card — refined plum-subtle border (A4 v1.1) */}
      <Card padding="md" className="card-elevated">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Download size={14} />
              DOWNLOADS
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap items-center gap-1.5 font-sans text-micro text-fg-muted">
              {stats && (
                <>
                  {/* Archive pill removed 2026-05-20 — archive concept is gone
                      from the UI; categories replace it. `active_count` now
                      equals the total file count (archive_count is always 0)
                      so we label the pill "files" rather than "active". */}
                  <Pill
                    tone="cyan"
                    size="sm"
                    className="bg-accent-cyan-soft/10 text-accent-cyan-soft-strong border-accent-cyan-soft/30"
                  >
                    {stats.active_count} files
                  </Pill>
                  <span className="text-fg-faint">·</span>
                  <span className="font-mono">{stats.total_size_mb.toFixed(1)} MB</span>
                </>
              )}
            </div>
            {/* Settings gear — opens the category management sheet (Wave B2). */}
            <HapticButton
              variant="ghost"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              aria-label="Manage categories"
              title="Manage categories"
              className="border border-border-subtle bg-bg-elevated/30 text-fg-muted hover:border-accent-plum/40 hover:bg-accent-plum/10 hover:text-accent-plum-strong"
            >
              <Settings size={14} aria-hidden />
            </HapticButton>
          </div>
        </CardHeader>
      </Card>

      {/* Category tabs — Reports / Audits / Monitor / Uncategorized (Wave B1).
          Rendered once the categories fetch resolves; selects which files show
          below. /docs is a single-view zone (no zone-level sub-tab strip
          above — Lessons / Journal moved back to /intel 2026-05-19). */}
      {categories !== null && (
        <CategoryTabs
          categories={categories}
          counts={counts}
          active={activeKey}
          onChange={setActiveCategory}
        />
      )}

      {/* Initial-load skeleton */}
      {initializing && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {/* Backend error */}
      {!initializing && data?.error && (
        <EmptyState
          title="Couldn't load your files"
          body="Couldn't load the file list right now."
        />
      )}

      {/* Empty state — scoped to the selected category */}
      {!initializing && data && !data.error && visibleFiles.length === 0 && (
        <EmptyState
          icon={<FolderOpen size={24} />}
          title={`No files in ${activeCategoryName}`}
          body={
            isUncategorized
              ? "Files delivered to #downloads land here until they are sorted into a category."
              : "No files have been assigned to this category yet."
          }
        />
      )}

      {/* File list — selected category */}
      {!initializing && visibleFiles.length > 0 && (
        <ul className="space-y-3">
          {visibleFiles.map((f) => (
            <li key={f.filename}>
              <DownloadFileCard
                file={f}
                deleting={deleting.has(f.filename)}
                moving={moving.has(f.filename)}
                onDownload={handleDownload}
                onDelete={handleDelete}
                onMove={setMoveSheetFile}
              />
            </li>
          ))}
        </ul>
      )}

      {/* 🚨 B4 — the printable document. It is built from the file's own bytes
          (the same bytes the .md download serves), NEVER from the DOM. The
          Docs zone renders no document on screen, so the print root is the
          only place this content exists — it is hidden on screen and revealed
          only in print media by the shared @media print stylesheet.

          Nothing here may unmount while a print is in flight: printing is
          asynchronous, and download-format-sheet deliberately does not call
          onClose() on the print path for exactly that reason. */}
      <MarkdownPrintDocument
        label={downloadSheetFile ? `TREVOR · ${downloadSheetFile}` : null}
        ready={
          downloadSheetFile !== null &&
          docSources[downloadSheetFile]?.phase === "ready"
        }
      >
        <DigestMarkdown
          source={
            downloadSheetFile && docSources[downloadSheetFile]?.phase === "ready"
              ? (docSources[downloadSheetFile] as { body: string }).body
              : ""
          }
        />
      </MarkdownPrintDocument>

      {/* Download-format sheet — opens when the Download button on any card
          is tapped (Phase 2 — PDF download wave). Hosts the .md direct-link
          flow and the client-side print-to-PDF path. One shared instance,
          scoped to whichever file's Download was tapped. */}
      <DownloadFormatSheet
        open={downloadSheetFile !== null}
        onClose={() => setDownloadSheetFile(null)}
        filename={downloadSheetFile}
        printReady={
          downloadSheetFile !== null &&
          docSources[downloadSheetFile]?.phase === "ready"
        }
        printFailed={
          downloadSheetFile !== null &&
          docSources[downloadSheetFile]?.phase === "error"
        }
      />

      {/* Move-to sheet — one shared instance; opens for whichever file's MOVE
          button was tapped (Wave B2). Categories list is the same one the
          tab strip uses, so the destination list always matches the tabs. */}
      <MoveToSheet
        open={moveSheetFile !== null}
        onClose={() => setMoveSheetFile(null)}
        file={moveSheetFile}
        categories={categories ?? []}
        onMove={handleMove}
      />

      {/* Category management sheet — opened by the ⚙️ gear in the header
          (Wave B2). On every successful create/rename/delete we re-fetch both
          the categories array (drives the tab strip + Move-to destinations)
          and the file listing (delete moves files to Uncategorized → counts
          and category_ids change). */}
      <CategorySettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        categories={categories ?? []}
        counts={counts}
        onCategoriesChanged={() => {
          void fetchCategories();
          void fetchData();
        }}
      />
    </div>
  );
}
