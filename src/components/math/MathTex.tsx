"use client";
import * as React from "react";
import katex from "katex";
import { cn } from "@/lib/utils";

/**
 * MathTex — the KaTeX renderer. [B1, 2026-08-05]
 *
 * Every formula on /math goes through here. Six parallel prompts will feed it
 * hundreds of LaTeX strings, so it is built to survive bad input rather than to
 * be clever.
 *
 * 🚨 THREE PROPERTIES THAT ARE NOT NEGOTIABLE — a D-prompt must not "optimise"
 * any of them away:
 *
 *  1. A MALFORMED FORMULA NEVER CRASHES THE PAGE. `throwOnError: false` makes
 *     KaTeX render the offending source in red instead of throwing, and the
 *     try/catch below covers the residue KaTeX still throws on (a non-string
 *     input, an internal TypeError) by falling back to the raw source in a
 *     <code>. One typo in one of 88 entries cannot take down the Hub.
 *
 *  2. THE TEX STRING IS PASSED THROUGH UNTOUCHED. No trim, no replace, no
 *     whitespace normalisation, no template processing. `\text{pnl\_usd}` must
 *     reach KaTeX with its backslash escape intact or it renders as a
 *     subscript — "pnl" with a subscripted "usd" — instead of the column name.
 *     Any transformation added between prop and renderToString will eat it.
 *
 *  3. A WIDE FORMULA SCROLLS IN ITS OWN BOX. Ghost reads this on a phone, and
 *     some entries are very wide (one is three stacked `cases` blocks). The
 *     overflow lives on the wrapper so the formula never widens the page.
 */

export interface MathTexProps {
  /** Raw LaTeX. Passed to KaTeX verbatim — see property 2 above. */
  tex: string;
  /** Block (default) vs inline. */
  display?: boolean;
  className?: string;
}

export function MathTex({ tex, display = true, className }: MathTexProps) {
  const html = React.useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        // Property 1: degrade, never throw.
        throwOnError: false,
        errorColor: "#ff3366", // --color-accent-red
        // Warnings (unicode in math mode, deprecated commands) must not
        // escalate to errors — a D-prompt writing a plain "±" is fine.
        strict: false,
        // trust:false keeps \href/\url/\includegraphics disabled. The output is
        // injected as HTML below, so this is what makes that safe.
        trust: false,
      });
    } catch {
      // KaTeX still throws on non-ParseError faults (non-string input, an
      // internal error). Signal the fallback rather than propagating.
      return null;
    }
  }, [tex, display]);

  // Fallback: visible source text. Ugly on purpose — a broken formula should be
  // obvious to whoever wrote it, without being fatal to everyone else.
  if (html === null) {
    return (
      <code
        className={cn(
          "block overflow-x-auto rounded border border-border-red bg-bg-elevated",
          "px-2 py-1 font-mono text-caption text-accent-red",
          className,
        )}
      >
        {tex}
      </code>
    );
  }

  if (!display) {
    return (
      <span
        className={cn(
          "inline-block max-w-full overflow-x-auto align-middle",
          className,
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div
      className={cn(
        // Property 3: the scroll box. -mx-1/px-1 keeps the glyph edges from
        // being clipped by the overflow container on a narrow screen.
        "my-2 -mx-1 overflow-x-auto overflow-y-hidden px-1 py-1",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
