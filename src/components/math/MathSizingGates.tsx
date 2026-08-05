import * as React from "react";
import { MathSection } from "./MathSection";

/**
 * Sections 7–9 — sizing · the tail cap · the gates.
 * Formula IDs F-SIZE-01…15. FILLED BY PROMPT D3.  [scaffold: B1]
 *
 * 🚨 No formula content here on purpose — see MathReadingScoring.tsx.
 * ⚠️ D3: most sizing entries are `live` AND behind the paper gate. Pass
 * `status="live" overlay="paper"` — a bare 🟢 would say real money moved.
 */
export function MathSizingGates() {
  return (
    <>
      <MathSection number={7} title="Sizing">
        <Stub prompt="D3" ids="F-SIZE-01…15" />
      </MathSection>

      <MathSection number={8} title="The tail cap">
        <Stub prompt="D3" ids="F-SIZE-01…15" />
      </MathSection>

      <MathSection number={9} title="The gates">
        <Stub prompt="D3" ids="F-SIZE-01…15" />
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
