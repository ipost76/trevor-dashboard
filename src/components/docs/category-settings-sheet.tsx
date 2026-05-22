"use client";
import * as React from "react";
import { BottomSheet, HapticButton, Pill } from "@/components/ui";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { UNCATEGORIZED_KEY, type DocsCategory } from "./category-tabs";

/**
 * CategorySettingsSheet — Wave B2 (reorder added 2026-05-22).
 *
 * Modal surface for category CRUD: create, rename, delete, reorder. Reached
 * from the ⚙️ gear icon on the DOWNLOADS header. Reorder is implemented as
 * UP/DOWN arrow buttons rather than HTML5 drag — works native on touch (iOS
 * Safari) and screen readers, no drag-and-drop dependency added.
 *
 * Wiring:
 * - Parent owns the categories list + counts. This component fires
 *   `onCategoriesChanged()` after every successful mutation; the parent then
 *   re-fetches `/api/docs/categories` and `/api/intel/downloads?status=…` so
 *   the tab strip, file list, and Move-to sheet all reflect the new state.
 * - Uncategorized is rendered last and is locked (no rename, no delete, no
 *   reorder — it is not an API category).
 * - Reorder uses optimistic local state during the API round-trip so the row
 *   moves immediately on tap; snaps back on failure.
 * - Delete confirm uses the same inline two-tap pattern as the file card's
 *   Delete button — no nested modal.
 */

interface CategorySettingsSheetProps {
  open: boolean;
  onClose: () => void;
  categories: ReadonlyArray<DocsCategory>;
  /** Per-category file counts (plus UNCATEGORIZED_KEY). Sourced from the listing. */
  counts: Readonly<Record<string, number>>;
  /** Called after any successful create / rename / delete so the parent can refetch. */
  onCategoriesChanged: () => void;
}

interface RowPhase {
  // Rename in-flight or armed-edit (input visible)
  editing?: boolean;
  editValue?: string;
  saving?: boolean;
  // Two-tap delete (idle → confirm 3 s → fire)
  deletePhase?: "idle" | "confirm" | "deleting" | "error";
  // Last error message — surfaced as a small red note under the row
  error?: string;
}

