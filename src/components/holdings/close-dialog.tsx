"use client";

import { useState, useMemo } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DirectionBadge } from "@/components/ui/direction-badge";
import type { Position } from "@/app/holdings/page";

type CloseDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (exitPrice: number) => void;
  position: Position;
};

export function CloseDialog({ open, onClose, onConfirm, position }: CloseDialogProps) {
  const [exitPriceStr, setExitPriceStr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const exitPrice = parseFloat(exitPriceStr);
  const isValid = !isNaN(exitPrice) && exitPrice > 0;

  const preview = useMemo(() => {
    if (!isValid) return null;

    const dirMult = position.direction === "long" ? 1 : -1;
    const pnlPct =
      ((exitPrice - position.entry_price) / position.entry_price) *
      dirMult *
      (position.leverage || 1) *
      100;
    const pnlUsd =
      (exitPrice - position.entry_price) *
      dirMult *
      position.quantity *
      (position.leverage || 1);

    return { pnlPct, pnlUsd };
  }, [exitPrice, isValid, position]);

  const handleConfirm = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      onConfirm(exitPrice);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="panel w-full max-w-sm pointer-events-auto animate-enter"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="panel-header flex items-center justify-between">
            <span>CLOSE POSITION</span>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Position Info */}
            <div className="panel p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-foreground">
                  {position.ticker}
                </span>
                <DirectionBadge dir={position.direction} />
                {position.leverage > 1 && (
                  <span className="text-[10px] font-bold neon-amber">
                    {position.leverage}x
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-muted-foreground">Entry Price</span>
                  <div className="font-mono font-bold">
                    ${position.entry_price.toFixed(2)}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Quantity</span>
                  <div className="font-mono font-bold">{position.quantity}</div>
                </div>
              </div>
            </div>

            {/* Exit Price Input */}
            <div>
              <label className="stat-label block mb-1">Exit Price *</label>
              <input
                value={exitPriceStr}
                onChange={(e) => setExitPriceStr(e.target.value)}
                placeholder="0.00"
                type="number"
                step="any"
                min="0"
                className="input-terminal w-full"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
              />
            </div>

            {/* P&L Preview */}
            {preview && (
              <div
                className={cn(
                  "panel p-3 border",
                  preview.pnlPct >= 0
                    ? "border-[rgba(0,255,136,0.3)] bg-[rgba(0,255,136,0.04)]"
                    : "border-[rgba(255,51,102,0.3)] bg-[rgba(255,51,102,0.04)]"
                )}
              >
                <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">
                  Estimated Result
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[9px] text-muted-foreground">P&L %</div>
                    <div
                      className={cn(
                        "text-lg font-bold font-mono",
                        preview.pnlPct >= 0 ? "neon-green" : "neon-red"
                      )}
                    >
                      {preview.pnlPct >= 0 ? "+" : ""}
                      {preview.pnlPct.toFixed(2)}%
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-muted-foreground">P&L $</div>
                    <div
                      className={cn(
                        "text-lg font-bold font-mono",
                        preview.pnlUsd >= 0 ? "neon-green" : "neon-red"
                      )}
                    >
                      {preview.pnlUsd >= 0 ? "+" : ""}
                      ${Math.abs(preview.pnlUsd).toFixed(2)}
                    </div>
                  </div>
                </div>
                {position.leverage > 1 && (
                  <div className="text-[9px] text-muted-foreground mt-1">
                    Includes {position.leverage}x leverage
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={onClose}
                className="text-[11px] font-bold uppercase tracking-wider px-4 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!isValid || submitting}
                className={cn(
                  "btn-primary",
                  (!isValid || submitting) && "opacity-50 pointer-events-none"
                )}
              >
                {submitting ? "Closing..." : "Close Position"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
