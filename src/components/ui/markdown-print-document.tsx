"use client";
import * as React from "react";
import { createPortal } from "react-dom";

/**
 * MarkdownPrintDocument — the Hub's shared print path.  [B4, 2026-08-01]
 *
 * Extracted VERBATIM from digest-download-sheet.tsx, where D3 and D4 built and
 * measured it for the nightly digest. Nothing in the stylesheet below is new;
 * every rule that carries a "D3 cause N" or "D4 defect N" marker was found by
 * rendering a real page and looking at the output, and those markers are kept
 * so the next reader can tell a measured rule from a decorative one.
 *
 * 🚨 WHY THIS IS SHARED RATHER THAN COPIED. Both consumers — the nightly digest
 * and the Docs zone — render their markdown through the SAME `digest-markdown`
 * component, so the element tree these selectors target is not merely similar,
 * it is identical. Of the whole stylesheet exactly ONE thing was ever
 * digest-specific: the running-header text. Copying would fork ~280 lines of
 * individually-measured findings, and the next print fix would land in one copy
 * and silently not the other.
 *
 * 🚨 THE COST OF THAT, STATED WHERE SOMEONE WILL HIT IT: a change to this
 * stylesheet now changes the Docs PDF **and** the digest PDF. Both must be
 * regression-rendered before any print change ships. Do not "quickly tweak" a
 * rule here for one surface without printing the other.
 *
 * 🚨 PASS `digest-markdown` OUTPUT AS `children`. This module takes children
 * rather than a markdown string so that shared UI does not depend on a feature
 * directory — but the stylesheet is NOT renderer-agnostic. It specifically
 * undoes `whitespace-nowrap` on `th` and the `overflow-x-auto` table wrapper,
 * both of which are things `digest-markdown` emits. Another renderer's output
 * would not be styled correctly.
 */

/**
 * Marks the one element that survives into the printed page.
 *
 * ⚠️ The VALUE is historic. It reads `digest-print-root` because the digest is
 * where this mechanism was built; it is now generic and used by Docs too. The
 * name is deliberately NOT renamed: renaming is behaviour-neutral churn that
 * would invalidate the selector D3's write-up records, for nothing. Only one
 * print root is ever mounted at a time — the digest's lives on
 * /health?tab=activity and the Docs one on /docs, so they cannot co-mount.
 */
export const PRINT_ROOT_CLASS = "digest-print-root";

/**
 * Sanitise a label for interpolation into a CSS `content:` string.
 *
 * 🚨 THIS IS THE ONE GENUINELY NEW RISK THE SHARE INTRODUCES, so it is handled
 * before anything else. The digest's version of this only ever saw a
 * `YYYY-MM-DD` date and whitelisted `[0-9-]`. A Docs label carries a FILENAME —
 * arbitrary text heading into a CSS string literal, which is an injection
 * surface.
 *
 * WHITELIST, NOT ESCAPE, and REJECT rather than repair: a label containing any
 * character outside the allowed set returns `null` and the running header is
 * omitted entirely. Stripping the offending characters instead would silently
 * print a DIFFERENT name than the file actually has, which is its own defect —
 * and an escaper is one missed edge case away from being no protection at all.
 *
 * Length is treated differently on purpose, and the distinction is the point:
 * over-length is a LAYOUT concern, not a security one. Truncating a string
 * whose characters are already all whitelisted cannot introduce a quote or a
 * closing brace, so a long-but-safe label is trimmed rather than rejected —
 * otherwise the longest report names, which are the most useful to label, would
 * be the ones that silently lose their header.
 *
 * Absent furniture beats wrong furniture. That is already this stylesheet's
 * established principle — see the WebKit note on @page margin boxes below.
 */
const LABEL_ALLOWED = /^[A-Za-z0-9 ._·—-]*$/;
const LABEL_MAX = 90;

export function cssSafeLabel(label: string | null | undefined): string | null {
  if (!label) return null;
  if (!LABEL_ALLOWED.test(label)) return null; // reject, never repair
  const trimmed = label.length > LABEL_MAX ? label.slice(0, LABEL_MAX) : label;
  return trimmed.trim() || null;
}

