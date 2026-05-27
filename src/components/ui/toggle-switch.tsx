"use client";
import * as React from "react";
import { ConfirmModal } from "./confirm-modal";
import { cn } from "@/lib/utils";

export type ToggleSensitivity = 1 | 2 | 3;

export interface ToggleSwitchProps {
  label: string;
  description?: string;
  value: boolean;
  /** A1 §9 tier: 1 = destructive (2-tap + reason), 2 = sensitive (1-tap + warning), 3 = free toggle. */
  sensitivity: ToggleSensitivity;
  onToggle: (newValue: boolean, reason?: string) => Promise<void>;
  disabled?: boolean;
}

export function ToggleSwitch({
  label,
  description,
  value,
  sensitivity,
  onToggle,
  disabled = false,
}: ToggleSwitchProps) {
  const [pending, setPending] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [warning, setWarning] = React.useState<string | null>(null);
  const warningTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (warningTimer.current) clearTimeout(warningTimer.current);
    },
    [],
  );

  const runToggle = async (next: boolean, reason?: string) => {
    setPending(true);
    try {
      await onToggle(next, reason);
    } finally {
      setPending(false);
    }
  };

  const handleClick = async () => {
    if (disabled || pending) return;
    const next = !value;
    if (sensitivity === 1) {
      setConfirmOpen(true);
      return;
    }
    if (sensitivity === 2) {
      setWarning(`Toggling "${label}" — sensitive flag.`);
      if (warningTimer.current) clearTimeout(warningTimer.current);
      warningTimer.current = setTimeout(() => setWarning(null), 2_000);
    }
    await runToggle(next);
  };

  const handleConfirm = async (reason?: string) => {
    setConfirmOpen(false);
    await runToggle(!value, reason);
  };

  return (
    <div className="flex flex-col gap-1 border-b border-border-subtle py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-sans text-label-ui text-fg-primary">{label}</div>
          {description && (
            <div className="mt-0.5 font-sans text-micro text-fg-muted">
              {description}
            </div>
          )}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label={`${label} (${value ? "on" : "off"})`}
          onClick={handleClick}
          disabled={disabled || pending}
          className={cn(
            "tap-target relative h-6 w-11 shrink-0 rounded-pill border transition-colors duration-fast",
            value
              ? "border-accent-mint/60 bg-accent-mint/20 shadow-glow-subtle-mint"
              : "border-border-subtle bg-bg-elevated",
            (disabled || pending) && "cursor-not-allowed opacity-60",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-pill transition-all duration-fast",
              value
                ? "left-[calc(100%-1.25rem)] bg-accent-mint-strong"
                : "left-1 bg-fg-muted",
            )}
          />
        </button>
      </div>

      {warning && (
        <p className="font-sans text-micro text-accent-gold-strong">{warning}</p>
      )}

      <ConfirmModal
        isOpen={confirmOpen}
        title={`Toggle ${label}?`}
        message={`This will set "${label}" to ${value ? "OFF" : "ON"}. Tier 1 destructive — reason required.`}
        requireReason
        destructive
        confirmLabel={value ? "Turn OFF" : "Turn ON"}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
