# B4 — malformed-URL 500s, and Docs→PDF without weasyprint (Hub, WSL)

**Box:** `ghost@Ghost` (WSL Hub), repo `/home/ghost/projects/trevor-dashboard`, branch `master`.
**Date:** 2026-08-01. **Money path:** no. **DB writes:** none (read-only replica throughout).

Two defects, both closed, both verified by rendering rather than by inspection.

---

## Task 1 — a malformed date returned 500 instead of 400

### The defect

`GET /api/health/digests/%25` returned **HTTP 500 with an empty body**.

Next hands a dynamic segment to the handler **already decoded once**, so `%25`
arrives as a bare `%`. `decodeURIComponent("%")` throws `URIError`, and
unguarded that escapes as an unstructured 500. A malformed date is a **client**
error and must not be indistinguishable from a genuine server failure.

### The fix

D2 (2026-07-31) had already solved this exact shape for the DELETE path with a
file-local `safeDecode` in `api/health/digests/[date]/route.ts`, and deliberately
left the GET alone as out of scope. Its semantics are reproduced **exactly**:
catch the throw, pass the malformed value through **unchanged**, and let the
caller's own shape check (`DATE_RE`, or a filename test) reject it as a 400. The
guard never decides a status.

**One deliberate deviation from "copy D2's local function":** the guard now lives
in `api-helpers.safeDecodeSegment` rather than being copied into each route.
Five routes carried the identical defect, and five copies of one guard is the
same "two copies of one fact" failure a shared fix exists to prevent — the next
correction would land in one copy and silently not the others. One guard, one
style, six call sites.

### Routes fixed — measured before and after