export const buildPrintCss = (label: string | null) => {
  const safe = cssSafeLabel(label);
  // A rejected or absent label drops the @top-center block entirely rather than
  // emitting an empty one.
  const runningHeader = safe
    ? `
    @top-center {
      content: "${safe}";
      font-size: 8pt;
      color: #666;
      letter-spacing: 0.06em;
    }`
    : "";

  return `
.${PRINT_ROOT_CLASS} { display: none; }

@media print {
  /* ---- D3 cause 2: total isolation from the page chrome -------------------
     The print root is portalled to <body>, so it is a DIRECT child of body.
     ONE rule therefore removes the sidebar rail, the header and its live
     ticker strip, the zone sub-tab row, the bottom nav, the notes widget and
     any open BottomSheet. None of that belongs in a downloaded report, and
     before D3 there was no @media print rule anywhere in the Hub at all. */
  body > *:not(.${PRINT_ROOT_CLASS}) { display: none !important; }

  /* ---- D4 defect 1: what 'body > *' STRUCTURALLY CANNOT REACH -------------
     D3 scoped the isolation by TREE POSITION. Two things that print have no
     position in the tree, so no child selector can ever match them. Both were
     measured on a real headless render of this page, by A/B probe:

       1. body::before / body::after (globals.css) are position:fixed inset:0
          grid + scanline overlays. Pseudo-elements are NOT children. They were
          painting their texture over every page of the report: disabling them
          moved page-1 content from grey 247 to 255 (pure white).

       2. The root's dark 'color-scheme' paints the page CANVAS — including the
          whole 14mm @page margin — #121212. An author background cannot
          repaint a canvas the UA colours from color-scheme, which is why D3's
          'background: #fff !important' on html/body did not (and could not)
          fix it: measured margin grey 18, and 255 after this one line.

     🚨 Isolate by INTENT, not by tree position. A rule that names 'body > *'
     is a rule about where a node sits, and the things that broke this report
     do not sit anywhere. */
  body::before, body::after,
  html::before, html::after {
    display: none !important;
    content: none !important;
  }
  :root { color-scheme: light !important; }

  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
  }

  /* ---- D4 defect 5: page furniture ---------------------------------------
     Running header + page number, both as @page MARGIN BOXES.
     MEASURED: Chrome 150 honours these — "N / M" appeared on pages 1, 2, 6 and
     18 of a real 18-page render. WebKit does NOT implement @page margin boxes,
     so on iOS this produces nothing at all. That is a graceful absence, and it
     is deliberate — see below.

     🚨 A position:fixed running-header ELEMENT was built as the WebKit half,
     measured, and REMOVED. Two findings killed it:
       1. It does not sit where it is told. With top:-9mm (i.e. inside the top
          margin) Chrome painted it at the BOTTOM of the page area, on top of
          the last line of content, on every page. Verified by giving it a
          yellow background and rasterising: the strip lands over the text.
          top:0 places it over the FIRST line instead. A fixed box cannot
          reserve space per page, so there is no offset that makes it safe.
       2. It is the same shape as the defect this stylesheet exists to remove.
          The two things that escaped D3's isolation were inset:0 position:fixed
          boxes; adding another fixed box to the print root would reintroduce
          the exact mechanism on the one engine that cannot be tested here.
     A margin box cannot overlap content — the margin is reserved by
     definition. Absent furniture on iOS beats furniture printed over the
     report. Do not "restore the WebKit fallback" without solving (1). */
  @page {
    margin: 16mm 14mm;${runningHeader}
    @bottom-center {
      content: counter(page) " / " counter(pages);
      font-size: 8pt;
      color: #666;
    }
  }

  .${PRINT_ROOT_CLASS} {
    display: block !important;
    width: auto !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #111 !important;
    background: #fff !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;

    /* ---- D4 defect 2: ligatures ------------------------------------------
       On iOS '-apple-system' resolves to SF Pro, WebKit forms the ff/fi/ffi
       ligatures by default, and its PDF export writes those glyphs with a
       mis-mapped index — "effective" prints e!ective / e"ective, "attempted"
       prints a!empted. The giveaway that it is a glyph-index fault and not a
       missing glyph: the SAME "!" stands in for BOTH the ff of "effective"
       and the tt of "attempted".
       Never forming the ligature is the cheapest correct fix — there is then
       no ligature glyph to mis-map. This property inherits, so the whole
       document is covered from here. */
    font-variant-ligatures: none;
    -webkit-font-feature-settings: "liga" 0, "clig" 0, "dlig" 0, "hlig" 0;
    font-feature-settings: "liga" 0, "clig" 0, "dlig" 0, "hlig" 0;
  }

  /* ---- D3 cause 5: neutralise the dark-theme utilities --------------------
     The markdown markup carries the Hub's Tailwind classes. Inside the old
     iframe they never resolved, so styling by tag was enough. On THIS document
     they do resolve, so they are overridden here — otherwise the report prints
     pale-on-white. "overflow: visible" is load-bearing too: the renderer wraps
     every table in an "overflow-x-auto" div, which clips on paper.
     text-align is deliberately NOT set — digest-markdown always applies an
     explicit alignment class to every th/td, and clobbering it here would
     silently drop the tables' GFM column alignment. */
  .${PRINT_ROOT_CLASS} * {
    color: #111 !important;
    background: transparent !important;
    border-color: #ccc !important;
    box-shadow: none !important;
    text-shadow: none !important;
    position: static !important;
    float: none !important;
    overflow: visible !important;
    max-height: none !important;
    max-width: 100% !important;
  }

  /* ---- D4: D3's identifying header block is GONE -------------------------
     It rendered "TREVOR NIGHTLY DIGEST / <date>" immediately above body_md's
     own H1, "TREVOR NIGHTLY DIGEST — <date> (ET)" — a literal duplicate, and
     the "the header renders twice" Ghost reported on page 1. The H1 already
     carries both the title and the date, so the wrapper bought nothing and
     cost a repeated title. The document is now a faithful print of the source
     with no block bolted on top of it; the label survives as page furniture in
     the running header above, which is where furniture belongs. */

  /* ---- document typography ----------------------------------------------
     digest-markdown maps markdown "#" to <h2>, "##" to <h3> and so on (it
     shifts one level so the page keeps a single document h1), so the scale
     below is anchored on h2, not h1. */
  .${PRINT_ROOT_CLASS} h1, .${PRINT_ROOT_CLASS} h2, .${PRINT_ROOT_CLASS} h3,
  .${PRINT_ROOT_CLASS} h4, .${PRINT_ROOT_CLASS} h5, .${PRINT_ROOT_CLASS} h6 {
    color: #000 !important;
    font-weight: 700;
    line-height: 1.25;
    margin: 1.1em 0 0.45em;
    break-after: avoid;
    page-break-after: avoid;
  }
  .${PRINT_ROOT_CLASS} h2 { font-size: 17pt; margin-top: 0; }
  .${PRINT_ROOT_CLASS} h3 {
    font-size: 13.5pt;
    border-bottom: 1px solid #ccc !important;
    padding-bottom: 3px;
  }
  .${PRINT_ROOT_CLASS} h4 { font-size: 11.5pt; }
  .${PRINT_ROOT_CLASS} h5, .${PRINT_ROOT_CLASS} h6 {
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #444 !important;
  }

  .${PRINT_ROOT_CLASS} p { margin: 0.5em 0; orphans: 3; widows: 3; }
  .${PRINT_ROOT_CLASS} strong { font-weight: 700; }
  .${PRINT_ROOT_CLASS} em { font-style: italic; color: #444 !important; }
  .${PRINT_ROOT_CLASS} a { color: #0645ad !important; text-decoration: underline; }
  .${PRINT_ROOT_CLASS} hr {
    border: 0 !important;
    border-top: 1px solid #ddd !important;
    margin: 1.2em 0;
  }
  .${PRINT_ROOT_CLASS} blockquote {
    margin: 0.7em 0;
    padding: 0.3em 0 0.3em 0.8em;
    border-left: 3px solid #ccc !important;
    color: #444 !important;
  }

  .${PRINT_ROOT_CLASS} ul { list-style: disc outside !important; }
  .${PRINT_ROOT_CLASS} ol { list-style: decimal outside !important; }
  .${PRINT_ROOT_CLASS} ul, .${PRINT_ROOT_CLASS} ol {
    margin: 0.5em 0;
    padding-left: 1.4em !important;
  }
  .${PRINT_ROOT_CLASS} li { margin: 0.2em 0; break-inside: avoid; page-break-inside: avoid; }
  .${PRINT_ROOT_CLASS} li > ul, .${PRINT_ROOT_CLASS} li > ol { margin: 0.2em 0; }
  .${PRINT_ROOT_CLASS} li::marker { color: #444 !important; }

  .${PRINT_ROOT_CLASS} code, .${PRINT_ROOT_CLASS} pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 9pt;
    background: #f4f4f6 !important;
    border: 1px solid #e0e0e4 !important;
    border-radius: 3px;
  }
  .${PRINT_ROOT_CLASS} code { padding: 0 3px; }
  .${PRINT_ROOT_CLASS} pre {
    padding: 8px 10px;
    white-space: pre-wrap !important;
    word-wrap: break-word;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .${PRINT_ROOT_CLASS} pre code {
    border: 0 !important;
    padding: 0;
    background: none !important;
  }

  /* ---- D3 cause 4: degenerate shapes -------------------------------------
     A 558-line report with 8 tables must PAGINATE, not clip.
       - break-inside is set on ROWS, never on the table. A "page-break-inside:
         avoid" on a table taller than one page pushes the whole table to the
         next page and then clips it — the exact failure this must prevent.
       - thead repeats on every page a table spans.
       - table-layout: fixed plus word-break makes a table wider than the sheet
         WRAP rather than run off the edge; digest-markdown sets
         "whitespace-nowrap" on every th, which is undone here for the same
         reason. */
  .${PRINT_ROOT_CLASS} table {
    border-collapse: collapse !important;
    width: 100% !important;
    /* 🚨 DECLARED BUT NOT GOVERNING — do not read this line as "column widths
       are pinned". MEASURED (D4): rendering the same page with
       'table-layout: auto !important' and with 'fixed !important' produces a
       BYTE-IDENTICAL page image (sha of the extracted text and the 174,308-byte
       PNG both match). Under a governing fixed layout the columns would be
       divided EQUALLY, and they are visibly not; that is also why the
       overflow-wrap change below was able to move column widths at all, which
       fixed layout would have made impossible. It is left in place rather than
       removed because removing it is a behaviour change nothing measured asked
       for — but the next reader should know it is inert here. */
    table-layout: fixed !important;
    margin: 0.7em 0;
    font-size: 8.5pt;
    break-inside: auto;
    page-break-inside: auto;
  }
  .${PRINT_ROOT_CLASS} thead { display: table-header-group; }
  .${PRINT_ROOT_CLASS} tfoot { display: table-footer-group; }
  .${PRINT_ROOT_CLASS} tr { break-inside: avoid; page-break-inside: avoid; }
  .${PRINT_ROOT_CLASS} th, .${PRINT_ROOT_CLASS} td {
    border: 1px solid #ccc !important;
    padding: 3px 5px;
    vertical-align: top;
    white-space: normal !important;
    /* ---- D4 defect 3: narrow columns wrapping mid-token ------------------
       This was 'word-break: break-word; overflow-wrap: anywhere', and
       'anywhere' is the defect. It differs from 'break-word' in exactly one
       way that matters here: it COLLAPSES THE CELL'S INTRINSIC MIN-CONTENT
       WIDTH TO ONE CHARACTER. The auto table layout then had licence to
       squeeze the narrow columns to nothing, so the equity reconciliation
       table broke "+$0.00" as "+$0." / "00" and "UNKNOWN" as "UNKN" / "OWN".
       'break-word' still breaks a genuinely over-long token rather than let
       it overflow, but it does NOT feed back into min-content sizing, so the
       columns size to their content again. Measured: with this pair, +$0.00,
       +0.0% and UNKNOWN each render on one line and "since cutover" wraps at
       the space, not mid-word.
       🚨 Do not restore 'overflow-wrap: anywhere' here. */
    word-break: normal;
    overflow-wrap: break-word;
  }
  .${PRINT_ROOT_CLASS} th {
    background: #f0f0f2 !important;
    font-weight: 700;
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .${PRINT_ROOT_CLASS} td {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
}
`;
};

