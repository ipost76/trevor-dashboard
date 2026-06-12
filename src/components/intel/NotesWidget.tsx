"use client";
import * as React from "react";
import { Plus, StickyNote, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BottomSheet, Card, EmptyState } from "@/components/ui";

/**
 * Global bottom-right Notes widget — a floating button that expands into a
 * compact slide-up sheet (mobile) / narrow popover (desktop) carrying the
 * notepad. Replaces the old global chat FAB (W1-P1, 2026-06-12).
 *
 * Pure browser state — no API, no Python bridge, no DB. Reuses the EXACT
 * `localStorage["trevor-hub-notes"]` key + storage shape the old `/intel`
 * NOTES tab used (`notes-section.tsx`), so any existing notes carry over.
 * If storage is unavailable (Safari private mode, quota exceeded, etc.) notes
 * still work in memory for the session. Sorted newest-first; delete is
 * single-tap (no undo).
 */

interface Note {
  id: string;
  text: string;
  createdAt: string; // ISO timestamp
}

const STORAGE_KEY = "trevor-hub-notes";

function loadNotes(): Note[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (n): n is Note =>
        n != null &&
        typeof n === "object" &&
        typeof (n as Note).id === "string" &&
        typeof (n as Note).text === "string" &&
        typeof (n as Note).createdAt === "string",
    );
  } catch {
    return [];
  }
}

function saveNotes(notes: ReadonlyArray<Note>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // Quota / private-mode — notes still work in-memory for the session
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTimestamp(iso: string, now: number = Date.now()): string {
  const then = new Date(iso);
  const t = then.getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.floor((now - t) / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const sameYear = then.getFullYear() === new Date(now).getFullYear();
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function NotesWidget() {
  const [open, setOpen] = React.useState(false);
  const [notes, setNotes] = React.useState<ReadonlyArray<Note>>([]);
  const [draft, setDraft] = React.useState("");
  const [hydrated, setHydrated] = React.useState(false);

  // Load from localStorage once after mount — guards against SSR mismatch.
  React.useEffect(() => {
    setNotes(loadNotes());
    setHydrated(true);
  }, []);

  // Persist after every change, but only after the initial hydrate read,
  // so we never overwrite real storage with the empty bootstrap value.
  React.useEffect(() => {
    if (hydrated) saveNotes(notes);
  }, [notes, hydrated]);

  const canAdd = draft.trim().length > 0;

  const addNote = React.useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const note: Note = {
      id: makeId(),
      text: trimmed,
      createdAt: new Date().toISOString(),
    };
    setNotes((prev) => [note, ...prev]);
    setDraft("");
  }, [draft]);

  const deleteNote = React.useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        addNote();
      }
    },
    [addNote],
  );

  const count = notes.length;

  return (
    <>
      <button
        type="button"
        aria-label="Open Notes"
        onClick={() => setOpen(true)}
        className={cn(
          "tap-target fixed z-40 inline-flex items-center justify-center rounded-full",
          "border border-accent-cyan-soft/40 bg-bg-card text-accent-cyan-soft-strong shadow-glow-subtle",
          "transition-all duration-instant active:scale-95 hover:scale-105 hover:shadow-glow-focus hover:border-accent-cyan-soft/60",
          "h-12 w-12",
          "bottom-[calc(76px+env(safe-area-inset-bottom,0))] right-4",
          "lg:top-4 lg:right-4 lg:bottom-auto",
        )}
      >
        <StickyNote size={22} />
        {hydrated && count > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full border border-bg-card bg-accent-mint px-1 font-sans text-[10px] font-semibold leading-none text-bg-primary"
            style={{ height: 18 }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="NOTES"
        className="md:max-w-md"
      >
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="jot something down..."
            rows={4}
            aria-label="Note content"
            className="w-full resize-y rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 font-mono text-caption text-fg-primary placeholder:text-fg-muted/60 transition-colors focus:border-accent-cyan-soft focus:outline-none focus:shadow-glow-focus"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="font-sans text-micro italic text-fg-muted">
              Ctrl/⌘ + Enter to add
            </span>
            <button
              type="button"
              onClick={addNote}
              disabled={!canAdd}
              className="tap-target inline-flex items-center justify-center gap-1 rounded-md border border-accent-mint/40 bg-accent-mint/10 px-4 py-2 font-sans text-caption font-semibold uppercase tracking-wider text-accent-mint-strong transition-all duration-instant hover:bg-accent-mint/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent-mint/10"
            >
              <Plus size={14} />
              Add Note
            </button>
          </div>
        </div>

        {hydrated && count === 0 && (
          <div className="mt-4">
            <EmptyState
              title="No notes yet"
              body="Jot one above — it'll save to this browser."
            />
          </div>
        )}

        {hydrated && count > 0 && (
          <ul className="mt-4 space-y-3" aria-label="Notes list">
            {notes.map((n) => (
              <li key={n.id}>
                <Card padding="md">
                  <div className="flex items-start gap-3">
                    <p className="flex-1 whitespace-pre-wrap break-words font-mono text-caption text-fg-primary">
                      {n.text}
                    </p>
                    <button
                      type="button"
                      onClick={() => deleteNote(n.id)}
                      aria-label="Delete note"
                      className="tap-target -m-2 inline-flex flex-none items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-accent-red/10 hover:text-accent-red focus:outline-none focus:ring-1 focus:ring-accent-red"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="mt-2 text-right text-micro text-fg-muted">
                    {formatTimestamp(n.createdAt)}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </BottomSheet>
    </>
  );
}
