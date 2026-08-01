# D3 — PDF print path fix (Hub, WSL)

**Box:** `ghost@Ghost` (WSL Hub), repo `/home/ghost/projects/trevor-dashboard`, branch `master`.
**Date:** 2026-07-31. **Money path:** no. **DB writes:** none (replica read-only throughout).

## The defect

Ghost tapped the PDF download on the Jul 31 digest card. The produced document
contained the page chrome (nav, live ticker strip, the HEALTH·DIGEST·DOCS·COST
tab row, the AUTO·TRAINER·WATCHER·DOCS·HEALTH bottom nav), the **collapsed card
summary only** — not the digest body — and a broken layout.

B7 marked the print dialog and click-through UNVERIFIED because there is no
browser on this box. That gap is exactly what shipped this bug.

## Causes found: 3

### Cause 1 (root) — the browser printed the live page, not the constructed document

`digest-download-sheet.handlePdf` cloned the off-screen digest into a hidden
0×0 iframe via `srcdoc` and called `iframe.contentWindow.print()`.

**The document it constructed was already correct.** Measured headlessly (no
browser): transpiled `digest-markdown.tsx` with the repo's own TypeScript,
rendered `<DigestMarkdown source={body_md}/>` through `react-dom/server`, fed it
to `PRINT_CSS`/`buildPrintDocument` lifted verbatim from source →
**130,756 bytes, 8 tables, 78 rows, 6 sections + Δ, and zero chrome elements**
(`<nav> 0 · <header> 0 · <button> 0 · <svg> 0 · sticky 0 · z-50 0`).

The printed output contained chrome and no body. Therefore the browser did not
print that document. Every chrome element Ghost described maps 1:1 onto
`app-shell-nav.AppShellNav`'s children, and none of it exists in the constructed
document.

**Mechanism:** `contentWindow.print()` is not scoped to the frame on WebKit/iOS
— it routes to the top-level document. Ghost is on iPhone. The 0×0
`visibility:hidden` iframe compounds it: several engines decline to print a
non-rendered frame.

> ⚠️ The *deduction* that the wrong document printed is measured and airtight.
> The *specific WebKit mechanism* is a strong inference, not a measurement —
> there is no browser here. The fix removes the iframe entirely, so it holds
> regardless of which mechanism it was.

### Cause 2 — zero `@media print` isolation anywhere in the Hub

`grep -rn "@media print" --include=*.ts --include=*.tsx --include=*.css .` → **0 hits**
before this change. `PRINT_CSS` lived only inside the iframe document, so it had
no effect on the live page. The moment anything printed the page — this bug, or
Ghost using the browser's own Print menu — there was no isolation at all, and
the app's screen CSS produced exactly the overlapping panels / clipped text /
bleeding ticker / blank regions reported.

### Cause 3 — the print container was `hidden`, so a page-print could never contain it

`<div hidden ref={printRef}>` — `hidden` is `display:none`, and a `display:none`
element cannot be printed either. This explains the second half of the symptom:
the container *was* populated (the PDF button is disabled until `printReady`),
yet printed nothing, while the visible collapsed card printed. It was also a
hard blocker on the obvious fix — adding print CSS alone would still have
produced a blank digest.

### Ruled OUT, with evidence

| Candidate | Verdict |
|---|---|
| `buildPrintDocument` not fed `body_md` | **OUT** — it is, from the same `query_digest.py detail` read the .md download uses |
| Card must be expanded for content to exist | **OUT** — `openDownload` and the print container were already independent of `expanded` |
| `buildPrintDocument`/`PRINT_CSS` malformed | **OUT** — rendered output verified well-formed, styled, chrome-free |
| Markdown renderer dropping sections/tables | **OUT** — 8/8 tables, all 36 headings, 558-line source fully represented |
| CSP blocking `srcdoc` or its inline `<style>` | **OUT** — no CSP header anywhere (`next.config.ts`, `middleware.ts`, `server.js`) |

**Shared root cause?** Yes for the trigger — Cause 1 alone produced both the
wrong content and the broken layout. No for the remedy: Causes 2 and 3 are
independent structural defects, each of which would have broken any page-print
fix on its own.

**Latent defect removed (not a cause):** `handlePdf` scheduled
`setTimeout(cleanup, 1000)` immediately after `print()`. Printing is
asynchronous on most engines, so that tears the document out from under a slow
render. Gone with the iframe.

## The fix

- **`DigestPrintDocument`** (new, in `digest-download-sheet.tsx`) portals the
  digest to `document.body` via `createPortal`, so it is a **direct child of
  body**. Content comes from the `body` prop (`body_md`) — never from the DOM,
  never from the card, never gated on `expanded`.
