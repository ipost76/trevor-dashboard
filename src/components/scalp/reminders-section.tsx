"use client";
import * as React from "react";
import { Bell, Check, X, Plus, Repeat, Pencil, Save, RotateCcw } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  MetricTile,
  Pill,
  EmptyState,
  HapticButton,
  CollapsibleSection,
  Skeleton,
} from "@/components/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type RepeatMode = "once" | "twice" | "until_confirmed";
type ReminderStatus = "pending" | "active" | "completed" | "cancelled";

interface Reminder {
  id: number;
  text: string;
  due_at: string;
  repeat_mode: RepeatMode | string;
  times_fired: number;
  last_fired_at: string | null;
  status: ReminderStatus | string;
  discord_message_id: string | null;
  created_at: string;
  completed_at: string | null;
  source: string | null;
}

interface RemindersResponse {
  reminders: Reminder[];
  summary: { pending: number; active: number; completed: number; cancelled: number };
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Time helpers — ET only (project convention per tz_utils.py)
// ─────────────────────────────────────────────────────────────────────────────

const ET_TZ = "America/New_York";

function dtLocalToISOAsET(local: string): string {
  if (!local) return "";
  const padded = local.length === 16 ? local + ":00" : local;
  const fakeUtc = new Date(padded + "Z");
  if (Number.isNaN(fakeUtc.getTime())) return "";
  const etDisplay = fakeUtc.toLocaleString("sv-SE", { timeZone: ET_TZ, hour12: false });
  const utcDisplay = fakeUtc.toLocaleString("sv-SE", { timeZone: "UTC", hour12: false });
  const etMs = new Date(etDisplay.replace(" ", "T") + "Z").getTime();
  const utcMs = new Date(utcDisplay.replace(" ", "T") + "Z").getTime();
  const offsetMs = utcMs - etMs;
  return new Date(fakeUtc.getTime() + offsetMs).toISOString();
}

function isoToDateTimeLocalET(iso: string): string {
  if (!iso) return "";
  try {
    const ets = new Date(iso).toLocaleString("sv-SE", { timeZone: ET_TZ, hour12: false });
    const m = ets.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    return m ? `${m[1]}T${m[2]}` : "";
  } catch {
    return "";
  }
}

function formatISOAsET(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return (
      d.toLocaleString("en-US", {
        timeZone: ET_TZ,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }) + " ET"
    );
  } catch {
    return iso;
  }
}

function parseSqliteAsUtc(s: string | null): number {
  // Reminder rows: due_at is ISO with optional Z; created_at/completed_at
  // are SQLite strftime "YYYY-MM-DD HH:MM:SS" assumed UTC.
  if (!s) return NaN;
  if (s.includes("T")) return new Date(s).getTime();
  return new Date(s.replace(" ", "T") + "Z").getTime();
}

