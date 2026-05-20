"use client";
import * as React from "react";
import { Card, CardHeader, CardTitle, EmptyState, Pill } from "@/components/ui";
import { Plus, StickyNote, X } from "lucide-react";

/**
 * /intel?tab=notes — client-side notepad.
 *
 * Pure browser state — no API, no Python bridge, no DB. Persists to
 * `localStorage["trevor-hub-notes"]`; if storage is unavailable
 * (Safari private mode, quota exceeded, etc.) notes still work in
 * memory for the session. Sorted newest-first; delete is single-tap
 * (no undo). Added 2026-05-20 as the Intel default tab.
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

export function NotesSection() {
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

  return (
    <div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <StickyNote size={14} />
              NOTES
            </span>
          </CardTitle>
          {hydrated && notes.length > 0 && (
            <Pill tone="neutral" size="sm">
              {notes.length}
            </Pill>
          )}
        </CardHeader>

        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="jot something down..."
            rows={4}
            aria-label="Note content"
            className="w-full resize-y rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 font-mono text-caption text-fg-primary placeholder:text-fg-muted/60 transition-colors focus:border-accent-cyan focus:outline-none focus:ring-1 focus:ring-accent-cyan"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-micro text-fg-muted">
              Ctrl/⌘ + Enter to add
            </span>
            <button
              type="button"
              onClick={addNote}
              disabled={!canAdd}
              className="tap-target inline-flex items-center justify-center gap-1 rounded-md border border-accent-green/40 bg-accent-green/10 px-4 py-2 font-mono text-caption uppercase tracking-wider text-accent-green transition-all duration-instant hover:bg-accent-green/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent-green/10"
            >
              <Plus size={14} />
              Add Note
            </button>
          </div>
        </div>
      </Card>

      {hydrated && notes.length === 0 && (
        <EmptyState
          title="No notes yet"
          body="Jot one above — it'll save to this browser."
        />
      )}

      {hydrated && notes.length > 0 && (
        <ul className="space-y-3" aria-label="Notes list">
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
    </div>
  );
}
