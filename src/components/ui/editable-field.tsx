"use client";
import * as React from "react";
import { Check, X, Lock, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export type EditableFieldType = "text" | "number" | "float";

export interface EditableFieldProps {
  label: string;
  value: string;
  type: EditableFieldType;
  immutable?: boolean;
  onSave: (newValue: string) => Promise<void>;
  validate?: (value: string) => string | null;
  category?: string;
}

function defaultValidate(value: string, type: EditableFieldType): string | null {
  if (type === "text") return null;
  const trimmed = value.trim();
  if (trimmed === "") return "Required";
  if (type === "number") {
    if (!/^-?\d+$/.test(trimmed)) return "Integer required";
  }
  if (type === "float") {
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return "Number required";
  }
  return null;
}

export function EditableField({
  label,
  value,
  type,
  immutable = false,
  onSave,
  validate,
}: EditableFieldProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    if (immutable || saving) return;
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
    setDraft(value);
  };

  const commit = async () => {
    const custom = validate ? validate(draft) : null;
    const intrinsic = defaultValidate(draft, type);
    const err = custom ?? intrinsic;
    if (err) {
      setError(err);
      return;
    }
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // F1: was `e instanceof Error ? e.message : "Save failed"` — a raw
      // exception rendered as user copy. Unmounted today; fixed so the next
      // importer does not inherit it.
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-sans text-label-ui text-fg-muted">{label}</span>

        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            disabled={immutable}
            aria-label={immutable ? `${label} (immutable)` : `Edit ${label}`}
            className={cn(
              "tap-target -my-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 font-mono text-caption tabular-nums",
              immutable
                ? "cursor-not-allowed text-fg-faint"
                : "text-fg-primary hover:bg-bg-elevated hover:text-accent-cyan-soft-strong",
            )}
          >
            <span className="truncate">{value === "" ? "—" : value}</span>
            {immutable ? (
              <Lock size={12} className="shrink-0 text-fg-faint" aria-hidden />
            ) : (
              <Pencil size={12} className="shrink-0 opacity-60" aria-hidden />
            )}
          </button>
        )}

        {editing && (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              type={type === "text" ? "text" : "text"}
              inputMode={type === "text" ? "text" : "decimal"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={saving}
              className={cn(
                "w-32 rounded-md border border-accent-cyan-soft/40 bg-bg-card px-2 py-1 font-mono text-caption tabular-nums text-fg-primary",
                "focus:border-accent-cyan-soft focus:outline-none focus:shadow-glow-focus",
                "disabled:opacity-60",
                error && "border-accent-red/50",
              )}
            />
            <button
              type="button"
              onClick={commit}
              disabled={saving}
              aria-label="Save"
              className="tap-target -my-2 flex items-center justify-center rounded-md p-1 text-accent-mint-strong hover:bg-accent-mint/10 disabled:opacity-60"
            >
              <Check size={16} aria-hidden />
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              aria-label="Cancel"
              className="tap-target -my-2 flex items-center justify-center rounded-md p-1 text-fg-muted hover:bg-bg-elevated hover:text-fg-primary disabled:opacity-60"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {editing && error && (
        <p className="font-sans text-micro text-accent-red">{error}</p>
      )}
    </div>
  );
}