- **`PRINT_CSS`** is now a `@media print` stylesheet shipped as a `<style>`
  **text child** (no raw-HTML injection; the repo-wide
  `dangerouslySetInnerHTML` usage count stays 0). Because the print root is a
  body child, one rule isolates it completely:
  `body > *:not(.digest-print-root) { display: none !important; }` — killing
  sidebar, header + ticker, sub-tab row, bottom nav, notes widget and the open
  BottomSheet at once.
- **Screen/print visibility split** replaces `hidden`: `display:none` on screen,
  `display:block` in print media.
- **Degenerate cases:** `thead { display: table-header-group }` repeats headers
  across pages; `break-inside: avoid` on **rows**, `break-inside: auto` on the
  **table** (avoiding it on the table pushes an over-tall table whole and then
  clips it); `table-layout: fixed` + `word-break: break-word` +
  `white-space: normal` (undoing the renderer's `whitespace-nowrap` on `<th>`)
  so a wide table wraps instead of running off the sheet; `overflow: visible`
  because the renderer wraps every table in an `overflow-x-auto` div that clips
  on paper.
- **Dark-theme neutralisation:** the digest markup's Tailwind classes never
  resolved inside the old iframe but do resolve on this document, so they are
  overridden under `.digest-print-root`. `text-align` is deliberately **not**
  set — `digest-markdown` applies an explicit alignment class to every `th`/`td`
  and clobbering it would silently drop the tables' GFM column alignment.
- **`document.title`** is swapped to `trevor-digest-<date>` for the print (the
  dialog uses it as the default filename) and restored by the `date`-change and
  unmount effects, with or without an `afterprint` event.
- **No unmount mid-print:** `handlePdf` does **not** call `onClose()`. Closing
  the sheet clears `date`, which would unmount the very document being printed.
  Dismissal happens only via an `afterprint` listener, which is a convenience
  (iOS Safari does not fire it) and never load-bearing.

## Verification (no browser on this box)

Harness renders the real `DigestPrintDocument` from source and inspects the
markup and the stylesheet it actually ships. Three narrow, stated shims:
identity `createPortal` (with a sentinel asserting the target **is**
`document.body`), `useState(false) → [true]` for the SSR `mounted` guard, and a
`document` stub.

**All checks passed**, including: all 36 `body_md` headings render · 8/8 tables ·
78 rows · 6 sections + Δ · zero chrome (tag inventory is document tags only) ·
portal target is `document.body` · isolation rule present and inside
`@media print` · all 35 print selectors scoped to the print root · every
degenerate-case rule present · no `innerHTML`/`getPrintNode`/`iframe`/`srcdoc`/
`window.open`/cleanup-timer in the builder · no synchronous `onClose()` in
`handlePdf` · `dangerouslySetInnerHTML` **usages 0** (grep hits 1 — the
`digest-markdown.tsx` comment asserting its own absence; the baseline is
unchanged).

Live, after `npm run build` (exit 0) + `sudo systemctl restart
trevor-dashboard.service` (active):

- `/api/health/digests` 200 · `/api/health/digests/2026-07-31` 200 ·
  `/health?tab=activity` 200
- **`.md` download byte-identical to the replica** —
  `sha256 0b797cfd…76cd`, 46,015 bytes, DB == HTTP
- D2's delete path intact: `DELETE` exported in `route.ts` and present in the
  built bundle, all three digest routes in `app-paths-manifest.json`. **Verified
  via the manifest, never invoked** — this prompt is read-only and firing it
  would have destroyed the only digest.

## 🚨 What is NOT verified here

**There is no browser on this box.** The actual print dialog, the rendered PDF,
and whether the `@media print` isolation behaves correctly on iOS Safari
**cannot be checked from WSL**. What is proven is document construction, content
match against `body_md`, CSS scoping, chrome absence in the markup, and
UI-state independence. **No claim is made that the PDF renders correctly** —
that is Ghost's check on his phone, and it is the same gap B7 left.

**Ghost should confirm on the phone:** the PDF contains the full report (6
sections, 8 tables, Δ) with no nav/ticker/tab row/bottom nav; tables paginate
with repeating headers rather than clipping; it works with the card
**collapsed**; and the saved filename reads `trevor-digest-2026-07-31`.

## Self-log

`rebuild_tracker` is **VM-side only** — the level chain is VM-owned and no level
row may be written from WSL. No self-log row was created here, and none was
fabricated. This document and the commit are the record.

## Files

- `src/components/memory/digest-download-sheet.tsx` — print document + `@media print` CSS
- `src/components/memory/activity-feed-section.tsx` — mounts the print root; `printRef`/`getPrintNode` removed
