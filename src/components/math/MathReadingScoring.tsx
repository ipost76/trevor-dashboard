import * as React from "react";
import { MathSection } from "./MathSection";

/**
 * Sections 1–2 — reading the market · scoring a setup.  [scaffold: B1]
 * Formula IDs F-IND-01…19. FILLED BY PROMPT D1.
 *
 * 🚨 This file contains NO formula content on purpose. An empty section that
 * says it is empty is correct; a plausible-looking placeholder formula would be
 * a defect — Ghost reads this page to learn what TREVOR actually does, and
 * invented math teaches him something false.
 *
 * D1: replace each <Stub /> with <FormulaEntry {...} /> entries, then delete
 * the Stub component at the bottom of this file.
 */
export function MathReadingScoring() {
  return (
    <>
      <MathSection number={1} title="Reading the market">
        <Stub prompt="D1" ids="F-IND-01…19" />
      </MathSection>

      <MathSection number={2} title="Scoring a setup">
        <Stub prompt="D1" ids="F-IND-01…19" />
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
