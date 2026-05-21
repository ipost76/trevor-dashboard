"use client";
import * as React from "react";
import { BottomSheet, HapticButton } from "@/components/ui";
import { Check, FolderInput } from "lucide-react";
import { UNCATEGORIZED_KEY, type DocsCategory } from "./category-tabs";

/**
 * MoveToSheet — Wave B2.
 *
 * Per-file category reassignment. Opened from the MOVE button on each file
 * card; the parent <DownloadsSection> owns the sheet (one instance, opened
 * for whichever file was tapped) and the API call. This component is purely
 * presentational + interaction — it renders a list of tappable category rows
 * inside the shared <BottomSheet> primitive and surfaces per-row in-flight /
 * error state.
 *
 * Interaction:
 * - Tap a category row → calls `onMove(filename, category_id)`. The row goes
 *   to "..." until onMove resolves. true → sheet closes (parent refetches the
 *   listing → card drops from the current tab, badges recompute). false →
 *   "Failed" surfaces inline for 2 s then reverts; sheet stays open.
 * - Tap the current category → no-op, sheet closes (matches the "moving to
 *   the same category" edge case in the spec).
 * - Uncategorized is always rendered last with `category_id = null`.
 */

interface MoveToSheetProps {
  open: boolean;
  onClose: () => void;
  /** The file being moved. `null` collapses the sheet (BottomSheet hides on !open). */
  file: { filename: string; category_id: string | null } | null;
  /** Available destination folders (sort_order). */
  categories: ReadonlyArray<DocsCategory>;
  /** Move handler. Resolves true on success (parent refetches). */
  onMove: (filename: string, category_id: string | null) => Promise<boolean>;
}

interface RowState {
  phase: "idle" | "pending" | "error";
}

export function MoveToSheet({
  open,
  onClose,
  file,
  categories,
  onMove,
}: MoveToSheetProps) {
  // Per-row phase keyed by destination id (string for category, UNCATEGORIZED_KEY
  // for null). Reset whenever the sheet opens for a new file so a previous
  // "Failed" badge can't leak across files.
  const [rowState, setRowState] = React.useState<Record<string, RowState>>({});
  const errorTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setRowState({});
  }, [file?.filename]);

  React.useEffect(() => {
    return () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, []);

  // Sort + append Uncategorized — same ordering rule the CategoryTabs strip uses.
  const rows = React.useMemo(() => {
    const sorted = [...categories]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({
        key: c.id,
        label: c.name,
        category_id: c.id as string | null,
      }));
    return [
      ...sorted,
      {
        key: UNCATEGORIZED_KEY,
        label: "Uncategorized",
        category_id: null as string | null,
      },
    ];
  }, [categories]);

  const handleSelect = async (
    key: string,
    targetCategoryId: string | null,
  ) => {
    if (!file) return;
    const currentKey = file.category_id ?? UNCATEGORIZED_KEY;
    // Moving to the same category is a no-op per spec — just close.
    if (key === currentKey) {
      onClose();
      return;
    }
    if (rowState[key]?.phase === "pending") return;
    setRowState((prev) => ({ ...prev, [key]: { phase: "pending" } }));
    const ok = await onMove(file.filename, targetCategoryId);
    if (ok) {
      // Parent handles the refetch + count update. Close the sheet.
      onClose();
      return;
    }
    setRowState((prev) => ({ ...prev, [key]: { phase: "error" } }));
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => {
      setRowState((prev) => {
        if (prev[key]?.phase !== "error") return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 2000);
  };

  const currentKey = file?.category_id ?? UNCATEGORIZED_KEY;

  return (
    <BottomSheet open={open && file !== null} onClose={onClose} title="MOVE TO">
      {file && (
        <div className="space-y-3">
          {/* File context — break-all so long filenames wrap, not overflow */}
          <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-bg-elevated/40 px-3 py-2">
            <FolderInput
              size={14}
              className="mt-0.5 shrink-0 text-accent-plum"
              aria-hidden
            />
            <span className="break-all font-mono text-caption text-fg-primary">
              {file.filename}
            </span>
          </div>

          {/* Category list */}
          <ul className="space-y-1.5" role="list">
            {rows.map((row) => {
              const isCurrent = row.key === currentKey;
              const state = rowState[row.key];
              const isPending = state?.phase === "pending";
              const isError = state?.phase === "error";
              return (
                <li key={row.key}>
                  <HapticButton
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleSelect(row.key, row.category_id)}
                    disabled={isPending}
                    aria-label={
                      isCurrent
                        ? `${row.label} (current category)`
                        : `Move to ${row.label}`
                    }
                    aria-current={isCurrent ? "true" : undefined}
                    className={[
                      "flex w-full items-center justify-between gap-3 border px-3 py-2 text-left",
                      isCurrent
                        ? "border-accent-cyan-soft/40 bg-accent-cyan-soft/10 text-accent-cyan-soft-strong"
                        : isError
                          ? "border-accent-red/40 bg-accent-red/10 text-accent-red"
                          : "border-border-subtle bg-bg-elevated/30 text-fg-primary hover:border-accent-plum/40 hover:bg-accent-plum/10 hover:text-accent-plum-strong",
                      isPending ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    <span className="flex items-center gap-2 font-sans text-caption">
                      {isCurrent && (
                        <Check
                          size={14}
                          className="shrink-0"
                          aria-hidden
                        />
                      )}
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className="shrink-0 font-sans text-micro text-fg-muted">
                      {isPending
                        ? "Moving…"
                        : isError
                          ? "Failed"
                          : isCurrent
                            ? "Current"
                            : "→"}
                    </span>
                  </HapticButton>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </BottomSheet>
  );
}
