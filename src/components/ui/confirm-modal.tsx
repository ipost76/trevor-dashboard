"use client";
import * as React from "react";
import { BottomSheet } from "./bottom-sheet";
import { HapticButton } from "./haptic-button";
import { cn } from "@/lib/utils";

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  requireReason?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (reason?: string) => void | Promise<void>;
  onCancel: () => void;
  destructive?: boolean;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  requireReason = false,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmModalProps) {
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setReason("");
      setPending(false);
    }
  }, [isOpen]);

  const reasonOk = !requireReason || reason.trim().length > 0;
  const canConfirm = !pending && reasonOk;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setPending(true);
    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <BottomSheet open={isOpen} onClose={pending ? () => undefined : onCancel} title={title}>
      <div className="space-y-4">
        <p className="font-sans text-prose-ui text-fg-primary">{message}</p>

        {requireReason && (
          <label className="block space-y-2">
            <span className="font-sans text-label-ui text-fg-muted">
              Reason (required)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why are you doing this?"
              disabled={pending}
              className={cn(
                "w-full resize-y rounded-md border border-border-subtle bg-bg-card px-3 py-2 font-sans text-prose-ui text-fg-primary",
                "focus:border-accent-cyan-soft focus:outline-none focus:shadow-glow-focus",
                "disabled:opacity-60",
              )}
            />
          </label>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <HapticButton
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </HapticButton>
          <HapticButton
            type="button"
            variant="primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className={cn(
              destructive &&
                "border-accent-red/60 bg-accent-red/15 text-accent-red hover:border-accent-red hover:bg-accent-red/20",
            )}
          >
            {pending ? "..." : confirmLabel}
          </HapticButton>
        </div>
      </div>
    </BottomSheet>
  );
}
