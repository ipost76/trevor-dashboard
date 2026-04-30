"use client";
import * as React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  Pill,
  HapticButton,
  BottomSheet,
} from "@/components/ui";
import { RotateCcw, AlertTriangle } from "lucide-react";

type ResetKind = "capital" | "pnl" | "xp";

interface ResetMeta {
  kind: ResetKind;
  label: string;
  description: string;
  endpoint: string;
  destructive: boolean;
  needsCapitalInput: boolean;
}

const RESETS: ResetMeta[] = [
  {
    kind: "capital",
    label: "Reset Capital",
    description:
      "Inserts a new capital baseline (default $50) and updates trevor_config.trading_capital. Existing open positions are NOT closed (Rule 1).",
    endpoint: "/api/admin/reset-capital",
    destructive: false,
    needsCapitalInput: true,
  },
  {
    kind: "pnl",
    label: "Reset P&L Stats",
    description:
      "Stamps a new P&L cutoff date. Today's running counters reset; closed-trade history is preserved in the DB.",
    endpoint: "/api/admin/reset-pnl-stats",
    destructive: false,
    needsCapitalInput: false,
  },
  {
    kind: "xp",
    label: "Reset XP",
    description:
      "Stamps a new XP display cutoff. Lifetime XP audit trail in xp_ledger is preserved; UI counts from the new cutoff. Cannot be undone.",
    endpoint: "/api/admin/reset-xp",
    destructive: true,
    needsCapitalInput: false,
  },
];

type Result = { tone: "ok" | "fail"; message: string } | null;

export function ResetControlsCard() {
  const [confirmFor, setConfirmFor] = React.useState<ResetMeta | null>(null);
  const [confirmText, setConfirmText] = React.useState("");
  const [newCapital, setNewCapital] = React.useState("50");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<Result>(null);

  React.useEffect(() => {
    if (confirmFor) {
      setConfirmText("");
      setNewCapital("50");
      setResult(null);
      setSubmitting(false);
    }
  }, [confirmFor]);

  const close = () => {
    setConfirmFor(null);
  };

  const canSubmit =
    confirmFor !== null &&
    confirmText === "RESET" &&
    !submitting &&
    (!confirmFor.needsCapitalInput || Number(newCapital) > 0);

  const submit = async () => {
    if (!confirmFor || !canSubmit) return;
    setSubmitting(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = { confirmText: "RESET" };
      if (confirmFor.needsCapitalInput) {
        body.newCapital = newCapital;
      }
      const res = await fetch(confirmFor.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        newCapital?: number;
        oldCapital?: number;
        newCutoff?: string;
        previousXp?: number;
      };
      if (!res.ok || data.error || data.success === false) {
        setResult({
          tone: "fail",
          message: `Failed: ${data.error ?? `HTTP ${res.status}`}`,
        });
      } else {
        let msg = "Reset ✓";
        if (confirmFor.kind === "capital" && data.newCapital !== undefined) {
          msg = `Capital reset to $${data.newCapital.toFixed(2)} ✓`;
        } else if (confirmFor.kind === "pnl" && data.newCutoff) {
          msg = "P&L cutoff stamped ✓";
        } else if (confirmFor.kind === "xp") {
          msg = `XP cutoff stamped ✓ (was ${data.previousXp ?? "?"})`;
        }
        setResult({ tone: "ok", message: msg });
        setTimeout(close, 1600);
      }
    } catch (err) {
      setResult({ tone: "fail", message: `Failed: ${String(err)}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Card padding="md">
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <RotateCcw size={14} />
              RESET CONTROLS
            </span>
          </CardTitle>
          <Pill tone="amber" size="sm">
            ADMIN
          </Pill>
        </CardHeader>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {RESETS.map((r) => (
            <HapticButton
              key={r.kind}
              variant={r.destructive ? "destructive" : "secondary"}
              onClick={() => setConfirmFor(r)}
              fullWidth
            >
              {r.label}
            </HapticButton>
          ))}
        </div>
        <div className="mt-3 text-micro text-fg-muted">
          Resets do NOT auto-close positions (Rule 1). Project-wide pause is
          Discord <code className="rounded bg-bg-elevated px-1">!killswitch</code>,
          not a button on this page.
        </div>
      </Card>

      <BottomSheet
        open={confirmFor !== null}
        onClose={close}
        title={confirmFor ? `Confirm: ${confirmFor.label}` : ""}
      >
        {confirmFor && (
          <div className="space-y-4 p-4">
            {confirmFor.destructive && (
              <div className="flex items-start gap-2 rounded-md border border-accent-red/40 bg-accent-red/10 p-3 text-caption text-accent-red">
                <AlertTriangle size={16} className="mt-0.5 flex-none" />
                <span>This action CANNOT be undone.</span>
              </div>
            )}

            <p className="text-caption text-fg-primary">
              {confirmFor.description}
            </p>

            {confirmFor.needsCapitalInput && (
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="reset-new-capital"
                  className="text-micro uppercase tracking-wider text-fg-muted"
                >
                  New capital (USD)
                </label>
                <input
                  id="reset-new-capital"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={newCapital}
                  onChange={(e) => setNewCapital(e.target.value)}
                  className="w-full rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 font-mono text-body tabular-nums text-fg-primary focus:border-accent-cyan focus:outline-none"
                />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label
                htmlFor="reset-confirm-text"
                className="text-micro uppercase tracking-wider text-fg-muted"
              >
                Type <span className="font-bold text-accent-amber">RESET</span> to confirm
              </label>
              <input
                id="reset-confirm-text"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="RESET"
                className="w-full rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 font-mono text-body uppercase tracking-wider text-fg-primary focus:border-accent-cyan focus:outline-none"
              />
            </div>

            <HapticButton
              variant={confirmFor.destructive ? "destructive" : "primary"}
              fullWidth
              disabled={!canSubmit}
              onClick={submit}
            >
              {submitting ? "Resetting…" : `Confirm ${confirmFor.label}`}
            </HapticButton>

            {result && (
              <div
                className={
                  "rounded-md border px-3 py-2 text-center text-caption " +
                  (result.tone === "ok"
                    ? "border-accent-green/40 bg-accent-green/10 text-accent-green"
                    : "border-accent-red/40 bg-accent-red/10 text-accent-red")
                }
              >
                {result.message}
              </div>
            )}

            <HapticButton variant="ghost" fullWidth onClick={close}>
              Cancel
            </HapticButton>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
