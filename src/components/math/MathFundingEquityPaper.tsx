import * as React from "react";
import { MathSection } from "./MathSection";

/**
 * Sections 15–17 — funding & slippage · equity & return · paper mode.
 * Formula IDs F-FEE-13…21. FILLED BY PROMPT D6.  [scaffold: B1]
 *
 * 🚨 No formula content here on purpose — see MathReadingScoring.tsx.
 * ⚠️ D6 owns section 17, "Paper mode" — the section that explains the gate
 * every other section's `paper` overlay refers to. It is the one place the
 * page can be honest about what a simulated fill does and does not prove.
 */
export function MathFundingEquityPaper() {
  return (
    <>
      <MathSection number={15} title="Funding & slippage">
        <Stub prompt="D6" ids="F-FEE-13…21" />
      </MathSection>

      <MathSection number={16} title="Equity & return">
        <Stub prompt="D6" ids="F-FEE-13…21" />
      </MathSection>

      <MathSection number={17} title="Paper mode">
        <Stub prompt="D6" ids="F-FEE-13…21" />
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