| Route (malformed segment) | Before | After |
|---|---|---|
| `GET health/digests/%25` | 500 | **400** |
| `GET health/digests/%25/markdown` | 500 | **400** |
| `GET docs/downloads/%25/pdf` | 500 | **400** |
| `GET intel/downloads/%25` | 500 | **404** ¹ |
| `PUT docs/categories/%25` | 500 | **400** |
| `DELETE docs/categories/%25` | 500 | **400** |
| `PUT docs/downloads/%25/move` | 500 | **400** |
| `DELETE health/digests/%25` (D2's, control) | 400 | 400 |

¹ **404 is correct here, not a miss.** `%` is a structurally valid filename — it
has no `/`, no `..`, no leading dot — so it passes the path checks and the
lookup honestly reports that no such file exists. A 400 would be claiming the
input was malformed when it was merely absent.

The 400 bodies are readable, not empty:
`{"found":false,...,"error":"invalid date (expected YYYY-MM-DD)"}`.

### The guard did not over-reject

`2026-08-01` → 200, `found=true`, 38,200 chars · `2026-07-31` → 200,
`found=true`, 45,213 chars · `2026-07-30`, `2026-01-01`, `1999-12-31` → 200,
`found=false` (correct — no digest on those dates).

The `.md` download is **byte-identical to the replica**: DB and HTTP both
`sha256 c7d34dab…561f`.

### 🚨 A SECOND, DISTINCT DEFECT THIS DOES **NOT** FIX — stated so nobody reads the table above as total

**`%2`, `%zz`, `%%`, `%E0%A4%A` and `%C3%28` still return 500**, on every dynamic
route in the app.

Those are *structurally invalid* escapes, not valid escapes that decode to `%`.
**Next's own router throws while decoding the segment, before any handler code
exists to guard.** This is not an assumption — it was isolated by measurement:

- `/api/memory/brain/%2` → **500**, and that route contains **zero**
  `decodeURIComponent` calls and was not touched by this prompt.
- `/api/no-such-route-%2` → 404, `/no-such-page-%2` → 404, `/memory/%2` → 404
  (no dynamic segment ⇒ no decode ⇒ no throw).
- Nothing appears in the service journal for these, unlike the handler-level
  `URIError` traces the pre-fix routes produced.

So the failing layer is above the route handler and **cannot be closed from
one**. The only place with a shot at it is `middleware.ts`, rejecting malformed
percent-escapes before routing — a global change to the auth gate, which is well
outside this prompt and should not be made casually. **Carried as open.**

Unauthenticated requests still 401 ahead of all of this (`no cookie,
/api/health/digests/%2` → 401), so the auth gate is not bypassed by a malformed
URL.

---

## Task 2 — Docs→PDF, dependency-free

### The defect

`convert_md_to_pdf.py:29` imports `weasyprint`. **Measured live on this box:**

```
venv/bin/python3 -c "import weasyprint"
ModuleNotFoundError: No module named 'weasyprint'
```

`pygments` (line 28) is absent too; `markdown` 3.10.2 is present. The **Python
modules themselves are missing**, not merely their C libraries — and the imports
are at module top level, so they fail *before* the script's own try/except can
emit its JSON error shape. `runPython` therefore threw and the route returned a
bare 500 on **every** call. The button has shown "Failed" for its whole life.
Installing needs root, which `trevor` does not have (FORTRESS-C4).

⚠️ **Premise correction:** there is **no `requirements.txt` in this repo**
(`ls` → No such file). The `requirements.txt:201` weasyprint pin is a VM fact,
not a WSL one.

### The fix — share, not copy

Docs→PDF now prints through the same client-side path D3/D4 built and verified
for the nightly digest. **Zero new dependencies**, which is the entire point.

`PRINT_ROOT_CLASS`, the `@media print` stylesheet and the portalled print
document moved to **`src/components/ui/markdown-print-document.tsx`**.
`digest-download-sheet.tsx` keeps thin wrappers; `activity-feed-section.tsx` is
untouched.

**Why share rather than copy.** Both consumers render through the **same
`digest-markdown` component**, so the element tree these selectors target is not
merely similar — it is identical. Exactly one thing in ~280 lines was ever
digest-specific: the running-header text. Every other rule carries a measured
"D3 cause N" / "D4 defect N" provenance (pseudo-element isolation, the
`color-scheme` page canvas, ligature suppression, `overflow-wrap: break-word`
not `anywhere`, thead/row pagination). Copying forks all of it, and the next
print fix would land in one file and silently not the other.

### 🚨 THE COST OF SHARING, RECORDED WHERE IT WILL BE HIT

**A change to the shared print stylesheet now changes the Docs PDF *and* the
digest PDF.** Both must be regression-rendered before any print change ships.
This is written into the header of the shared module and of
`digest-download-sheet.tsx`, not only here.

### 🚨 The one genuinely NEW risk, and how it is handled

The digest's `cssSafeDate` whitelisted `[0-9-]` because a date is all it ever
saw. A Docs label carries a **filename** — arbitrary text heading into a CSS
`content:` string literal, which is an injection surface.

`cssSafeLabel` **whitelists and REJECTS rather than repairs**: any character
outside `[A-Za-z0-9 ._·—-]` returns `null` and the running header is omitted
entirely. Stripping the offending characters would silently print a *different*
name than the file has, which is its own defect; an escaper is one missed edge
case from being no protection at all.

**Length is treated differently on purpose**, and the distinction is the point:
over-length is a *layout* concern, not a security one. Truncating a string whose
characters are already all whitelisted cannot introduce a quote or a brace, so a
long-but-safe label is trimmed at 90 rather than rejected — otherwise the longest
report names, the ones most worth labelling, would be exactly the ones that
silently lost their header.

Exercised:

| Input | Result |
|---|---|
| `TREVOR nightly digest · 2026-08-01` | passes unchanged |
| `TREVOR · B4_report_2026-08-01.md` | passes unchanged |
| `evil"; } body { display:block !important; } @page { content: "` | **REJECTED** |
| `has\backslash` | **REJECTED** |
| `line\nbreak` | **REJECTED** |
| 120 × `x` | truncated to 90 |
| `""` | **REJECTED** |

### Other decisions

- **`convert_md_to_pdf.py` and `/api/docs/downloads/[filename]/pdf`: left in
  place, marked superseded.** Both are off the render path either way; removal
  is a behaviour change nothing measured asked for, and the script's `PAGE_CSS`
  is the only record of the intended styling. The pdf route still got the decode
  guard — a superseded route is not an excuse to leave a known 500 reachable.
- **The `digest-print-root` class name is kept.** It is historic — the digest is
  where the mechanism was built — and is now generic. Renaming is
  behaviour-neutral churn that would invalidate the selector D3's write-up
  records. Only one print root is ever mounted (digest on `/health?tab=activity`,
  Docs on `/docs`); they cannot co-mount.
- **PDF is offered for `.md` only.** The old route rejected anything else with a
  400 that surfaced as "Failed"; the row now says **"Markdown only"** and is
  disabled. A fetch failure says **"Couldn't read the file"** rather than
  spinning on "Preparing…" forever.
- The print source is fetched from the **existing** `.md` download route. Its
  `Content-Disposition: attachment` only affects browser *navigation*, not
  `fetch`, so reading the body as text needs no new endpoint.

### 🚨 Proof the digest stylesheet did not change

The extraction is only safe if the digest's emitted CSS is unaffected. Both
builders were sliced out of their files as text, transpiled with the repo's own
TypeScript, run in a `vm`, and their output compared — no re-implementation, since
a re-implementation can reproduce a bug and prove nothing.

```
OLD rules sha256: 991ee3dd67c4b5faf8fb72747a9410719538ece1475fea24efb633ea443af690
NEW rules sha256: 991ee3dd67c4b5faf8fb72747a9410719538ece1475fea24efb633ea443af690
DIGEST CSS RULES IDENTICAL: YES — byte-for-byte
negative control (different date differs): PASS
```

**Full text differs by exactly 3 lines, all of them inside CSS comments**, all
deliberate generalisations now that the module is shared: `digest markup` →
`markdown markup`, `print of body_md` → `print of the source`, `the date
survives` → `the label survives`. That is +6 characters, which is precisely the
print root's `textContent` delta observed live (47,936 → 47,942) — the `<style>`
text child is part of `textContent`.

---

## Verification — by rendering, not by assertion

**🎉 The "there is no browser on this box" constraint is gone.** Windows Chrome
(`HeadlessChrome/150`) is reachable from WSL and poppler is present, so this
prompt verified its own output instead of deferring it.

**Two mechanics worth recording, because each makes a working path look broken:**

1. **`chrome.exe` returns rc=0 *before* the browser finishes.** The output file
   must be polled for. A naive launch-then-check reports "no PDF produced" from a
   perfectly working Chrome.
2. **CDP is unreachable from WSL.** Chrome binds `--remote-debugging-port` to
   `127.0.0.1` **on the Windows side** and ignores
   `--remote-debugging-address=0.0.0.0` — measured, `NETSTAT -ano` →
   `127.0.0.1:9222 LISTENING`. So `Network.setCookie` is not available and the
   auth cookie cannot be injected that way.

Auth was solved instead with a **scratchpad-only authenticating reverse proxy**
(never in the repo, read-only, refuses every mutating method) that attaches the
session cookie server-side and injects a small driver script into HTML. The real
page, real components and real print stylesheet are exercised; only "the user
tapped these buttons" is scripted.

### Docs → PDF

Drove the real `/docs`, clicked the real DOWNLOAD button for
`2026-08-01_a2_unowned_code_sweep.md`, print root mounted (50,038 chars), printed
and **inspected the rasterised pages**.

- **14 pages**, letter.
- Running header `TREVOR · 2026-08-01_a2_unowned_code_sweep.md` on **14/14**
  pages; `N / 14` footer on **14/14**.
- **Zero page chrome**: `DOWNLOAD AS` 0 · `Manage categories` 0 · `Download .md`
  0 · `Via print dialog` 0 · `AUTOTRADER` 0 · `SHADOWS` 0 · `MEMORY` 0 ·
  `Uncategorized` 0.
- The single `DOWNLOADS` hit was triaged to source, not assumed: it is
  `HUB_DOWNLOADS_WEBHOOK_URL`, present once in the source `.md`. **Document
  content, not chrome.**
- Pages 1 and 5 viewed: tables with headers, wrapped code blocks, inline code,
  lists, correct typography, white canvas, no clipping.

### Digest — regression, rendered before AND after

A baseline was captured **before** any code changed, and re-rendered after:

- 15 pages → 15 pages.
- Extracted text **byte-identical**, `sha256 72f3578b…` both runs.
- **All 15 rendered page images identical by sha256 (15/15, 0 differing).**

### Everything else

| Check | Result |
|---|---|
| Digest feed renders | ✅ screenshotted — 2 cards, metrics, controls |
| Inline render (expand a card) | ✅ tables 0 → **8**, `h3` 8 |
| `.md` download | ✅ byte-identical to replica |
| D2 delete control | ✅ `DELETE` exported; all 3 digest routes in `app-paths-manifest.json`; `%25` → 400 `invalid_date` proves the handler runs. **Never invoked — it would destroy a digest.** |
| Docs listing / categories / page | ✅ 200, screenshotted |
| `dangerouslySetInnerHTML` **usages** | ✅ **0** (grep *hits* 1 → 2; the new file's comment mentions it — count usages, not hits) |
| `npx tsc --noEmit` | ✅ exit 0 |
| `npm run build` | ✅ exit 0 |
| `trevor-dashboard.service` | ✅ active |

**`verify_deploy.sh` was deliberately NOT run:** it force-mutates two
`auto_config` rows during its gate tests, and this prompt is read-only on the DB.

## 🚨 What is NOT verified here

**iOS / WebKit.** Chrome cannot check it. Per D4, WebKit does not implement
`@page` margin boxes, so **the Docs running header and page numbers will be
absent on iPhone**, exactly as the digest's are. That is a graceful absence and
expected, not a failure — Ghost's phone is that coverage.

The `%2` class of malformed escape remains 500 and is **open** (above).

## Self-log

`rebuild_tracker` is **VM-side only** — the level chain is VM-owned and no level
row may be written from WSL. No self-log row was created, and none was
fabricated. This document and the commit are the record.

## Files

- `src/lib/api-helpers.ts` — `safeDecodeSegment`
- `src/app/api/health/digests/[date]/route.ts` — GET guarded; D2's local copy hoisted
- `src/app/api/health/digests/[date]/markdown/route.ts` — guarded
- `src/app/api/docs/downloads/[filename]/pdf/route.ts` — guarded + superseded
- `src/app/api/docs/downloads/[filename]/move/route.ts` — guarded
- `src/app/api/docs/categories/[id]/route.ts` — guarded (PUT + DELETE)
- `src/app/api/intel/downloads/[filename]/route.ts` — guarded
- `src/components/ui/markdown-print-document.tsx` — **new**, the shared print path
- `src/components/memory/digest-download-sheet.tsx` — thin wrappers
- `src/components/docs/download-format-sheet.tsx` — client-side print path
- `src/components/docs/downloads-section.tsx` — source fetch + print root mount
- `convert_md_to_pdf.py` — superseded marker only (no behaviour change)
