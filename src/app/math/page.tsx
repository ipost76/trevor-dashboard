import * as React from "react";
// KaTeX's stylesheet, loaded through the app's own bundler-CSS-import mechanism
// (the same one `layout.tsx` uses for globals.css) but scoped to THIS route.
// 🚨 Deliberately NOT added to layout.tsx: that would be a second edit to an
// existing file and would ship KaTeX's CSS to every page on the Hub for one
// page's benefit.
import "katex/dist/katex.min.css";

import { MATH_SECTIONS, mathSectionAnchor } from "@/components/math";
import { MathReadingScoring } from "@/components/math/MathReadingScoring";
import { MathRegimeThresholds } from "@/components/math/MathRegimeThresholds";
import { MathSizingGates } from "@/components/math/MathSizingGates";
import { MathExitsSleeves } from "@/components/math/MathExitsSleeves";
import { MathFeesPnl } from "@/components/math/MathFeesPnl";
import { MathFundingEquityPaper } from "@/components/math/MathFundingEquityPaper";

/**
 * /math — the maths behind TREVOR.  [B1 scaffold, 2026-08-05]
 *
 * A standalone learning surface: formula + what each symbol means + why it
 * works + the standing values that make it concrete, with an honest status
 * badge on every entry.
 *
 * 🚨 READ-ONLY BY CONSTRUCTION. No fetch, no gateway call, no mutation, no
 * control, no killswitch. It renders with no API and no data — B2's live-values
 * endpoint may not exist yet, and the page must never depend on it to render.
 *
 * The six section components are stubs until D1–D6 fill them.
 */

export const metadata = {
  title: "TREVOR // THE MATH",
};

export default function MathPage() {
  return (
    <div className="mx-auto w-full max-w-screen-lg px-4 py-6 sm:px-6">
      <header className="space-y-3">
        <div className="text-micro text-fg-muted">TREVOR // THE MATH</div>
        <h1 className="text-h1 text-fg-primary">How TREVOR decides</h1>
      </header>

      {/* ── The seventeen sections, in order ─────────────────────────────── */}
      <div className="mt-6 space-y-8">
        <MathReadingScoring />
        <MathRegimeThresholds />
        <MathSizingGates />
        <MathExitsSleeves />
        <MathFeesPnl />
        <MathFundingEquityPaper />
      </div>

      {/* ── Table of contents — a FOOTER index, below section 17 ─────────── */}
      <nav aria-label="Sections" className="mt-10 border-t border-border-subtle pt-6">
        <h2 className="text-micro text-fg-dim">Contents — jump to a section</h2>
        <ol className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {MATH_SECTIONS.map((s) => (
            <li key={s.number}>
              <a
                href={`#${mathSectionAnchor(s.number)}`}
                className="flex items-baseline gap-2 py-1 text-caption text-fg-muted hover:text-accent-cyan-soft-strong"
              >
                <span className="font-mono tabular-nums text-fg-dim">
                  {String(s.number).padStart(2, "0")}
                </span>
                <span>{s.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
