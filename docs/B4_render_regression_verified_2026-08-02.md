# B4 — Hub render regression: VERIFIED BY RENDERING

**Prompt** RM-CLOSEOUT-B4 · **Box** WSL `ghost@Ghost` (verified `whoami`/`hostname`)
**Repo** `/home/ghost/projects/trevor-dashboard`, branch `master`
**HEAD at render** `fd289b6` · **Date** 2026-08-02

C2 (`adc3f53`) shipped the middleware decode guard and honestly carried the browser
render regression as **OPEN**, because its harness needed a WSL-side authenticating
proxy and it believed no Linux browser existed here. **Both PDFs have now been
rendered and inspected.** The gate is CLOSED.

---

## 1. Three inherited "facts" — all measured FALSE

🚨 These cost three consecutive prompts and shipped a PDF bug that only surfaced
when the file was opened on a phone. They die here.

| Inherited claim | Measured reality |
|---|---|
| "There is no Linux browser on this box" | **FALSE.** `/home/ghost/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome` → `Google Chrome for Testing 148.0.7778.96`, rc=0 |
| "CC cannot bind a local listener on WSL" | **FALSE.** `bind 127.0.0.1:9333` succeeds; headless Chrome bound CDP on `:9222` and answered `/json/version` |
| "The render needs an authenticating proxy" | **NOT NEEDED, and never refused.** The proxy existed only because *Windows* Chrome cannot take the session cookie via CDP. A same-box Linux Chrome removes the constraint entirely |

**Auth** is the app's own supported login — `POST /api/auth` reading `.env.local`
→ 200, `trevor_session` cookie — the same flow a browser performs. No workaround.

## 2. The render path — FIVE files, not six

C2's count of six is corrected. Both PDFs are produced **client-side via
`window.print()`**; there is no server-side generator.
`api/docs/downloads/[filename]/pdf/route.GET` is the dead weasyprint path that
`06879fd` replaced.

1. `components/ui/markdown-print-document` — `PRINT_ROOT_CLASS`, `buildPrintCss`, `MarkdownPrintDocument` *(shared by both)*
2. `components/memory/digest-download-sheet` — `DigestPrintDocument`, `DigestDownloadSheet`
3. `components/memory/activity-feed-section` — mounts the digest print root, fetches `body_md`
4. `components/docs/download-format-sheet` — `DownloadFormatSheet`, `isPrintable`
5. `components/docs/downloads-section` — mounts the docs print root

🚨 **Byte-identity is exactly why the diff proved nothing.** 0 tracked files differ
from HEAD, so "identical code over identical bytes" was true *and* worthless — the
only thing that could discharge this gate was running the renderer.

## 3. Method — and the trap it avoids

Headless Linux Chrome + CDP over `python3 websockets`, driving the **real UI path**:
`/health` → DIGEST tab → *Download the &lt;date&gt; digest*; `/docs` → *Download &lt;file&gt;.md*.

🚨 **Never `printToPDF` a bare page.** The print root is portalled and mounts only
when the sheet opens — a bare-page render produces an empty document and **falsely
passes**. An empty print root is a FAILURE, not a pass.

Completion was established by **polling**, never by exit code: size stable across
consecutive samples, then `%PDF` header + `%%EOF` trailer, then poppler.
(`chrome.exe` on the Windows side returns rc=0 before the browser finishes —
confirmed live: `--version` printed `Opening in existing browser session.`)

Chrome 148 requires **PUT** on `/json/new` (GET/POST → 405).

## 4. Evidence

| | Digest PDF | Docs PDF |
|---|---|---|
| Source | digest `2026-08-01` | `2026-08-01_a2_unowned_code_sweep.md` |
| Print root | 48,912 chars | 50,037 chars |
| Size | 538,047 bytes | 673,273 bytes |
| Pages | **16** | **13** |
| Blank pages | **0** (862–2,848 chars/page) | **0** (306–3,695 chars/page) |
| Structure | `%PDF-1.4` … `%%EOF` | `%PDF-1.4` … `%%EOF` |

- **Tables render.** Digest: the booked-fees table renders with aligned columns and
  correct values (`net P&L $0.13 / $2.11 / $2.11`). Docs: 13 source tables render,
  markdown consumed (`**Box**` → styled *Box*), inline code preserved.
- **Code blocks render.** 5 fenced blocks in the docs source keep monospace
  alignment through `pdftotext -layout`.
- **Print isolation holds.** Zero page chrome in either PDF — no nav, no ticker
  prices, no killswitch controls. (`FARTCOIN` appears in the digest as *genuine
  content* — trade 101758 and ticker cycle counts — not as ticker-bar leakage;
  no live ticker price appears.)
- **`@page` margin boxes work in Chrome:** running header + page numbers on
  16/16 and 13/13 pages.

⚠️ **iOS/WebKit is OUT OF SCOPE from this box.** WebKit does not implement `@page`
margin boxes, so the running header and page numbers are **expected to be absent on
iOS**. That is not a defect and was not tested here.

## 5. Trouble patterns — Causes found: 0

- **Post-deploy state assumption** — none. Every render fetch is `cache: "no-store"`
  and each render used a fresh browser target. No warm-cache or surviving-session
  dependency.
- **Silent lifecycle failure (200 + valid-looking empty PDF)** — **structurally
  impossible via the UI.** Measured: at sheet-open the print root is *not mounted*
  (`-1`), and the PDF control is `disabled` until `printReady` in both sheets.
- **Bypassable once-only path** — guarded. `pdfPhase === "pending"` blocks re-entry
  in `digest-download-sheet.handlePdf` and `download-format-sheet.handlePdf`, backed
  by the `disabled` attribute.

## 6. Adjacent path — no regression

The middleware change was re-exercised live: `%2`/`%zz` → **middleware** 400
`{"error":"malformed percent-escape in path"}`; unauthenticated `%2` → **401**
(middleware still runs to completion); `/%64ashboard` → 404 (raw pathname
preserved); `/api/no-such-route-%2` → 400, the accepted change.

⚠️ **One C2 commit-message claim is inaccurate:** it states `%20` "still 404s
honestly". Measured, `/api/health/digests/%20` returns the **handler's own** 400
`invalid date (expected YYYY-MM-DD)` with `digest_date: " "`. Middleware is provably
not involved — the body is the handler's and carries the decoded value. `%25`
behaves the same way. **`malformed ≠ absent ≠ not-found` still holds**; only the
prose was wrong, not the code. No fix required.

## 7. Scope

Verification only — **no behaviour change**. This render covers HEAD `fd289b6`,
**three commits past C2's `adc3f53`**, so it also discharges the render path over
B11 (`4435da0`) and B12 (`5b827a1`).

**No `rebuild_tracker` self-log — that tool is VM-side only and is not on this box.**
The outcome is recorded here and in the commit message; none was fabricated.
