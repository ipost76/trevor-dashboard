"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Position } from "@/app/trading/panels/HoldingsPanel";

type PositionFormProps = {
  open: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  initial?: Partial<Position>;
};

const DIRECTION_OPTIONS = [
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
];

const ASSET_TYPE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "stock", label: "Stock" },
  { value: "etf", label: "ETF" },
  { value: "crypto_spot", label: "Crypto Spot" },
  { value: "crypto_perp", label: "Crypto Perp" },
];

export function PositionForm({ open, onClose, onSave, initial }: PositionFormProps) {
  const isEdit = !!initial?.id;

  const [ticker, setTicker] = useState("");
  const [direction, setDirection] = useState("long");
  const [entryPrice, setEntryPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [leverage, setLeverage] = useState("1");
  const [assetType, setAssetType] = useState("auto");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Reset form when initial changes or modal opens
  useEffect(() => {
    if (open) {
      setTicker(initial?.ticker || "");
      setDirection(initial?.direction || "long");
      setEntryPrice(initial?.entry_price != null ? String(initial.entry_price) : "");
      setQuantity(initial?.quantity != null ? String(initial.quantity) : "1");
      setLeverage(initial?.leverage != null ? String(initial.leverage) : "1");
      setAssetType(initial?.asset_type || "auto");
      setNotes(initial?.notes || "");
      setError("");
      setSaving(false);
    }
  }, [open, initial]);

  const handleSubmit = useCallback(async () => {
    const trimmedTicker = ticker.trim().toUpperCase();
    if (!trimmedTicker) {
      setError("Ticker is required");
      return;
    }

    const ep = parseFloat(entryPrice);
    if (isNaN(ep) || ep <= 0) {
      setError("Valid entry price is required");
      return;
    }

    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setError("Valid quantity is required");
      return;
    }

    const lev = parseFloat(leverage);
    if (isNaN(lev) || lev < 1) {
      setError("Leverage must be >= 1");
      return;
    }

    setError("");
    setSaving(true);

    try {
      await onSave({
        ticker: trimmedTicker,
        direction,
        entry_price: ep,
        quantity: qty,
        leverage: lev,
        asset_type: assetType,
        notes: notes.trim(),
      });
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  }, [ticker, direction, entryPrice, quantity, leverage, assetType, notes, onSave]);

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
          className="panel w-full max-w-md pointer-events-auto animate-enter"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="panel-header flex items-center justify-between">
            <span>{isEdit ? "EDIT POSITION" : "ADD POSITION"}</span>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Form */}
          <div className="p-4 space-y-3">
            {/* Row 1: Ticker + Direction */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="stat-label block mb-1">Ticker *</label>
                <input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="BTC-PERP"
                  className="input-terminal w-full"
                  autoFocus
                  disabled={isEdit}
                />
              </div>
              <div>
                <label className="stat-label block mb-1">Direction</label>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  className="input-terminal w-full"
                >
                  {DIRECTION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Entry Price + Quantity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="stat-label block mb-1">Entry Price *</label>
                <input
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  placeholder="0.00"
                  type="number"
                  step="any"
                  min="0"
                  className="input-terminal w-full"
                />
              </div>
              <div>
                <label className="stat-label block mb-1">Quantity</label>
                <input
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="1"
                  type="number"
                  step="any"
                  min="0"
                  className="input-terminal w-full"
                />
              </div>
            </div>

            {/* Row 3: Leverage + Asset Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="stat-label block mb-1">Leverage</label>
                <input
                  value={leverage}
                  onChange={(e) => setLeverage(e.target.value)}
                  placeholder="1"
                  type="number"
                  step="any"
                  min="1"
                  className="input-terminal w-full"
                />
              </div>
              <div>
                <label className="stat-label block mb-1">Asset Type</label>
                <select
                  value={assetType}
                  onChange={(e) => setAssetType(e.target.value)}
                  className="input-terminal w-full"
                >
                  {ASSET_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 4: Notes */}
            <div>
              <label className="stat-label block mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                rows={2}
                className="input-terminal w-full resize-none"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="text-[11px] neon-red px-2 py-1 rounded bg-[rgba(255,51,102,0.08)] border border-[rgba(255,51,102,0.2)]">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="text-[11px] font-bold uppercase tracking-wider px-4 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className={cn(
                  "btn-primary",
                  saving && "opacity-50 pointer-events-none"
                )}
              >
                {saving ? "Saving..." : isEdit ? "Update" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
