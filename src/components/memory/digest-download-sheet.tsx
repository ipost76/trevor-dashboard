"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { BottomSheet, HapticButton } from "@/components/ui";
import { FileText, FileDown } from "lucide-react";
import { DigestMarkdown } from "./digest-markdown";

/**
 * DigestDownloadSheet + DigestPrintDocument — B7, rebuilt by D3.
 *
 * Mirrors the Hub's established download UX (src/components/docs/
 * download-format-sheet.tsx): a "DOWNLOAD AS" BottomSheet with two rows,
 * .md in cyan and PDF in red.
 *
 * - **Markdown** hits /api/health/digests/<date>/markdown, which serves
 *   body_md verbatim with Content-Disposition: attachment.
 *
 * - **PDF** is produced CLIENT-SIDE. The Docs zone's PDF path
 *   (convert_md_to_pdf.py → weasyprint) is NOT usable here: weasyprint is not
 *   installed on the WSL box, so that route is already broken on this host —
 *   a pre-existing defect this component deliberately neither depends on nor
 *   attempts to fix.
 *
 * 🚨 D3 (2026-07-31) — WHAT THIS USED TO DO, AND WHY IT WAS WRONG.
 *
 * The previous implementation cloned the rendered digest into a hidden 0×0
 * same-origin iframe carrying a standalone stylesheet and called
 * `iframe.contentWindow.print()`. The document it CONSTRUCTED was correct —
 * measured: full body, 8 tables, zero chrome. The browser simply did not print
 * it. `contentWindow.print()` is not scoped to the frame on WebKit/iOS, so the
 * TOP-LEVEL page printed instead: nav, live ticker strip, tab row, bottom nav,
 * the collapsed card summary, and no digest body at all.
 *
 * 🚨 That is why the print target is now the MAIN DOCUMENT and the isolation is
 * done in `@media print` (below). There is no iframe, no `srcdoc`, no popup and
 * no timer. Do not reintroduce an iframe print path: a correctly constructed
 * document that the browser declines to print is indistinguishable, from the
 * code's point of view, from one that printed fine.
 *
 * 🚨 THE PRINT ROOT MUST STAY MOUNTED FOR THE WHOLE PRINT LIFETIME. The old
 * path also carried a `setTimeout(cleanup, 1000)` that removed the iframe one
 * second after calling print() — printing is asynchronous on most engines, so
 * that tears the document out from under a slow render. Nothing here unmounts
 * the print root as a side effect of printing; in particular `handlePdf` does
 * NOT call `onClose()`, because closing the sheet drops `date` and would
 * unmount the very document being printed.
 */

interface DigestDownloadSheetProps {
  open: boolean;
  onClose: () => void;
  /** Digest date (YYYY-MM-DD). `null` collapses the sheet. */
  date: string | null;
  /** False while the printable document is still being fetched/rendered. */
  printReady: boolean;
}

type PdfPhase = "idle" | "pending" | "error";

/** Marks the one element that survives into the printed page. */
export const PRINT_ROOT_CLASS = "digest-print-root";

// Print stylesheet for the digest document.
//
// On SCREEN the print root is display:none. In PRINT media the page chrome is
// removed and the print root is revealed. It is deliberately NOT hidden with
// the `hidden` attribute: `hidden` is display:none, and a display:none element
// cannot be printed either — that was D3 cause 3, and it is why the previous
// implementation could never have produced a body even once the print target
// was right.
// The date is interpolated into an @page margin box (the running header), so it
// is restricted to the digits and hyphens a YYYY-MM-DD digest date can contain.
// Nothing else may reach the stylesheet.
const cssSafeDate = (date: string) => date.replace(/[^0-9-]/g, "");

