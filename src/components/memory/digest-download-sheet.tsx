"use client";
import * as React from "react";
import { BottomSheet, HapticButton } from "@/components/ui";
import { FileText, FileDown } from "lucide-react";
import { DigestMarkdown } from "./digest-markdown";
import {
  MarkdownPrintDocument,
  PRINT_ROOT_CLASS as SHARED_PRINT_ROOT_CLASS,
} from "@/components/ui/markdown-print-document";

/**
 * DigestDownloadSheet + DigestPrintDocument — B7, rebuilt by D3/D4, shared by B4.
 *
 * Mirrors the Hub's established download UX (src/components/docs/
 * download-format-sheet.tsx): a "DOWNLOAD AS" BottomSheet with two rows,
 * .md in cyan and PDF in red.
 *
 * - **Markdown** hits /api/health/digests/<date>/markdown, which serves
 *   body_md verbatim with Content-Disposition: attachment.
 *
 * - **PDF** is produced CLIENT-SIDE via the browser's own print path.
 *
 * 🚨 B4 (2026-08-01) — THE PRINT MACHINERY MOVED, THE BEHAVIOUR DID NOT.
 * `PRINT_ROOT_CLASS`, the `@media print` stylesheet and the portalled print
 * document now live in components/ui/markdown-print-document.tsx, because the
 * Docs zone needed exactly the same thing and copying ~280 lines of measured
 * print findings would have forked them. Everything below is a thin wrapper;
 * the emitted stylesheet for a digest is unchanged.
 *
 * 🚨 THE COUPLING THAT CREATES: a change to the shared print stylesheet now
 * affects the Docs PDF too, and vice versa. Regression-render BOTH before
 * shipping any print change. Read the header of the shared module first.
 *
 * The D3/D4 findings that produced that stylesheet — why there is no iframe,
 * why the isolation is by intent rather than tree position, why the running
 * header is an @page margin box and not an element — are recorded there,
 * alongside the rules they justify.
 *
 * 🚨 THE PRINT ROOT MUST STAY MOUNTED FOR THE WHOLE PRINT LIFETIME. The old
 * path carried a `setTimeout(cleanup, 1000)` that removed its iframe one second
 * after calling print() — printing is asynchronous on most engines, so that
 * tears the document out from under a slow render. Nothing here unmounts the
 * print root as a side effect of printing; in particular `handlePdf` does NOT
 * call `onClose()`, because closing the sheet drops `date` and would unmount
 * the very document being printed.
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

/**
 * Re-exported so existing importers (activity-feed-section) are untouched.
 * The value is defined once, in the shared module.
 */
export const PRINT_ROOT_CLASS = SHARED_PRINT_ROOT_CLASS;

/**
 * The printable digest document.
 *
 * 🚨 THE INVARIANT: its content comes from `body` — the digest's `body_md`, the
 * same column the .md download serves — and NEVER from the DOM. It does not
 * read the card, it does not care whether the card is expanded, and it is not a
 * clone of anything on screen. A user can hit Download on a COLLAPSED card.
 */
export function DigestPrintDocument({
  date,
  body,
}: {
  date: string | null;
  body: string | null;
}) {
  return (
    <MarkdownPrintDocument
      label={date ? `TREVOR nightly digest · ${date}` : null}
      ready={Boolean(date && body)}
    >
      {/* 🚨 The print root contains the stylesheet and body_md, and nothing
          else. D3's flowed header block was removed by D4 — it repeated the
          title that body_md's own H1 already carries, which is the "header
          renders twice" defect Ghost reported on page 1. Page furniture lives
          entirely in @page margin boxes, so no element of ours can land on top
          of the report. */}
      <DigestMarkdown source={body ?? ""} />
    </MarkdownPrintDocument>
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