/**
 * The printable document.
 *
 * 🚨 THE INVARIANT, AND THE WHOLE POINT OF THIS COMPONENT: its content comes
 * from the source document — the digest's `body_md`, or the Docs file's raw
 * markdown, the same bytes the .md download serves — and NEVER from the DOM. It
 * does not read the card, it does not care whether anything is expanded, and it
 * is not a clone of anything on screen. A download must not depend on what
 * happens to be visible.
 *
 * It portals to <body> so it is a direct child of body, which is what lets the
 * single `body > *:not(.digest-print-root)` rule above isolate it from every
 * piece of page chrome at once.
 *
 * 🚨 DO NOT reintroduce an iframe print path. D3's original cloned into a hidden
 * 0×0 same-origin iframe and called `contentWindow.print()`; that is not scoped
 * to the frame on WebKit/iOS, so the TOP-LEVEL page printed instead — nav,
 * ticker, tab row, and no document body at all. A correctly constructed document
 * the browser declines to print is, from the code's point of view, identical to
 * one that printed fine.
 */
export function MarkdownPrintDocument({
  label,
  ready,
  children,
}: {
  /** Running-header text. Rejected (header omitted) if it is not CSS-safe. */
  label: string | null;
  /** False while the source document is still being fetched. */
  ready: boolean;
  /** The rendered markdown — pass `digest-markdown` output. */
  children: React.ReactNode;
}) {
  // document.body does not exist during SSR; portal only once mounted.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted || !ready) return null;

  return createPortal(
    <div className={PRINT_ROOT_CLASS} aria-hidden="true">
      {/* The stylesheet is passed as a TEXT CHILD. The Hub's no-raw-HTML-
          injection design is preserved here exactly as it is in
          digest-markdown: this component injects no markup of any kind, and
          the repo-wide dangerouslySetInnerHTML usage count stays 0. */}
      <style>{buildPrintCss(label)}</style>
      {children}
    </div>,
    document.body,
  );
}
