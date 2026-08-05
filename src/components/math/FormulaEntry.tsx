import * as React from "react";
import { MathTex } from "./MathTex";
import { StatusBadge } from "./StatusBadge";
import type { FormulaEntryProps } from "./values";

/**
 * FormulaEntry — THE CONTRACT. [B1, 2026-08-05]
 *
 * All 88 formula entries render through this one component. D1–D6 import it and
 * pass data; they do NOT restyle it and they do NOT fork it. If six prompts each
 * style their own entry, the page reads as six pages.
 *
 * Render order is fixed:
 *   ID + name + badge(s) [+ fired]
 *     → status note
 *     → source
 *     → formula(s)
 *     → symbol glossary
 *     → why it works
 *     → standing values
 *     → caveat
 *
 * 🚨 THE CAVEAT RENDERS INLINE AND PROMINENT, NOT AS A FOOTNOTE. Several
 * entries carry a warning that would teach Ghost something false if it were
 * buried — "this fires, but the value that would trigger it is never reached",
 * that class of thing. It gets a bordered callout, not small print.
 *
 * `id` is the anchor. `scroll-mt-20` keeps the heading clear of the sticky
 * chrome when a table-of-contents link jumps here.
 */

export function FormulaEntry({
  id,
  name,
  status,
  overlay,
  statusNote,
  source,
  tex,
  symbols,
  why,
  values,
  caveat,
  fired,
}: FormulaEntryProps) {
  const formulas = Array.isArray(tex) ? tex : [tex];

  return (
    <article
      id={id}
      className="scroll-mt-24 rounded-lg border border-border-subtle bg-bg-card p-4 sm:p-5"
    >
      {/* ── ID + name + badges ─────────────────────────────────────────── */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-micro text-fg-dim">{id}</span>
          <h3 className="text-h3 text-fg-primary">{name}</h3>
          <StatusBadge status={status} />
          {overlay ? <StatusBadge status={overlay} /> : null}
          {fired ? (
            <span className="font-mono text-micro text-fg-muted">{fired}</span>
          ) : null}
        </div>

        {statusNote ? (
          <p className="text-caption text-fg-muted">{statusNote}</p>
        ) : null}

        {/* module.symbol — never a line number; line numbers rot, symbols don't. */}
        <p className="font-mono text-caption text-fg-dim break-all">{source}</p>
      </header>

      {/* ── Formulas ───────────────────────────────────────────────────── */}
      <div className="mt-3">
        {formulas.map((t, i) => (
          <MathTex key={i} tex={t} />
        ))}
      </div>

      {/* ── Symbol glossary ────────────────────────────────────────────── */}
      {symbols.length > 0 ? (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
          {symbols.map((s, i) => (
            <React.Fragment key={i}>
              <dt className="text-caption text-fg-primary">
                <MathTex tex={s.sym} display={false} />
              </dt>
              <dd className="text-caption text-fg-muted">{s.means}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}

      {/* ── Why it works ───────────────────────────────────────────────── */}
      <div className="mt-4">
        <h4 className="text-micro text-fg-dim">Why it works</h4>
        <p className="mt-1 text-caption-ui text-fg-primary">{why}</p>
      </div>

      {/* ── Standing values ────────────────────────────────────────────── */}
      {values && values.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-micro text-fg-dim">Standing values</h4>
          <ul className="mt-1.5 space-y-1">
            {values.map((v, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline gap-x-2 text-caption"
              >
                <span className="text-fg-muted">{v.label}</span>
                <span className="font-mono text-fg-primary tabular-nums">
                  {v.value}
                </span>
                {v.note ? (
                  <span className="text-fg-dim">— {v.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ── Caveat — inline and prominent, never a footnote ────────────── */}
      {caveat ? (
        <div className="mt-4 rounded border border-border-amber bg-accent-amber/5 p-3">
          <p className="text-caption text-fg-primary">
            <span aria-hidden="true">🚨 </span>
            <span className="sr-only">Caveat: </span>
            {caveat}
          </p>
        </div>
      ) : null}
    </article>
  );
}