function relativeTime(iso: string): { label: string; overdue: boolean } {
  if (!iso) return { label: "—", overdue: false };
  const t = parseSqliteAsUtc(iso);
  if (Number.isNaN(t)) return { label: iso, overdue: false };
  const diffMs = t - Date.now();
  const overdue = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const mins = Math.round(absMs / 60_000);
  const hours = Math.round(absMs / 3_600_000);
  const days = Math.round(absMs / 86_400_000);
  let body: string;
  if (mins < 60) body = `${mins}m`;
  else if (hours < 24) body = `${hours}h`;
  else body = `${days}d`;
  return {
    label: overdue ? `OVERDUE ${body} ago` : `in ${body}`,
    overdue,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pill helpers
// ─────────────────────────────────────────────────────────────────────────────

function statusTone(status: string): "amber" | "cyan" | "green" | "red" | "neutral" {
  switch (status) {
    case "pending":
      return "amber";
    case "active":
      return "cyan";
    case "completed":
      return "green";
    case "cancelled":
      return "red";
    default:
      return "neutral";
  }
}

function repeatLabel(mode: string): string {
  if (mode === "once") return "Once";
  if (mode === "twice") return "Twice";
  if (mode === "until_confirmed") return "Until Done";
  return mode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function RemindersSection() {
  const [data, setData] = React.useState<RemindersResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [fetchErr, setFetchErr] = React.useState<string | null>(null);

  // Add-form state
  const [addText, setAddText] = React.useState("");
  const [addDueAt, setAddDueAt] = React.useState("");
  const [addRepeat, setAddRepeat] = React.useState<RepeatMode>("once");
  const [submitting, setSubmitting] = React.useState(false);
  const [opError, setOpError] = React.useState<string | null>(null);
  const [opOkMsg, setOpOkMsg] = React.useState<string | null>(null);

  // Edit-form state
  const [editId, setEditId] = React.useState<number | null>(null);
  const [editText, setEditText] = React.useState("");
  const [editDueAt, setEditDueAt] = React.useState("");
  const [editRepeat, setEditRepeat] = React.useState<RepeatMode>("once");

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/reminders", { cache: "no-store" });
      const json: RemindersResponse = await res.json();
      setData(json);
      setFetchErr(json.error ?? null);
    } catch (e) {
      setFetchErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  async function postAction(payload: Record<string, unknown>): Promise<boolean> {
    setSubmitting(true);
    setOpError(null);
    setOpOkMsg(null);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setOpError(json.error || `HTTP ${res.status}`);
        return false;
      }
      await refresh();
      return true;
    } catch (e) {
      setOpError(String(e));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addText.trim() || !addDueAt) {
      setOpError("Text and due date required");
      return;
    }
    const isoUtc = dtLocalToISOAsET(addDueAt);
    if (!isoUtc) {
      setOpError("Invalid due date");
      return;
    }
    const ok = await postAction({
      action: "add",
      text: addText.trim(),
      due_at: isoUtc,
      repeat_mode: addRepeat,
      source: "hub",
    });
    if (ok) {
      setAddText("");
      setAddDueAt("");
      setAddRepeat("once");
      setOpOkMsg("Reminder added");
    }
  }

  function startEdit(r: Reminder) {
    setEditId(r.id);
    setEditText(r.text);
    setEditDueAt(isoToDateTimeLocalET(r.due_at));
    setEditRepeat((r.repeat_mode as RepeatMode) || "once");
  }

  function cancelEdit() {
    setEditId(null);
    setEditText("");
    setEditDueAt("");
    setEditRepeat("once");
  }

  async function saveEdit(id: number) {
    if (!editText.trim() || !editDueAt) {
      setOpError("Text and due date required");
      return;
    }
    const isoUtc = dtLocalToISOAsET(editDueAt);
    const ok = await postAction({
      action: "edit",
      id,
      text: editText.trim(),
      due_at: isoUtc,
      repeat_mode: editRepeat,
    });
    if (ok) {
      cancelEdit();
      setOpOkMsg("Reminder updated");
    }
  }

  const reminders = data?.reminders ?? [];
  const active = reminders
    .filter((r) => r.status === "pending" || r.status === "active")
    .sort((a, b) => parseSqliteAsUtc(a.due_at) - parseSqliteAsUtc(b.due_at));
  const closed = reminders
    .filter((r) => r.status === "completed" || r.status === "cancelled")
    .sort((a, b) => parseSqliteAsUtc(b.created_at) - parseSqliteAsUtc(a.created_at))
    .slice(0, 10);

  const summary = data?.summary ?? { pending: 0, active: 0, completed: 0, cancelled: 0 };

  return (
    <>
      {/* Header card */}
      <Card glow="magenta" padding="md">
        <CardHeader className="mb-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-accent-magenta" aria-hidden />
            <CardTitle>REMINDERS</CardTitle>
          </div>
          <Pill tone={summary.active > 0 ? "cyan" : "neutral"} size="sm">
            {summary.active} active
          </Pill>
        </CardHeader>
        <p className="mt-2 text-micro text-fg-muted">
          Read + write surface for the bot ReminderManager · times in ET
        </p>
      </Card>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricTile label="Pending" value={summary.pending} tone="warn" />
        <MetricTile label="Active" value={summary.active} tone="cyan" />
        <MetricTile label="Completed" value={summary.completed} tone="positive" />
        <MetricTile label="Cancelled" value={summary.cancelled} tone="negative" />
      </div>

      {/* Add Reminder card */}
      <Card padding="md">
        <CardHeader className="mb-3">
          <CardTitle className="text-h3">ADD REMINDER</CardTitle>
        </CardHeader>
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase tracking-wider text-fg-muted">Text</span>
            <input
              type="text"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              placeholder="What should TREVOR remind you of?"
              maxLength={500}
              className="tap-target rounded-sm border border-border-subtle bg-bg-elevated px-3 font-mono text-caption text-fg-primary outline-none focus:border-accent-magenta"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase tracking-wider text-fg-muted">Due (ET)</span>
            <input
              type="datetime-local"
              value={addDueAt}
              onChange={(e) => setAddDueAt(e.target.value)}
              className="tap-target rounded-sm border border-border-subtle bg-bg-elevated px-3 font-mono text-caption text-fg-primary outline-none focus:border-accent-magenta"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-micro uppercase tracking-wider text-fg-muted">Repeat</span>
            <div className="grid grid-cols-3 gap-2">
              {(["once", "twice", "until_confirmed"] as const).map((mode) => (
                <HapticButton
                  key={mode}
                  type="button"
                  variant={addRepeat === mode ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setAddRepeat(mode)}
                >
                  {repeatLabel(mode)}
                </HapticButton>
              ))}
            </div>
          </div>
          <HapticButton type="submit" variant="primary" disabled={submitting}>
            <Plus className="mr-1 h-4 w-4" />
            {submitting ? "Adding…" : "Add Reminder"}
          </HapticButton>
          {opError && (
            <p className="text-caption text-accent-red">{opError}</p>
          )}
          {opOkMsg && !opError && (
            <p className="text-caption text-accent-green">{opOkMsg}</p>
          )}
        </form>
      </Card>

      {/* Active reminders */}
      <Card padding="md">
        <CardHeader className="mb-3 flex items-center justify-between">
          <CardTitle className="text-h3">ACTIVE</CardTitle>
          <span className="text-micro text-fg-muted">{active.length} entries</span>
        </CardHeader>
        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : fetchErr ? (
          <EmptyState title="Failed to load reminders" body={fetchErr} />
        ) : active.length === 0 ? (
          <EmptyState title="No active reminders" body="All clear. ✓" />
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((r) => {
              const rel = relativeTime(r.due_at);
              const isEditing = editId === r.id;
              return (
                <li
                  key={r.id}
                  className="rounded-sm border border-border-subtle bg-bg-elevated p-3"
                >
                  {isEditing ? (
                    <div className="flex flex-col gap-3">
                      <input
                        type="text"
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="tap-target rounded-sm border border-border-subtle bg-bg-card px-3 font-mono text-caption text-fg-primary outline-none focus:border-accent-magenta"
                      />
                      <input
                        type="datetime-local"
                        value={editDueAt}
                        onChange={(e) => setEditDueAt(e.target.value)}
                        className="tap-target rounded-sm border border-border-subtle bg-bg-card px-3 font-mono text-caption text-fg-primary outline-none focus:border-accent-magenta"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        {(["once", "twice", "until_confirmed"] as const).map((mode) => (
                          <HapticButton
                            key={mode}
                            type="button"
                            variant={editRepeat === mode ? "primary" : "ghost"}
                            size="sm"
                            onClick={() => setEditRepeat(mode)}
                          >
                            {repeatLabel(mode)}
                          </HapticButton>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <HapticButton
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => saveEdit(r.id)}
                          disabled={submitting}
                          className="flex-1"
                        >
                          <Save className="mr-1 h-4 w-4" /> Save
                        </HapticButton>
                        <HapticButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={cancelEdit}
                          disabled={submitting}
                          className="flex-1"
                        >
                          Cancel
                        </HapticButton>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="font-mono text-caption text-fg-primary break-words">
                        {r.text}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-micro text-fg-muted">
                        <span>{formatISOAsET(r.due_at)}</span>
                        <span aria-hidden>·</span>
                        <span className={rel.overdue ? "text-accent-red" : "text-fg-muted"}>
                          {rel.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone="violet" size="sm">
                          <Repeat className="h-3 w-3" /> {repeatLabel(r.repeat_mode)}
                        </Pill>
                        <Pill tone={statusTone(r.status)} size="sm">
                          {String(r.status).toUpperCase()}
                        </Pill>
                        {r.repeat_mode === "until_confirmed" && r.times_fired > 0 && (
                          <Pill tone="amber" size="sm">
                            fired ×{r.times_fired}
                          </Pill>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <HapticButton
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => postAction({ action: "complete", id: r.id })}
                          disabled={submitting}
                        >
                          <Check className="mr-1 h-4 w-4" /> Done
                        </HapticButton>
                        <HapticButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(r)}
                          disabled={submitting}
                        >
                          <Pencil className="mr-1 h-4 w-4" /> Edit
                        </HapticButton>
                        <HapticButton
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => postAction({ action: "cancel", id: r.id })}
                          disabled={submitting}
                        >
                          <X className="mr-1 h-4 w-4" /> Cancel
                        </HapticButton>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Completed / cancelled */}
      <CollapsibleSection
        title={`COMPLETED & CANCELLED (${closed.length})`}
        defaultOpen={false}
      >
        {closed.length === 0 ? (
          <EmptyState title="Nothing closed yet" body="History will appear here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {closed.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 rounded-sm border border-border-subtle bg-bg-elevated/50 p-3 opacity-80"
              >
                <p className="font-mono text-caption text-fg-primary line-through decoration-fg-faint break-words">
                  {r.text}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-micro text-fg-muted">
                  <Pill tone={statusTone(r.status)} size="sm">
                    {String(r.status).toUpperCase()}
                  </Pill>
                  <span>due {formatISOAsET(r.due_at)}</span>
                  {r.completed_at && (
                    <span>· closed {formatISOAsET(r.completed_at)}</span>
                  )}
                  <HapticButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => postAction({ action: "complete", id: r.id })}
                    disabled={submitting}
                    className="ml-auto"
                    aria-label="Reopen / mark complete"
                    title="Mark complete"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </HapticButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </>
  );
}