export function CategorySettingsSheet({
  open,
  onClose,
  categories,
  counts,
  onCategoriesChanged,
}: CategorySettingsSheetProps) {
  const [rows, setRows] = React.useState<Record<string, RowPhase>>({});
  const [adding, setAdding] = React.useState(false);
  const [addValue, setAddValue] = React.useState("");
  const [addSaving, setAddSaving] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);
  // Optimistic reorder: when the user taps ↑/↓, this holds the new id order
  // until the API responds. Null means "use server-side sort_order".
  const [optimisticOrder, setOptimisticOrder] = React.useState<string[] | null>(null);
  const [reordering, setReordering] = React.useState(false);
  const [reorderError, setReorderError] = React.useState<string | null>(null);

  // Reset transient state every time the sheet opens — avoids a stale "Confirm"
  // or in-flight edit leaking from a previous open.
  React.useEffect(() => {
    if (!open) return;
    setRows({});
    setAdding(false);
    setAddValue("");
    setAddError(null);
    setOptimisticOrder(null);
    setReorderError(null);
  }, [open]);

  // Auto-revert any "confirm"/"error" delete phase after a timeout so the row
  // doesn't sit armed forever.
  const deleteTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    return () => {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
    };
  }, []);

  const setRow = (id: string, patch: Partial<RowPhase>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const clearRow = (id: string) =>
    setRows((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  // ── Rename ─────────────────────────────────────────────────────────────────

  const startEdit = (cat: DocsCategory) =>
    setRow(cat.id, { editing: true, editValue: cat.name, error: undefined });

  const cancelEdit = (id: string) =>
    setRow(id, { editing: false, editValue: undefined, error: undefined });

  const submitRename = async (cat: DocsCategory) => {
    const next = rows[cat.id]?.editValue?.trim() ?? "";
    if (!next || next === cat.name) {
      cancelEdit(cat.id);
      return;
    }
    setRow(cat.id, { saving: true, error: undefined });
    try {
      const res = await fetch(
        `/api/docs/categories/${encodeURIComponent(cat.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || json.success === false) {
        setRow(cat.id, {
          saving: false,
          error: json.error ?? `Rename failed (${res.status})`,
        });
        return;
      }
      clearRow(cat.id);
      onCategoriesChanged();
    } catch (e) {
      setRow(cat.id, {
        saving: false,
        error: e instanceof Error ? e.message : "Rename failed",
      });
    }
  };

  // ── Delete (inline two-tap confirm) ────────────────────────────────────────

  const armDelete = (id: string) => {
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setRow(id, { deletePhase: "confirm", error: undefined });
    deleteTimer.current = setTimeout(() => {
      setRows((prev) => {
        if (prev[id]?.deletePhase !== "confirm") return prev;
        const next = { ...prev };
        next[id] = { ...next[id], deletePhase: "idle" };
        return next;
      });
    }, 3000);
  };

  const fireDelete = async (cat: DocsCategory) => {
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setRow(cat.id, { deletePhase: "deleting", error: undefined });
    try {
      const res = await fetch(
        `/api/docs/categories/${encodeURIComponent(cat.id)}`,
        { method: "DELETE" },
      );
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || json.success === false) {
        setRow(cat.id, {
          deletePhase: "error",
          error: json.error ?? `Delete failed (${res.status})`,
        });
        deleteTimer.current = setTimeout(() => {
          setRows((prev) => {
            if (prev[cat.id]?.deletePhase !== "error") return prev;
            const next = { ...prev };
            next[cat.id] = { ...next[cat.id], deletePhase: "idle" };
            return next;
          });
        }, 2000);
        return;
      }
      // Success — parent re-fetches; the row will vanish on next render.
      clearRow(cat.id);
      onCategoriesChanged();
    } catch (e) {
      setRow(cat.id, {
        deletePhase: "error",
        error: e instanceof Error ? e.message : "Delete failed",
      });
    }
  };

  // ── Create ─────────────────────────────────────────────────────────────────

  const startAdd = () => {
    setAdding(true);
    setAddValue("");
    setAddError(null);
  };
  const cancelAdd = () => {
    setAdding(false);
    setAddValue("");
    setAddError(null);
  };
  const submitAdd = async () => {
    const name = addValue.trim();
    if (!name) {
      cancelAdd();
      return;
    }
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await fetch("/api/docs/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || json.success === false) {
        setAddError(json.error ?? `Create failed (${res.status})`);
        return;
      }
      setAdding(false);
      setAddValue("");
      onCategoriesChanged();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setAddSaving(false);
    }
  };

  // Sorted categories for display (sort_order), Uncategorized appended.
  const sorted = React.useMemo(
    () => [...categories].sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  );

  // Apply any in-flight optimistic reorder over the server-sorted list.
  // If the server-side set of ids has changed (e.g. add/delete during reorder),
  // fall back to the server order — the optimistic snapshot is stale.
  const displayCategories = React.useMemo(() => {
    if (!optimisticOrder) return sorted;
    const byId = new Map(sorted.map((c) => [c.id, c]));
    const serverIds = new Set(byId.keys());
    if (
      optimisticOrder.length !== serverIds.size ||
      !optimisticOrder.every((id) => serverIds.has(id))
    ) {
      return sorted;
    }
    return optimisticOrder.map((id) => byId.get(id)!).filter(Boolean);
  }, [sorted, optimisticOrder]);

  // Submit a reorder. Builds the full id list from the current display order
  // with one row moved by `delta` (-1 = up, +1 = down).
  const submitReorder = async (catId: string, delta: -1 | 1) => {
    if (reordering) return;
    const currentIds = displayCategories.map((c) => c.id);
    const idx = currentIds.indexOf(catId);
    const targetIdx = idx + delta;
    if (idx < 0 || targetIdx < 0 || targetIdx >= currentIds.length) return;
    const nextIds = [...currentIds];
    [nextIds[idx], nextIds[targetIdx]] = [nextIds[targetIdx], nextIds[idx]];
    setOptimisticOrder(nextIds);
    setReordering(true);
    setReorderError(null);
    try {
      const res = await fetch("/api/docs/categories/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category_ids: nextIds }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
      };
      if (!res.ok || json.success === false) {
        setOptimisticOrder(null);
        setReorderError(json.error ?? `Reorder failed (${res.status})`);
        return;
      }
      onCategoriesChanged();
      // Keep optimisticOrder in place until the parent's refetch lands and
      // categories prop reflects the new sort_order — at which point the
      // `displayCategories` memo's id-set match keeps the order stable.
      // Then clear on next prop change via the effect below.
    } catch (e) {
      setOptimisticOrder(null);
      setReorderError(e instanceof Error ? e.message : "Reorder failed");
    } finally {
      setReordering(false);
    }
  };

  // Clear the optimistic snapshot once the server-side sort_order catches up
  // (i.e. when the categories prop's sort_order order matches our optimistic
  // order). Avoids holding stale optimistic state after a successful reorder.
  React.useEffect(() => {
    if (!optimisticOrder) return;
    const serverOrder = sorted.map((c) => c.id);
    if (
      serverOrder.length === optimisticOrder.length &&
      serverOrder.every((id, i) => id === optimisticOrder[i])
    ) {
      setOptimisticOrder(null);
    }
  }, [sorted, optimisticOrder]);

  return (
    <BottomSheet open={open} onClose={onClose} title="MANAGE CATEGORIES">
      <div className="space-y-3">
        {reorderError && (
          <div
            role="alert"
            className="rounded border border-accent-red/40 bg-accent-red/10 px-2 py-1 text-micro text-accent-red"
          >
            {reorderError}
          </div>
        )}
        {/* Category rows */}
        <ul className="space-y-2" role="list">
          {displayCategories.map((cat, idx) => {
            const row = rows[cat.id] ?? {};
            const count = counts[cat.id] ?? 0;
            const isEditing = row.editing === true;
            const isSaving = row.saving === true;
            const phase = row.deletePhase ?? "idle";
            const canMoveUp = idx > 0;
            const canMoveDown = idx < displayCategories.length - 1;
            return (
              <li
                key={cat.id}
                className="rounded-md border border-border-subtle bg-bg-elevated/30 p-2"
              >
                <div className="flex items-center gap-2">
                  {isEditing ? null : (
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <HapticButton
                        variant="ghost"
                        size="sm"
                        disabled={!canMoveUp || reordering}
                        onClick={() => void submitReorder(cat.id, -1)}
                        aria-label={`Move ${cat.name} up`}
                        className="border border-border-subtle bg-bg-elevated/30 px-1.5 py-0.5 text-fg-muted hover:text-accent-cyan-soft-strong disabled:opacity-30"
                      >
                        <ArrowUp size={12} />
                      </HapticButton>
                      <HapticButton
                        variant="ghost"
                        size="sm"
                        disabled={!canMoveDown || reordering}
                        onClick={() => void submitReorder(cat.id, 1)}
                        aria-label={`Move ${cat.name} down`}
                        className="border border-border-subtle bg-bg-elevated/30 px-1.5 py-0.5 text-fg-muted hover:text-accent-cyan-soft-strong disabled:opacity-30"
                      >
                        <ArrowDown size={12} />
                      </HapticButton>
                    </div>
                  )}
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        value={row.editValue ?? ""}
                        onChange={(e) =>
                          setRow(cat.id, { editValue: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void submitRename(cat);
                          } else if (e.key === "Escape") {
                            cancelEdit(cat.id);
                          }
                        }}
                        autoFocus
                        disabled={isSaving}
                        aria-label={`Rename ${cat.name}`}
                        className="min-w-0 flex-1 rounded border border-accent-cyan-soft/40 bg-bg-card px-2 py-1 font-mono text-caption text-fg-primary outline-none focus:border-accent-cyan-soft focus:shadow-glow-focus"
                      />
                      <HapticButton
                        variant="ghost"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => void submitRename(cat)}
                        aria-label={`Save rename of ${cat.name}`}
                        className="border border-accent-green/30 bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
                      >
                        <Check size={14} />
                      </HapticButton>
                      <HapticButton
                        variant="ghost"
                        size="sm"
                        disabled={isSaving}
                        onClick={() => cancelEdit(cat.id)}
                        aria-label="Cancel rename"
                        className="border border-border-subtle bg-bg-elevated/30 text-fg-muted hover:text-fg-primary"
                      >
                        <X size={14} />
                      </HapticButton>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(cat)}
                        aria-label={`Edit ${cat.name}`}
                        className="tap-target group flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-bg-elevated/60"
                      >
                        <span className="truncate font-mono text-caption text-fg-primary">
                          {cat.name}
                        </span>
                        <Pencil
                          size={12}
                          className="shrink-0 text-fg-faint opacity-0 group-hover:opacity-100"
                          aria-hidden
                        />
                      </button>
                      <Pill tone="neutral" size="sm">
                        {count}
                      </Pill>
                      <HapticButton
                        variant="ghost"
                        size="sm"
                        disabled={phase === "deleting"}
                        onClick={() => {
                          if (phase === "confirm") void fireDelete(cat);
                          else armDelete(cat.id);
                        }}
                        aria-label={
                          phase === "confirm"
                            ? `Confirm delete of ${cat.name}; ${count} files will move to Uncategorized`
                            : `Delete ${cat.name}`
                        }
                        className={
                          phase === "confirm"
                            ? "animate-pulse border border-accent-red/60 bg-accent-red/25 text-accent-red hover:bg-accent-red/35"
                            : phase === "error"
                              ? "border border-accent-red/30 bg-accent-red/10 text-fg-muted"
                              : "border border-accent-red/30 bg-accent-red/10 text-accent-red hover:bg-accent-red/20 disabled:opacity-50"
                        }
                      >
                        <Trash2 size={14} />
                        {phase === "deleting"
                          ? "..."
                          : phase === "confirm"
                            ? `Confirm (${count}→Uncat)`
                            : phase === "error"
                              ? "Failed"
                              : "Delete"}
                      </HapticButton>
                    </>
                  )}
                </div>
                {row.error && (
                  <div className="mt-1 px-1 text-micro text-accent-red">
                    {row.error}
                  </div>
                )}
              </li>
            );
          })}

          {/* Uncategorized — locked system row */}
          <li
            key={UNCATEGORIZED_KEY}
            className="rounded-md border border-dashed border-border-subtle bg-bg-elevated/10 p-2 opacity-70"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-caption text-fg-muted">
                Uncategorized
              </span>
              <Pill tone="neutral" size="sm">
                {counts[UNCATEGORIZED_KEY] ?? 0}
              </Pill>
              <span
                className="text-micro text-fg-faint"
                aria-label="System category — not editable"
              >
                system
              </span>
            </div>
          </li>
        </ul>

        {/* Add new category */}
        <div className="border-t border-border-subtle pt-3">
          {adding ? (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitAdd();
                    } else if (e.key === "Escape") {
                      cancelAdd();
                    }
                  }}
                  autoFocus
                  disabled={addSaving}
                  placeholder="New category name"
                  aria-label="New category name"
                  className="min-w-0 flex-1 rounded border border-accent-cyan-soft/40 bg-bg-card px-2 py-1 font-mono text-caption text-fg-primary outline-none focus:border-accent-cyan-soft focus:shadow-glow-focus"
                />
                <HapticButton
                  variant="ghost"
                  size="sm"
                  disabled={addSaving || !addValue.trim()}
                  onClick={() => void submitAdd()}
                  aria-label="Create category"
                  className="border border-accent-green/30 bg-accent-green/10 text-accent-green hover:bg-accent-green/20 disabled:opacity-50"
                >
                  <Check size={14} />
                  {addSaving ? "..." : "Add"}
                </HapticButton>
                <HapticButton
                  variant="ghost"
                  size="sm"
                  disabled={addSaving}
                  onClick={cancelAdd}
                  aria-label="Cancel add category"
                  className="border border-border-subtle bg-bg-elevated/30 text-fg-muted hover:text-fg-primary"
                >
                  <X size={14} />
                </HapticButton>
              </div>
              {addError && (
                <div className="px-1 text-micro text-accent-red">
                  {addError}
                </div>
              )}
            </div>
          ) : (
            <HapticButton
              variant="ghost"
              size="sm"
              onClick={startAdd}
              aria-label="Add a new category"
              className="w-full border border-accent-cyan-soft/30 bg-accent-cyan-soft/10 text-accent-cyan-soft-strong hover:bg-accent-cyan-soft/20"
            >
              <Plus size={14} />
              Add Category
            </HapticButton>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
