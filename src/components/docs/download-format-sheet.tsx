"use client";
import * as React from "react";
import { BottomSheet, HapticButton } from "@/components/ui";
import { FileText, FileDown } from "lucide-react";

/**
 * DownloadFormatSheet — Phase 2 (PDF download wave), PDF path rebuilt by B4.
 *
 * Opened from the DOWNLOAD button on each file card. Two rows:
 * - Download .md (cyan): the original direct-link flow (browser handles the
 *   blob via `<a download>` against /api/intel/downloads/[filename]).
 * - Download PDF (red): prints CLIENT-SIDE through the browser's own print
 *   path — see below.
 *
 * 🚨 B4 (2026-08-01) — WHAT THIS USED TO DO, AND WHY IT NEVER WORKED HERE.
 *
 * The PDF row used to fetch /api/docs/downloads/<f>/pdf, which runs
 * convert_md_to_pdf.py, which imports `weasyprint` at module top level.
 * MEASURED on this box: `ModuleNotFoundError: No module named 'weasyprint'`
 * (and `pygments` likewise). The import fails before the script's own
 * try/except can emit a JSON error, so runPython threw and the route returned
 * 500 on every call — the button has been showing "Failed" for its whole life.
 * Installing the dependency needs root, which `trevor` does not have
 * (FORTRESS-C4), so it was never going to be fixed that way.
 *
 * It now uses the SAME mechanism D3/D4 built and verified for the nightly
 * digest: the document is rendered into a portalled print root that is hidden
 * on screen and revealed in `@media print`, and `window.print()` prints the
 * main document. Zero new dependencies — that is the whole point.
 *
 * 🚨 The print root is mounted by the PARENT (downloads-section), not here, and
 * nothing in `handlePdf` may unmount it: `onClose()` is deliberately NOT called
 * on the print path, because closing the sheet clears the filename and would
 * drop the document mid-print. Printing is asynchronous on most engines.
 *
 * Cyan / red accents match the existing `fileTypePillTone` convention in
 * `downloads-section.tsx` (`.md` → cyan, `.pdf` → red).
 */

interface DownloadFormatSheetProps {
  open: boolean;
  onClose: () => void;
  /** Filename being downloaded. `null` collapses the sheet. */
  filename: string | null;
  /** False while the printable document is still being fetched/rendered. */
  printReady: boolean;
  /**
   * True when the source could not be fetched. Distinguished from "still
   * loading" so the row can say which one it is instead of spinning forever.
   */
  printFailed: boolean;
}

type PdfPhase = "idle" | "pending" | "error";

/** Only markdown can be printed — it is the only thing the renderer parses. */
export const isPrintable = (filename: string | null): boolean =>
  Boolean(filename && filename.toLowerCase().endsWith(".md"));

export function DownloadFormatSheet({
  open,
  onClose,
  filename,
  printReady,
  printFailed,
}: DownloadFormatSheetProps) {
  const [pdfPhase, setPdfPhase] = React.useState<PdfPhase>("idle");
  const errorTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // The print dialog offers document.title as the default PDF filename, so it
  // is swapped for the document's name across the print and restored after.
  const prevTitle = React.useRef<string | null>(null);
  const afterPrint = React.useRef<(() => void) | null>(null);

  const printable = isPrintable(filename);
  const pdfName = filename ? filename.replace(/\.md$/i, "") : "";

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

  // Reset any "Failed" badge whenever the sheet opens for a new file so a
  // previous error can't leak across files. This is also the guaranteed
  // restore path for the document title: closing the sheet clears filename.
  React.useEffect(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setPdfPhase("idle");
    detachAfterPrint();
    restoreTitle();
  }, [filename, detachAfterPrint, restoreTitle]);

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
    if (!filename) return;
    const link = document.createElement("a");
    link.href = `/api/intel/downloads/${encodeURIComponent(filename)}`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onClose();
  };

  const handlePdf = () => {
    if (!filename || !printable || pdfPhase === "pending" || !printReady) return;
    setPdfPhase("pending");

    prevTitle.current = document.title;
    document.title = pdfName;

    // 🚨 onClose() is NOT called here — see the component docblock. Dismissal
    // happens only via `afterprint`, which is a convenience (iOS Safari does
    // not fire it) and is never load-bearing: the effects above restore the
    // title with or without it.
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

  // One place decides the PDF row's copy, so "disabled" and the hint can never
  // disagree about why.
  const pdfDisabled =
    !printable || printFailed || pdfPhase === "pending" || !printReady;
  const pdfHint = !printable
    ? "Markdown only"
    : printFailed
      ? "Couldn't read the file"
      : pdfPhase === "pending"
        ? "Opening print…"
        : pdfPhase === "error"
          ? "Failed"
          : !printReady
            ? "Preparing…"
            : "Via print dialog";

  return (
    <BottomSheet
      open={open && filename !== null}
      onClose={onClose}
      title="DOWNLOAD AS"
    >
      {filename && (
        <div className="space-y-3">
          {/* File context — break-all so long filenames wrap, not overflow */}
          <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-bg-elevated/40 px-3 py-2">
            <FileText
              size={14}
              className="mt-0.5 shrink-0 text-accent-cyan-soft"
              aria-hidden
            />
            <span className="break-all font-mono text-caption text-fg-primary">
              {filename}
            </span>
          </div>

          {/* Format rows */}
          <ul className="space-y-1.5" role="list">
            <li>
              <HapticButton
                variant="ghost"
                size="sm"
                onClick={handleMd}
                aria-label={`Download ${filename} as Markdown`}
                className="flex w-full items-center justify-between gap-3 border border-accent-cyan-soft/40 bg-accent-cyan-soft/10 px-3 py-2 text-left text-accent-cyan-soft-strong hover:bg-accent-cyan-soft/20"
              >
                <span className="flex items-center gap-2 font-sans text-caption">
                  <FileText size={14} className="shrink-0" aria-hidden />
                  <span>Download .md</span>
                </span>
                <span className="shrink-0 font-sans text-micro text-fg-muted">
                  Original file
                </span>
              </HapticButton>
            </li>
            <li>
              <HapticButton
                variant="ghost"
                size="sm"
                onClick={handlePdf}
                disabled={pdfDisabled}
                aria-label={`Download ${filename} as PDF`}
                className={[
                  "flex w-full items-center justify-between gap-3 border px-3 py-2 text-left",
                  pdfPhase === "error"
                    ? "border-accent-red/40 bg-accent-red/15 text-accent-red"
                    : "border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/20",
                  pdfDisabled ? "opacity-60" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-2 font-sans text-caption">
                  <FileDown size={14} className="shrink-0" aria-hidden />
                  <span>Download PDF</span>
                </span>
                <span className="shrink-0 font-sans text-micro text-fg-muted">
                  {pdfHint}
                </span>
              </HapticButton>
            </li>
          </ul>

          {printable && (
            <p className="px-1 font-sans text-micro leading-relaxed text-fg-muted">
              PDF uses your browser&apos;s print dialog — choose &ldquo;Save as
              PDF&rdquo; (on iPhone: Share → Save to Files).
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
