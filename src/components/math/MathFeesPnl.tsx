import * as React from "react";
import { MathSection } from "./MathSection";

/**
 * Sections 12–14 — fees · P&L · break-even.
 * Formula IDs F-FEE-01…12. FILLED BY PROMPT D5.  [scaffold: B1]
 *
 * 🚨 No formula content here on purpose — see MathReadingScoring.tsx.
 * ⚠️ D5: fee and P&L entries are `live` AND paper-gated — use the `overlay`
 * prop. When a formula names a DB column, write it as `\text{pnl\_usd}` with
 * the backslash escape; without it KaTeX renders a subscript, not the column.
 */
export function MathFeesPnl() {
  return (
    <>
      <MathSection number={12} title="Fees">
        <Stub prompt="D5" ids="F-FEE-01…12" />
      </MathSection>

      <MathSection number={13} title="P&L">
        <Stub prompt="D5" ids="F-FEE-01…12" />
      </MathSection>

      <MathSection number={14} title="Break-even">
        <Stub prompt="D5" ids="F-FEE-01…12" />
      </MathSection>
    </>
  );
}

/** Temporary — delete when this section is filled. */
function Stub({ prompt, ids }: { prompt: string; ids: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card/50 p-4">
      <p className="text-caption text-fg-muted">
        Section content is built by prompt{" "}
        <span className="font-mono text-fg-primary">[{prompt}]</span>.
      </p>
      <p className="mt-1 font-mono text-micro text-fg-dim">{ids}</p>
    </div>
  );
}
