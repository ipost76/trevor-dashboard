"use client";
import * as React from "react";
import { BottomSheet, HapticButton } from "@/components/ui";
import { FileText, FileDown } from "lucide-react";

/**
 * DownloadFormatSheet — Phase 2 (PDF download wave).
 *
 * Opened from the DOWNLOAD button on each file card. Two rows:
 * - Download .md (cyan): the original direct-link flow (browser handles the
 *   blob via `<a download>` against /api/intel/downloads/[filename]).
 * - Download PDF (red): fetches the converted PDF from
 *   /api/docs/downloads/[filename]/pdf, builds a blob URL, and triggers the
 *   download. Shows a "Converting…" hint while the server renders (the worst
 *   real document is ~270 KB and takes up to ~40 s first time; cached
 *   afterwards). On failure, "Failed" surfaces inline for 2 s then reverts;
 *   the sheet stays open.
 *
 * Cyan / red accents match the existing `fileTypePillTone` convention in
 * `downloads-section.tsx` (`.md` → cyan, `.pdf` → red).
 */

interface DownloadFormatSheetProps {
  open: boolean;
  onClose: () => void;
  /** Filename being downloaded. `null` collapses the sheet. */
  filename: string | null;
}

type PdfPhase = "idle" | "pending" | "error";

export function DownloadFormatSheet({
  open,
  onClose,
  filename,
}: DownloadFormatSheetProps) {
  const [pdfPhase, setPdfPhase] = React.useState<PdfPhase>("idle");
  const errorTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset any "Failed" badge whenever the sheet opens for a new file so a
  // previous error can't leak across files.
  React.useEffect(() => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setPdfPhase("idle");
  }, [filename]);

  React.useEffect(() => {
    return () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
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

  const handlePdf = async () => {
    if (!filename || pdfPhase === "pending") return;
    setPdfPhase("pending");
    try {
      const res = await fetch(
        `/api/docs/downloads/${encodeURIComponent(filename)}/pdf`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const pdfName = filename.replace(/\.md$/i, "") + ".pdf";
      const link = document.createElement("a");
      link.href = url;
      link.download = pdfName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setPdfPhase("idle");
      onClose();
    } catch {
      setPdfPhase("error");
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setPdfPhase("idle"), 2000);
    }
  };

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
                  Original markdown
                </span>
              </HapticButton>
            </li>
            <li>
              <HapticButton
                variant="ghost"
                size="sm"
                onClick={() => void handlePdf()}
                disabled={pdfPhase === "pending"}
                aria-label={`Download ${filename} as PDF`}
                className={[
                  "flex w-full items-center justify-between gap-3 border px-3 py-2 text-left",
                  pdfPhase === "error"
                    ? "border-accent-red/40 bg-accent-red/15 text-accent-red"
                    : "border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/20",
                  pdfPhase === "pending" ? "opacity-60" : "",
                ].join(" ")}
              >
                <span className="flex items-center gap-2 font-sans text-caption">
                  <FileDown size={14} className="shrink-0" aria-hidden />
                  <span>Download PDF</span>
                </span>
                <span className="shrink-0 font-sans text-micro text-fg-muted">
                  {pdfPhase === "pending"
                    ? "Converting… (up to ~60 s for large files)"
                    : pdfPhase === "error"
                      ? "Failed"
                      : "Styled report"}
                </span>
              </HapticButton>
            </li>
          </ul>
        </div>
      )}
    </BottomSheet>
  );
}
