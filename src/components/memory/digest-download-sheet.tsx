"use client";
import * as React from "react";
import { BottomSheet, HapticButton } from "@/components/ui";
import { FileText, FileDown } from "lucide-react";

/**
 * DigestDownloadSheet — B7.
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
 *   attempts to fix. Instead the already-rendered digest DOM is cloned into a
 *   hidden same-origin iframe carrying a print-only stylesheet, and the
 *   browser's own print-to-PDF produces the file. Zero new dependencies, real
 *   selectable text, correct tables, and on iOS the system share sheet offers
 *   "Save to Files".
 *
 * If the iframe print path is unavailable, it falls back to opening the same
 * standalone document in a new tab so the user can print or share it there.
 * It never silently does nothing.
 */

interface DigestDownloadSheetProps {
  open: boolean;
  onClose: () => void;
  /** Digest date (YYYY-MM-DD). `null` collapses the sheet. */
  date: string | null;
  /** Returns the live DOM node holding the rendered digest, for print. */
  getPrintNode: () => HTMLElement | null;
  /** False while the printable document is still being fetched/rendered. */
  printReady: boolean;
}

type PdfPhase = "idle" | "pending" | "error";

// Print-only stylesheet for the standalone document. Tailwind classes do not
// resolve inside the iframe, so everything is styled by tag — which is what we
// want: a clean black-on-white document rather than a dark-theme screenshot.
const PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 11pt; line-height: 1.5; color: #111; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1, h2, h3, h4, h5, h6 { color: #000; line-height: 1.25; margin: 1.1em 0 0.45em; page-break-after: avoid; }
  h1 { font-size: 19pt; margin-top: 0; }
  h2 { font-size: 15pt; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  h3 { font-size: 12.5pt; }
  h4, h5, h6 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.05em; color: #444; }
  p { margin: 0.5em 0; orphans: 3; widows: 3; }
  em { color: #444; }
  a { color: #0645ad; text-decoration: underline; }
  code, pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 9.5pt; background: #f4f4f6; border: 1px solid #e0e0e4; border-radius: 3px;
  }
  code { padding: 0 3px; }
  pre { padding: 8px 10px; white-space: pre-wrap; word-wrap: break-word; }
  pre code { border: 0; padding: 0; background: none; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 1.2em 0; }
  blockquote { margin: 0.7em 0; padding: 0.3em 0 0.3em 0.8em; border-left: 3px solid #ccc; color: #444; }
  ul, ol { margin: 0.5em 0; padding-left: 1.4em; }
  li { margin: 0.2em 0; }
  /* Nested lists sit tighter than a top-level one. This selector can only match
     content the renderer could not produce before nesting landed, so it cannot
     change how any existing digest prints. */
  li > ul, li > ol { margin: 0.2em 0; }
  table { border-collapse: collapse; width: 100%; margin: 0.7em 0; font-size: 9.5pt; page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 4px 7px; text-align: left; }
  th { background: #f0f0f2; font-weight: 600; text-transform: uppercase; font-size: 8.5pt; letter-spacing: 0.04em; }
  td { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  @page { margin: 14mm; }
`;

function buildPrintDocument(date: string, innerHtml: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    // The print dialog uses document.title as the default PDF filename.
    `<title>trevor-digest-${date}</title>` +
    `<style>${PRINT_CSS}</style></head><body>${innerHtml}</body></html>`
  );
}

export function DigestDownloadSheet({
  open,
  onClose,
  date,
  getPrintNode,
  printReady,
}: DigestDownloadSheetProps) {
  const [pdfPhase, setPdfPhase] = React.useState<PdfPhase>("idle");
  const errorTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any "Failed" badge when the sheet opens for a different digest so a
  // previous error cannot leak across days.
  React.useEffect(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setPdfPhase("idle");
  }, [date]);

  React.useEffect(
    () => () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    },
    [],
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

  /** Last-resort path: hand the user the standalone document in a new tab. */
  const openInNewTab = (html: string): boolean => {
    try {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank");
      if (!opened) {
        URL.revokeObjectURL(url);
        return false;
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return true;
    } catch {
      return false;
    }
  };

  const handlePdf = () => {
    if (!date || pdfPhase === "pending" || !printReady) return;
    const node = getPrintNode();
    if (!node) {
      failPdf();
      return;
    }

    setPdfPhase("pending");
    // The markup comes from our own React render (already escaped) — this is a
    // DOM clone into a separate document, not markup injected into this page.
    const html = buildPrintDocument(date, node.innerHTML);

    let settled = false;
    let iframe: HTMLIFrameElement | null = null;

    const cleanup = () => {
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
      iframe = null;
    };

    const fallback = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (openInNewTab(html)) {
        setPdfPhase("idle");
        onClose();
      } else {
        failPdf();
      }
    };

    try {
      iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.setAttribute("tabindex", "-1");
      iframe.style.cssText =
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";

      iframe.onload = () => {
        if (settled) return;
        const win = iframe?.contentWindow;
        if (!win) {
          fallback();
          return;
        }
        try {
          settled = true;
          win.focus();
          win.print();
          setPdfPhase("idle");
          onClose();
          window.setTimeout(cleanup, 1000);
        } catch {
          settled = false;
          fallback();
        }
      };

      // srcdoc (not the deprecated document.write) — same-origin, no navigation.
      iframe.srcdoc = html;
      document.body.appendChild(iframe);

      // Safety net: if onload never fires we must not sit in "pending" forever.
      window.setTimeout(fallback, 4000);
    } catch {
      fallback();
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
