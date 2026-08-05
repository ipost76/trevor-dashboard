import * as React from "react";
import { MathSection } from "./MathSection";

/**
 * Sections 3–6 — regime · thresholds · cooldown/dedup · Stage-A screens.
 * Formula IDs F-IND-20…37. FILLED BY PROMPT D2.  [scaffold: B1]
 *
 * 🚨 No formula content here on purpose — see MathReadingScoring.tsx.
 * D2: replace each <Stub /> with real entries, then delete Stub.
 */
export function MathRegimeThresholds() {
  return (
    <>
      <MathSection number={3} title="Regime">
        <Stub prompt="D2" ids="F-IND-20…37" />
      </MathSection>

      <MathSection number={4} title="Thresholds">
        <Stub prompt="D2" ids="F-IND-20…37" />
      </MathSection>

      <MathSection number={5} title="Cooldown & dedup">
        <Stub prompt="D2" ids="F-IND-20…37" />
      </MathSection>

      <MathSection number={6} title="Stage-A screens">
        <Stub prompt="D2" ids="F-IND-20…37" />
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