const buildPrintCss = (date: string) => `
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
    margin: 16mm 14mm;
    @top-center {
      content: "TREVOR nightly digest · ${cssSafeDate(date)}";
      font-size: 8pt;
      color: #666;
      letter-spacing: 0.06em;
    }
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
     The digest markup carries the Hub's Tailwind classes. Inside the old
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
     cost a repeated title. The document is now a faithful print of body_md
     with no block bolted on top of it; the date survives as page furniture in
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

/**
 * The printable digest document.
 *
 * 🚨 THE INVARIANT, AND THE WHOLE POINT OF THIS COMPONENT: its content comes
 * from `body` — the digest's `body_md`, the same column the .md download
 * serves — and NEVER from the DOM. It does not read the card, it does not care
 * whether the card is expanded, and it is not a clone of anything on screen. A
 * download must not depend on what happens to be visible.
 *
 * It portals to <body> so it is a direct child of body, which is what lets the
 * single `body > *:not(.digest-print-root)` rule above isolate it from every
 * piece of page chrome at once.
 */
export function DigestPrintDocument({
  date,
  body,
}: {
  date: string | null;
  body: string | null;
}) {
  // document.body does not exist during SSR; portal only once mounted.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted || !date || !body) return null;

  return createPortal(
    <div className={PRINT_ROOT_CLASS} aria-hidden="true">
      {/* The stylesheet is passed as a TEXT CHILD. The Hub's no-raw-HTML-
          injection design is preserved here exactly as it is in
          digest-markdown: this component injects no markup of any kind. */}
      <style>{buildPrintCss(date)}</style>
      {/* 🚨 The print root now contains the stylesheet and body_md, and nothing
          else. D3's flowed header block was removed here — it repeated the
          title that body_md's own H1 already carries, which is the "header
          renders twice" defect Ghost reported on page 1. Page furniture lives
          entirely in @page margin boxes, so no element of ours can land on top
          of the report. Everything below this line is body_md. */}
      <DigestMarkdown source={body} />
    </div>,
    document.body,
  );
}

export function DigestDownloadSheet({
  open,
  onClose,
  date,
  printReady,
}: DigestDownloadSheetProps) {
  const [pdfPhase, setPdfPhase] = React.useState<PdfPhase>("idle");
  const errorTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // The print dialog offers document.title as the default PDF filename, so it
  // is swapped for the digest's name across the print and restored afterwards.
  const prevTitle = React.useRef<string | null>(null);
  const afterPrint = React.useRef<(() => void) | null>(null);

  const restoreTitle = React.useCallback(() => {
    if (prevTitle.current !== null) {
      document.title = prevTitle.current;
      prevTitle.current = null;
    }
  }, []);

  const detachAfterPrint = React.useCallback(() => {
    if (afterPrint.current) {
      window.removeEventListener("afterprint", afterPrint.current);
      afterPrint.current = null;
    }
  }, []);

  // Clear any "Failed" badge when the sheet opens for a different digest so a
  // previous error cannot leak across days. This is also the guaranteed
  // restore path for the document title: closing the sheet sets date to null.
  React.useEffect(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setPdfPhase("idle");
    detachAfterPrint();
    restoreTitle();
  }, [date, detachAfterPrint, restoreTitle]);

  React.useEffect(
    () => () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
      detachAfterPrint();
      restoreTitle();
    },
    [detachAfterPrint, restoreTitle],
  );

  const failPdf = React.useCallback(() => {
    setPdfPhase("error");
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setPdfPhase("idle"), 2500);
  }, []);

  const handleMd = () => {
    if (!date) return;
    const link = document.createElement("a");
    link.href = `/api/health/digests/${encodeURIComponent(date)}/markdown`;
    link.download = `trevor-digest-${date}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onClose();
  };

  const handlePdf = () => {
    if (!date || pdfPhase === "pending" || !printReady) return;
    setPdfPhase("pending");

    prevTitle.current = document.title;
    document.title = `trevor-digest-${date}`;

    // 🚨 Nothing in this handler may unmount the print root. onClose() is NOT
    // called here: it would clear `date` and drop the document mid-print. The
    // sheet is hidden by the print stylesheet anyway, so leaving it open costs
    // nothing on paper. Where the browser fires `afterprint` (desktop; iOS
    // Safari does not) the sheet is dismissed once printing is genuinely over.
    // That listener is a convenience — it is never load-bearing, and the
    // effects above restore the title with or without it.
    detachAfterPrint();
    const handler = () => {
      detachAfterPrint();
      restoreTitle();
      onClose();
    };
    afterPrint.current = handler;
    window.addEventListener("afterprint", handler);

    try {
      window.print();
      setPdfPhase("idle");
    } catch {
      detachAfterPrint();
      restoreTitle();
      failPdf();
    }
  };

  return (
    <BottomSheet open={open && date !== null} onClose={onClose} title="DOWNLOAD AS">
      {date && (
        <div className="space-y-3">
          {/* Digest context */}
          <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-bg-elevated/40 px-3 py-2">
            <FileText
              size={14}
              className="mt-0.5 shrink-0 text-accent-cyan-soft"
              aria-hidden
            />
            <span className="break-all font-mono text-caption text-fg-primary">
              trevor-digest-{date}
            </span>
          </div>

          {/* Format rows */}
          <ul className="space-y-1.5" role="list">
            <li>
              <HapticButton
                variant="ghost"
                size="sm"
                onClick={handleMd}
                aria-label={`Download the ${date} digest as Markdown`}
                className="flex w-full items-center justify-between gap-3 border border-accent-cyan-soft/40 bg-accent-cyan-soft/10 px-3 py-2 text-left text-accent-cyan-soft-strong hover:bg-accent-cyan-soft/20"
              >
                <span className="flex items-center gap-2 font-sans text-caption">
                  <FileText size={14} className="shrink-0" aria-hidden />
                  <span>Download .md</span>
                </span>
                <span className="shrink-0 font-sans text-micro text-fg-muted">
                  Original markdown
                </span>
              </HapticButton>
            </li>
            <li>
              <HapticButton
                variant="ghost"
                size="sm"
                onClick={handlePdf}
                disabled={pdfPhase === "pending" || !printReady}
                aria-label={`Download the ${date} digest as PDF`}
                className={[
                  "flex w-full items-center justify-between gap-3 border px-3 py-2 text-left",
                  pdfPhase === "error"
                    ? "border-accent-red/40 bg-accent-red/15 text-accent-red"
                    : "border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/20",
                  pdfPhase === "pending" || !printReady ? "opacity-60" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-2 font-sans text-caption">
                  <FileDown size={14} className="shrink-0" aria-hidden />
                  <span>Download PDF</span>
                </span>
                <span className="shrink-0 font-sans text-micro text-fg-muted">
                  {pdfPhase === "pending"
                    ? "Opening print…"
                    : pdfPhase === "error"
                      ? "Failed"
                      : !printReady
                        ? "Preparing…"
                        : "Via print dialog"}
                </span>
              </HapticButton>
            </li>
          </ul>

          <p className="px-1 font-sans text-micro leading-relaxed text-fg-muted">
            PDF uses your browser&apos;s print dialog — choose &ldquo;Save as
            PDF&rdquo; (on iPhone: Share → Save to Files).
          </p>
        </div>
      )}
    </BottomSheet>
  );
}
