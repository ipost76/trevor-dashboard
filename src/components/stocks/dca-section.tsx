"use client";
import * as React from "react";
import {
  DollarSign,
  Plus,
  Pencil,
  Save,
  Trash2,
  PauseCircle,
  PlayCircle,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  MetricTile,
  Pill,
  EmptyState,
  HapticButton,
  BottomSheet,
  CollapsibleSection,
  Skeleton,
} from "@/components/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Frequency = "daily" | "weekly" | "biweekly" | "monthly";
type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

interface DCAEntry {
  // Mirrors dca_schedule row shape per dca_manager.get_all().
  // active=1 active, active=0 paused.
  id?: number;
  ticker: string;
  amount: number;
  frequency: string;
  day_of_week: string | null;
  notes: string | null;
  active?: number;
  last_reminded_at?: string | null;
  created_at?: string;
  updated_at?: string;
  [k: string]: unknown;
}

interface DCAResponse {
  entries: DCAEntry[];
  summary: {
    total_active: number;
    total_paused: number;
    daily_total: number;
    monthly_estimate: number;
  };
  error?: string;
}

const FREQUENCIES: Frequency[] = ["daily", "weekly", "biweekly", "monthly"];
const DAYS: Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const ET_TZ = "America/New_York";

function formatISOAsET(iso: string | null | undefined): string {
  if (!iso) return "never";
  try {
    const ds = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
    const d = new Date(ds);
    if (Number.isNaN(d.getTime())) return iso || "—";
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
    return iso ?? "—";
  }
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  try {
    const ds = iso.includes("T") ? iso : iso.replace(" ", "T") + "Z";
    const t = new Date(ds).getTime();
    if (Number.isNaN(t)) return iso || "—";
    const ago = Date.now() - t;
    const mins = Math.round(ago / 60_000);
    const hours = Math.round(ago / 3_600_000);
    const days = Math.round(ago / 86_400_000);
    if (ago < 0) return "scheduled";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return iso ?? "—";
  }
}

function freqLabel(freq: string): string {
  if (freq === "daily") return "Daily";
  if (freq === "weekly") return "Weekly";
  if (freq === "biweekly") return "Bi-weekly";
  if (freq === "monthly") return "Monthly";
  return freq;
}

