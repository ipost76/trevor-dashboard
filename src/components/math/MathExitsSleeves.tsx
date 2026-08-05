import * as React from "react";
import { MathSection } from "./MathSection";

/**
 * Sections 10–11 — the exit stack · sleeves.
 * Formula IDs F-EXIT-00…15. FILLED BY PROMPT D4.  [scaffold: B1]
 *
 * 🚨 No formula content here on purpose — see MathReadingScoring.tsx.
 * ⚠️ D4: this is the exit family, so entries here carry the `fired` prop
 * ('FIRED (n=62)' / 'NEVER FIRED'). A layer that has never fired is a real
 * finding about the system — say so rather than leaving it blank.
 */
export function MathExitsSleeves() {
  return (
    <>
      <MathSection number={10} title="The exit stack">
        <Stub prompt="D4" ids="F-EXIT-00…15" />
      </MathSection>

      <MathSection number={11} title="Sleeves">
        <Stub prompt="D4" ids="F-EXIT-00…15" />
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
