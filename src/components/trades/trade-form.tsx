"use client";

import { useState } from "react";
import { X, Save, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ── */

type TradeFormProps = {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
};

type FormData = {
  ticker: string;
  direction: "long" | "short";
  entry_price: string;
  exit_price: string;
  leverage: string;
  outcome: "WIN" | "LOSS" | "SCRATCH";
  notes: string;
};

const EMPTY_FORM: FormData = {
  ticker: "",
  direction: "long",
  entry_price: "",
  exit_price: "",
  leverage: "1",
  outcome: "WIN",
  notes: "",
};

/* ── Component ── */

export function TradeForm({ open, onClose, onSave }: TradeFormProps) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError("");
  };

  const validate = (): string | null => {
    if (!form.ticker.trim()) return "Ticker is required";
    if (!form.entry_price || isNaN(Number(form.entry_price)) || Number(form.entry_price) <= 0)
      return "Valid entry price required";
    if (!form.exit_price || isNaN(Number(form.exit_price)) || Number(form.exit_price) <= 0)
      return "Valid exit price required";
    if (isNaN(Number(form.leverage)) || Number(form.leverage) < 1)
      return "Leverage must be >= 1";
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");

    try {
      const entry = Number(form.entry_price);
      const exit = Number(form.exit_price);
      const leverage = Number(form.leverage);
      const rawPnl =
        form.direction === "long"
          ? ((exit - entry) / entry) * 100
          : ((entry - exit) / entry) * 100;
      const leveragedPnl = rawPnl * leverage;

      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: form.ticker.toUpperCase().trim(),
          direction: form.direction,
          entry_price: entry,
          exit_price: exit,
          leverage,
          outcome: form.outcome,
          pnl_pct: Number(rawPnl.toFixed(4)),
          leveraged_pnl_pct: Number(leveragedPnl.toFixed(4)),
          notes: form.notes.trim() || null,
          source: "manual_hub",
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "Unknown error" }));
        setError(d.error || `HTTP ${res.status}`);
        setSaving(false);
        return;
      }

      setForm(EMPTY_FORM);
      setSaving(false);
      onSave();
      onClose();
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  };

  const entryNum = Number(form.entry_price) || 0;
  const exitNum = Number(form.exit_price) || 0;
  const levNum = Number(form.leverage) || 1;
  let previewPnl = 0;
  if (entryNum > 0 && exitNum > 0) {
    const raw =
      form.direction === "long"
        ? ((exitNum - entryNum) / entryNum) * 100
        : ((entryNum - exitNum) / entryNum) * 100;
    previewPnl = raw * levNum;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel p-4 w-full max-w-md mx-4 space-y-3 border border-[var(--neon-cyan)] shadow-[0_0_20px_rgba(0,240,255,0.15)]">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold neon-text">MANUAL TRADE ENTRY</span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Fields */}
        <div className="space-y-2">
          {/* Ticker */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Ticker
            </label>
            <input
              value={form.ticker}
              onChange={(e) => update("ticker", e.target.value.toUpperCase())}
              placeholder="BTC-PERP"
              className="input-terminal w-full mt-0.5"
            />
          </div>

          {/* Direction + Outcome */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Direction
              </label>
              <div className="flex gap-1 mt-0.5">
                <button
                  onClick={() => update("direction", "long")}
                  className={cn(
                    "flex-1 text-[10px] py-1 font-bold uppercase rounded border transition-colors",
                    form.direction === "long"
                      ? "bg-[rgba(0,255,136,0.1)] text-[var(--neon-green)] border-[rgba(0,255,136,0.3)]"
                      : "text-muted-foreground border-[var(--border)] hover:text-foreground"
                  )}
                >
                  LONG
                </button>
                <button
                  onClick={() => update("direction", "short")}
                  className={cn(
                    "flex-1 text-[10px] py-1 font-bold uppercase rounded border transition-colors",
                    form.direction === "short"
                      ? "bg-[rgba(255,51,102,0.1)] text-[var(--neon-red)] border-[rgba(255,51,102,0.3)]"
                      : "text-muted-foreground border-[var(--border)] hover:text-foreground"
                  )}
                >
                  SHORT
                </button>
              </div>
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Outcome
              </label>
              <select
                value={form.outcome}
                onChange={(e) =>
                  update("outcome", e.target.value as "WIN" | "LOSS" | "SCRATCH")
                }
                className="input-terminal w-full mt-0.5"
              >
                <option value="WIN">WIN</option>
                <option value="LOSS">LOSS</option>
                <option value="SCRATCH">SCRATCH</option>
              </select>
            </div>
          </div>

          {/* Prices */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Entry $
              </label>
              <input
                value={form.entry_price}
                onChange={(e) => update("entry_price", e.target.value)}
                placeholder="0.00"
                type="number"
                step="any"
                min="0"
                className="input-terminal w-full mt-0.5"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Exit $
              </label>
              <input
                value={form.exit_price}
                onChange={(e) => update("exit_price", e.target.value)}
                placeholder="0.00"
                type="number"
                step="any"
                min="0"
                className="input-terminal w-full mt-0.5"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                Leverage
              </label>
              <input
                value={form.leverage}
                onChange={(e) => update("leverage", e.target.value)}
                placeholder="1"
                type="number"
                step="1"
                min="1"
                className="input-terminal w-full mt-0.5"
              />
            </div>
          </div>

          {/* P&L Preview */}
          {entryNum > 0 && exitNum > 0 && (
            <div className="panel p-2 text-center">
              <span className="text-[9px] text-muted-foreground uppercase">
                P&L Preview
              </span>
              <div
                className={cn(
                  "text-lg font-bold font-mono",
                  previewPnl > 0
                    ? "neon-green"
                    : previewPnl < 0
                      ? "neon-red"
                      : "text-muted-foreground"
                )}
              >
                {previewPnl > 0 ? "+" : ""}
                {previewPnl.toFixed(2)}%
              </div>
              {levNum > 1 && (
                <span className="text-[9px] neon-amber">{levNum}x leveraged</span>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Trade context, strategy, lessons..."
              rows={3}
              className="input-terminal w-full mt-0.5 resize-none"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--neon-red)]">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="btn-primary text-[10px] px-3 py-1"
            disabled={saving}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 text-[10px] px-3 py-1 font-bold uppercase tracking-wider bg-[rgba(0,240,255,0.1)] text-[var(--neon-cyan)] border border-[rgba(0,240,255,0.3)] rounded hover:bg-[rgba(0,240,255,0.2)] transition-colors disabled:opacity-50"
          >
            <Save className="h-3 w-3" />
            {saving ? "SAVING..." : "SAVE TRADE"}
          </button>
        </div>
      </div>
    </div>
  );
}
