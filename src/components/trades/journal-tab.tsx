"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BookOpen,
  Plus,
  Trash2,
  Save,
  X,
  FileText,
  Calendar,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/fetch";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/* ── Types ── */

type JournalEntry = {
  filename: string;
  content: string;
  date: string;
  size: number;
};

/* ── Helpers ── */

function getJournalPnlStatus(content: string): "winning" | "losing" | "neutral" {
  const match = content.match(/P&L[:\s*]*([+-]?\d+\.?\d*)%/i);
  if (!match) return "neutral";
  const pnl = parseFloat(match[1]);
  return pnl > 0 ? "winning" : pnl < 0 ? "losing" : "neutral";
}

const PNL_BORDER: Record<string, string> = {
  winning: "border-l-[3px] border-l-[#00ff88]",
  losing: "border-l-[3px] border-l-[#ff3355]",
  neutral: "border-l-[3px] border-l-[#3d6b4a]",
};

function extractTitle(content: string): string {
  const firstLine = content.split("\n").find((l) => l.trim().length > 0) || "";
  return firstLine.replace(/^#+\s*/, "").trim() || "Untitled";
}

function extractPreview(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  // Skip the title line (first non-empty), take next 2-3 lines
  const previewLines = lines.slice(1, 4);
  return previewLines.join(" ").replace(/^#+\s*/gm, "").trim() || "";
}

function wordCount(content: string): number {
  return content
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function formatDate(dateStr: string): string {
  // Filename format: YYYY-MM-DD-HHMMSS or YYYY-MM-DD
  const cleaned = dateStr.replace(/\.md$/, "");
  const parts = cleaned.split("-");
  if (parts.length >= 3) {
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const monthIdx = parseInt(month, 10) - 1;
    const monthName =
      monthIdx >= 0 && monthIdx < 12 ? monthNames[monthIdx] : month;
    return `${monthName} ${parseInt(day, 10)}, ${year}`;
  }
  return dateStr;
}

/* ── New Entry Form ── */

function NewEntryForm({
  onSave,
  onCancel,
}: {
  onSave: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!content.trim()) {
      setError("Content is required");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Unknown error" }));
        setError(d.error || `HTTP ${res.status}`);
        setSaving(false);
        return;
      }

      setSaving(false);
      onSave();
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  };

  return (
    <div className="panel p-3 space-y-2 border-[var(--neon-cyan)] glow-border">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold neon-text">NEW JOURNAL ENTRY</span>
        <button
          onClick={onCancel}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div>
        <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          Title
        </label>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
          placeholder="Market Observations, Strategy Review..."
          className="input-terminal w-full mt-0.5"
          autoFocus
        />
      </div>

      <div>
        <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
          Content
        </label>
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setError("");
          }}
          placeholder="Write your journal entry... Markdown supported."
          rows={8}
          className="input-terminal w-full mt-0.5 resize-none font-mono text-[11px] leading-relaxed"
        />
        <div className="flex justify-end mt-0.5">
          <span className="text-[9px] text-muted-foreground">
            {wordCount(content)} words
          </span>
        </div>
      </div>

      {error && (
        <div className="text-[10px] text-[var(--neon-red)]">{error}</div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="btn-primary text-[10px] px-3 py-1"
          disabled={saving}
        >
          CANCEL
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1 text-[10px] px-3 py-1 font-bold uppercase tracking-wider bg-[rgba(0,240,255,0.1)] text-[var(--neon-cyan)] border border-[rgba(0,240,255,0.3)] rounded hover:bg-[rgba(0,240,255,0.2)] transition-colors disabled:opacity-50"
        >
          <Save className="h-3 w-3" />
          {saving ? "SAVING..." : "SAVE ENTRY"}
        </button>
      </div>
    </div>
  );
}

/* ── Main Component ── */

export function JournalTab() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const d = await safeFetch<{ entries?: JournalEntry[] }>(
      "/api/journal",
      {}
    );
    setEntries(d.entries || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const deleteEntry = async (filename: string) => {
    setDeleting(filename);
    try {
      await fetch("/api/journal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      fetchEntries();
    } finally {
      setDeleting(null);
    }
  };

  const handleNewSave = () => {
    setShowNew(false);
    fetchEntries();
  };

  return (
    <div className="p-2 space-y-2 h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <BookOpen className="h-3 w-3 text-[var(--neon-cyan)]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {entries.length} {entries.length === 1 ? "Entry" : "Entries"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={fetchEntries}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          {!showNew && (
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 font-bold uppercase tracking-wider bg-[rgba(0,240,255,0.1)] text-[var(--neon-cyan)] border border-[rgba(0,240,255,0.3)] rounded hover:bg-[rgba(0,240,255,0.2)] transition-colors"
            >
              <Plus className="h-3 w-3" />
              New Entry
            </button>
          )}
        </div>
      </div>

      {/* New Entry Form */}
      {showNew && (
        <NewEntryForm
          onSave={handleNewSave}
          onCancel={() => setShowNew(false)}
        />
      )}

      {/* Entries List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="panel p-3 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 && !showNew ? (
        <EmptyState
          icon={BookOpen}
          message="No journal entries yet"
          sub="Start documenting your trading insights and observations"
          action={
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1 text-[10px] px-2 py-1 font-bold uppercase tracking-wider bg-[rgba(0,240,255,0.1)] text-[var(--neon-cyan)] border border-[rgba(0,240,255,0.3)] rounded hover:bg-[rgba(0,240,255,0.2)] transition-colors mt-2"
            >
              <Plus className="h-3 w-3" />
              Write First Entry
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const title = extractTitle(entry.content);
            const preview = extractPreview(entry.content);
            const words = wordCount(entry.content);
            const isExpanded = expandedFile === entry.filename;
            const pnlStatus = getJournalPnlStatus(entry.content);

            return (
              <div
                key={entry.filename}
                className={cn(
                  "panel p-3 transition-colors cursor-pointer hover:border-[rgba(0,240,255,0.2)]",
                  PNL_BORDER[pnlStatus],
                  isExpanded && "border-[rgba(0,240,255,0.15)]"
                )}
                onClick={() =>
                  setExpandedFile(isExpanded ? null : entry.filename)
                }
              >
                {/* Card Header */}
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-3.5 w-3.5 text-[var(--neon-cyan)] shrink-0" />
                    <span className="text-[12px] font-bold text-foreground truncate">
                      {title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {pnlStatus === "winning" && <span className="text-[10px] font-bold neon-green">▲ profit</span>}
                    {pnlStatus === "losing" && <span className="text-[10px] font-bold neon-red">▼ loss</span>}
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                      <Calendar className="h-2.5 w-2.5" />
                      {formatDate(entry.date)}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteEntry(entry.filename);
                      }}
                      disabled={deleting === entry.filename}
                      className={cn(
                        "text-muted-foreground hover:text-[var(--neon-red)] transition-colors",
                        deleting === entry.filename && "opacity-50"
                      )}
                      title="Delete entry"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {/* Preview or Full Content */}
                {isExpanded ? (
                  <div className="mt-2 pl-5">
                    <div className="text-[11px] text-foreground font-mono leading-relaxed whitespace-pre-wrap">
                      {entry.content}
                    </div>
                  </div>
                ) : (
                  preview && (
                    <div className="text-[10px] text-muted-foreground pl-5 line-clamp-2">
                      {preview}
                    </div>
                  )
                )}

                {/* Footer */}
                <div className="flex items-center gap-3 mt-1.5 pl-5">
                  <span className="text-[9px] text-muted-foreground">
                    {words} words
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {(entry.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