function isPaused(e: DCAEntry): boolean {
  // dca_schedule.active: 1 = active, 0 = paused. Default treats missing as active.
  return Number(e.active ?? 1) === 0;
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function DCASection() {
  const [data, setData] = React.useState<DCAResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [fetchErr, setFetchErr] = React.useState<string | null>(null);

  // Add-form
  const [addTicker, setAddTicker] = React.useState("");
  const [addAmount, setAddAmount] = React.useState("");
  const [addFreq, setAddFreq] = React.useState<Frequency>("daily");
  const [addDay, setAddDay] = React.useState<Day>("MON");
  const [addNotes, setAddNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [opError, setOpError] = React.useState<string | null>(null);
  const [opOkMsg, setOpOkMsg] = React.useState<string | null>(null);

  // Edit-form
  const [editTicker, setEditTicker] = React.useState<string | null>(null);
  const [editAmount, setEditAmount] = React.useState("");
  const [editFreq, setEditFreq] = React.useState<Frequency>("daily");
  const [editDay, setEditDay] = React.useState<Day>("MON");
  const [editNotes, setEditNotes] = React.useState("");

  // Remove-confirm
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/dca", { cache: "no-store" });
      const json: DCAResponse = await res.json();
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
      const res = await fetch("/api/dca", {
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

  const showDay = addFreq === "weekly" || addFreq === "biweekly";
  const editShowDay = editFreq === "weekly" || editFreq === "biweekly";

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const ticker = addTicker.trim().toUpperCase();
    const amount = parseFloat(addAmount);
    if (!ticker) {
      setOpError("Ticker required");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setOpError("Amount must be > 0");
      return;
    }
    const payload: Record<string, unknown> = {
      action: "add",
      ticker,
      amount,
      frequency: addFreq,
      notes: addNotes.trim(),
    };
    if (showDay) payload.day_of_week = addDay;
    const ok = await postAction(payload);
    if (ok) {
      setAddTicker("");
      setAddAmount("");
      setAddFreq("daily");
      setAddDay("MON");
      setAddNotes("");
      setOpOkMsg(`Added ${ticker}`);
    }
  }

  function startEdit(e: DCAEntry) {
    setEditTicker(e.ticker);
    setEditAmount(String(e.amount));
    setEditFreq((e.frequency as Frequency) || "daily");
    setEditDay(((e.day_of_week as Day) ?? "MON"));
    setEditNotes(e.notes ?? "");
  }

  function cancelEdit() {
    setEditTicker(null);
    setEditAmount("");
    setEditFreq("daily");
    setEditDay("MON");
    setEditNotes("");
  }

  async function saveEdit(ticker: string) {
    const amount = parseFloat(editAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setOpError("Amount must be > 0");
      return;
    }
    const payload: Record<string, unknown> = {
      action: "edit",
      ticker,
      amount,
      frequency: editFreq,
      notes: editNotes.trim(),
    };
    payload.day_of_week = editShowDay ? editDay : null;
    const ok = await postAction(payload);
    if (ok) {
      cancelEdit();
      setOpOkMsg(`Updated ${ticker}`);
    }
  }

  async function confirmRemoveNow() {
    if (!confirmRemove) return;
    const ticker = confirmRemove;
    const ok = await postAction({ action: "remove", ticker });
    if (ok) {
      setOpOkMsg(`Removed ${ticker}`);
    }
    setConfirmRemove(null);
  }

  const entries = data?.entries ?? [];
  const active = entries.filter((e) => !isPaused(e));
  const paused = entries.filter((e) => isPaused(e));

  const summary =
    data?.summary ?? {
      total_active: 0,
      total_paused: 0,
      daily_total: 0,
      monthly_estimate: 0,
    };

  return (
    <>
      {/* Header card */}
      <Card padding="md" className="card-elevated">
        <CardHeader className="mb-0 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-accent-plum" aria-hidden />
            <CardTitle>DCA SCHEDULE</CardTitle>
          </div>
          <Pill intent={summary.total_active > 0 ? "active" : undefined} tone={summary.total_active > 0 ? undefined : "neutral"} size="sm">
            {summary.total_active} active
          </Pill>
        </CardHeader>
        <p className="mt-2 font-sans text-micro text-fg-muted">
          Robinhood · 9:00 PM ET daily fire window
        </p>
      </Card>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <MetricTile label="Active" value={summary.total_active} tone="positive" />
        <MetricTile
          label="Daily Total"
          value={fmtMoney(summary.daily_total)}
          tone="cyan"
        />
        <MetricTile
          label="Monthly Est"
          value={fmtMoney(summary.monthly_estimate)}
          tone="cyan"
        />
      </div>

      {/* Add Entry card */}
      <Card padding="md">
        <CardHeader className="mb-3">
          <CardTitle className="text-h3">ADD TO SCHEDULE</CardTitle>
        </CardHeader>
        <form onSubmit={handleAdd} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wider text-fg-muted">
                Ticker
              </span>
              <input
                type="text"
                value={addTicker}
                onChange={(e) => setAddTicker(e.target.value.toUpperCase())}
                placeholder="BTC"
                maxLength={20}
                className="tap-target rounded-sm border border-border-subtle bg-bg-elevated px-3 font-mono text-caption uppercase text-fg-primary outline-none focus:border-accent-cyan-soft"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wider text-fg-muted">
                Amount ($)
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={addAmount}
                onChange={(e) => setAddAmount(e.target.value)}
                placeholder="25.00"
                className="tap-target rounded-sm border border-border-subtle bg-bg-elevated px-3 font-mono text-caption text-fg-primary outline-none focus:border-accent-cyan-soft"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-micro uppercase tracking-wider text-fg-muted">
              Frequency
            </span>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {FREQUENCIES.map((f) => (
                <HapticButton
                  key={f}
                  type="button"
                  variant={addFreq === f ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => setAddFreq(f)}
                >
                  {freqLabel(f)}
                </HapticButton>
              ))}
            </div>
          </div>

          {showDay && (
            <div className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wider text-fg-muted">
                Day
              </span>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((d) => (
                  <HapticButton
                    key={d}
                    type="button"
                    variant={addDay === d ? "primary" : "ghost"}
                    size="sm"
                    onClick={() => setAddDay(d)}
                    className="px-1 text-micro"
                  >
                    {d}
                  </HapticButton>
                ))}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-micro uppercase tracking-wider text-fg-muted">
              Notes (optional)
            </span>
            <input
              type="text"
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              placeholder="e.g. core position"
              maxLength={200}
              className="tap-target rounded-sm border border-border-subtle bg-bg-elevated px-3 font-mono text-caption text-fg-primary outline-none focus:border-accent-cyan-soft"
            />
          </label>

          <HapticButton type="submit" variant="primary" disabled={submitting}>
            <Plus className="mr-1 h-4 w-4" />
            {submitting ? "Adding…" : "Add to Schedule"}
          </HapticButton>
          {opError && <p className="text-caption text-accent-red">{opError}</p>}
          {opOkMsg && !opError && (
            <p className="text-caption text-accent-green">{opOkMsg}</p>
          )}
        </form>
      </Card>

      {/* Active entries */}
      <Card padding="md">
        <CardHeader className="mb-3 flex items-center justify-between">
          <CardTitle className="text-h3">ACTIVE</CardTitle>
          <span className="text-micro text-fg-muted">{active.length} entries</span>
        </CardHeader>
        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : fetchErr ? (
          <EmptyState title="Failed to load DCA schedule" body={fetchErr} />
        ) : entries.length === 0 ? (
          <EmptyState title="No DCA entries yet" body="Add tickers to build your schedule." />
        ) : active.length === 0 ? (
          <EmptyState title="No active entries" body="All entries paused — see below." />
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((e) => {
              const isEditing = editTicker === e.ticker;
              return (
                <li
                  key={e.ticker}
                  className="rounded-sm border border-border-subtle bg-bg-elevated p-3"
                >
                  {isEditing ? (
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={e.ticker}
                          disabled
                          className="tap-target rounded-sm border border-border-subtle bg-bg-card px-3 font-mono text-caption uppercase text-fg-muted outline-none"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editAmount}
                          onChange={(ev) => setEditAmount(ev.target.value)}
                          className="tap-target rounded-sm border border-border-subtle bg-bg-card px-3 font-mono text-caption text-fg-primary outline-none focus:border-accent-cyan-soft"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        {FREQUENCIES.map((f) => (
                          <HapticButton
                            key={f}
                            type="button"
                            variant={editFreq === f ? "primary" : "ghost"}
                            size="sm"
                            onClick={() => setEditFreq(f)}
                          >
                            {freqLabel(f)}
                          </HapticButton>
                        ))}
                      </div>
                      {editShowDay && (
                        <div className="grid grid-cols-7 gap-1.5">
                          {DAYS.map((d) => (
                            <HapticButton
                              key={d}
                              type="button"
                              variant={editDay === d ? "primary" : "ghost"}
                              size="sm"
                              onClick={() => setEditDay(d)}
                              className="px-1 text-micro"
                            >
                              {d}
                            </HapticButton>
                          ))}
                        </div>
                      )}
                      <input
                        type="text"
                        value={editNotes}
                        onChange={(ev) => setEditNotes(ev.target.value)}
                        placeholder="Notes"
                        maxLength={200}
                        className="tap-target rounded-sm border border-border-subtle bg-bg-card px-3 font-mono text-caption text-fg-primary outline-none focus:border-accent-cyan-soft"
                      />
                      <div className="flex gap-2">
                        <HapticButton
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => saveEdit(e.ticker)}
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
                      <div className="flex flex-wrap items-baseline gap-3">
                        <span className="font-mono text-h3 font-bold text-fg-primary">
                          {e.ticker}
                        </span>
                        <span className="font-mono text-caption text-accent-green">
                          {fmtMoney(Number(e.amount) || 0)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone="violet" size="sm">
                          {freqLabel(e.frequency)}
                        </Pill>
                        {e.day_of_week && (
                          <Pill tone="cyan" size="sm">
                            {String(e.day_of_week).toUpperCase()}
                          </Pill>
                        )}
                      </div>
                      {e.notes && (
                        <p className="text-micro text-fg-muted break-words">{e.notes}</p>
                      )}
                      <p className="text-micro text-fg-faint">
                        Last reminded: {relativeTime(e.last_reminded_at as string | null)}
                      </p>
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        <HapticButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => postAction({ action: "pause", ticker: e.ticker })}
                          disabled={submitting}
                        >
                          <PauseCircle className="mr-1 h-4 w-4 text-accent-amber" /> Pause
                        </HapticButton>
                        <HapticButton
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(e)}
                          disabled={submitting}
                        >
                          <Pencil className="mr-1 h-4 w-4" /> Edit
                        </HapticButton>
                        <HapticButton
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setConfirmRemove(e.ticker)}
                          disabled={submitting}
                        >
                          <Trash2 className="mr-1 h-4 w-4" /> Remove
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

      {/* Paused entries */}
      {paused.length > 0 && (
        <CollapsibleSection
          title={`PAUSED (${paused.length})`}
          defaultOpen={false}
        >
          <ul className="flex flex-col gap-2">
            {paused.map((e) => (
              <li
                key={e.ticker}
                className="flex flex-col gap-2 rounded-sm border border-border-subtle bg-bg-elevated/50 p-3 opacity-70"
              >
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="font-mono text-caption font-bold text-fg-primary">
                    {e.ticker}
                  </span>
                  <span className="font-mono text-caption text-fg-muted">
                    {fmtMoney(Number(e.amount) || 0)}
                  </span>
                  <Pill tone="amber" size="sm">
                    PAUSED
                  </Pill>
                </div>
                {e.notes && (
                  <p className="text-micro text-fg-muted break-words">{e.notes}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <HapticButton
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => postAction({ action: "resume", ticker: e.ticker })}
                    disabled={submitting}
                  >
                    <PlayCircle className="mr-1 h-4 w-4" /> Resume
                  </HapticButton>
                  <HapticButton
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmRemove(e.ticker)}
                    disabled={submitting}
                  >
                    <Trash2 className="mr-1 h-4 w-4" /> Remove
                  </HapticButton>
                </div>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Remove confirmation BottomSheet */}
      <BottomSheet
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        title="Remove DCA entry?"
      >
        <div className="flex flex-col gap-4 p-4">
          <p className="font-mono text-body text-fg-primary">
            Remove <span className="text-accent-plum">{confirmRemove}</span> from
            DCA schedule?
          </p>
          <p className="text-caption text-fg-muted">
            The bot will stop sending the daily 9 PM ET reminder for this ticker.
            Existing positions in Robinhood are not touched.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <HapticButton
              type="button"
              variant="ghost"
              onClick={() => setConfirmRemove(null)}
              disabled={submitting}
            >
              Cancel
            </HapticButton>
            <HapticButton
              type="button"
              variant="destructive"
              onClick={confirmRemoveNow}
              disabled={submitting}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {submitting ? "Removing…" : "Remove"}
            </HapticButton>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
