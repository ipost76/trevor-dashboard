# TREVOR Hub Dashboard — System State

> **Last rebuilt: 2026-05-16.** CC's current-state reference for the Hub — read top-to-bottom in Phase 0 of every Hub prompt. Hard ceiling: under 300 lines.
> Hub-specific only. Bot-side engineering rules, the feature registry, and recurring bugs live in `/home/trevor/trevor/BEHAVIOR_RULES.md` + `/home/trevor/trevor/CLAUDE.md` — read those; this file does not restate them.
> Prior session history is archived to `docs/SESSION_HISTORY.md` (historical, not active documentation).

---

## Tech Stack

- **Next.js 15.3.3** (App Router) · **React 19.0.0** · **TypeScript 5.9.3** · **Tailwind CSS 4** (CSS-first; design tokens live in `globals.css @theme`).
- Repo: `/home/trevor/trevor-dashboard/`, git branch **`master`**.
- Served by a custom **`server.js`** — `npm start` runs `node server.js` (*not* `next start`) on port **3333**, bound to `127.0.0.1` only. Dev server: `npm run dev` (`next dev -H 127.0.0.1 -p 3333`).
- **nginx** reverse proxy (ports 80/443, Let's Encrypt SSL) → **https://trevor-prime.com**. `middleware.ts` 301-redirects direct-IP hits to the domain.
- systemd unit: **`trevor-dashboard.service`**.
- Auth: a single cookie `trevor_session` — base64url-encoded `user:pass:salt` (salt `trevor-mc-2025`), validated locally in `middleware.ts` with no network call.
- `layout.tsx` wraps every page in `<ThemeProvider>` + `<AppShell>`. Chat is direct-to-Anthropic via `chat_bridge.py` / `chat_ai.py` — not Discord, not any external workflow tool.
- The Hub has **no database of its own** — it reads the bot's SQLite at `/home/trevor/trevor/trevor.db`. Local file state lives in `data/` (`chat-sessions/`, `watchlist-meta.json`).
- Shared code: `src/lib/` (`api-helpers.ts` Python bridge, `feature-flags.ts`, `fetch.ts`, `format.ts`, `navigation.ts`, `a11y.ts`, `anthropic-key.ts`, `utils.ts`) and `src/hooks/` (`useLongPress`, `usePullToRefresh`, `useScrollDirection`).
- The Hub never calls the bot over HTTP — every bot fact comes from reading `trevor.db` and brain files on the shared filesystem.
- Request flow: `middleware.ts` (auth gate) → page or `api/*/route.ts` → `runPython()` → a root-level `*.py` script → `trevor.db`.

---

## Route Structure

App Router pages under `src/app/`, verified against the filesystem:

| Path | Purpose |
|---|---|
| `/autotrader` | AutoTrader — single-view Scalper board. **Hub landing** — `/` redirects here (Wave B1). |
| `/stocks` | Stock signals + DCA reminders — Stock / DCA sub-tabs (was `/manual`, Wave C2) |
| `/stocks/scout` | SCOUT discovery feed |
| `/intel` | Similar / Calibration / Shadow / Lessons / Journal (Lessons + Journal moved back from `/docs` 2026-05-19; Downloads stayed on `/docs`) |
| `/docs` | Downloads file browser with category tabs — single-view zone since Lessons / Journal moved back to `/intel` 2026-05-19; gated `HUB_REDESIGN_DOCS` (ON) |
| `/memory` | Brain / Memory / ChromaDB / System Health / Aggressive |
| `/chat` | TREVOR chat (direct Anthropic API) |
| `/login` | Cookie auth |
| `/design-system` | A4 primitive showcase (internal) |

- App-level files in `src/app/`: `layout.tsx` (shell), `error.tsx` (error boundary), `not-found.tsx` (404), `globals.css`.
- Every page except `/login` is auth-gated by `middleware.ts`; an unauthenticated page request 302-redirects to `/login?from=<path>`, and unauthenticated `/api/*` calls get a 401.
- Redirect-only pages: `/` → `/autotrader`; `/brain` → `/control` (chains through to `/memory`).
- Legacy redirects in `middleware.ts` (308): `/trading`, `/scalp` & `/manual` → `/stocks` (Wave C2 — direct single hop, no chaining), `/command` → `/memory`, `/intelligence` → `/intel`, `/dashboard` → `/autotrader` (HOME page retired, Wave B1).
- Legacy redirects in `next.config.ts` (308): `/trades` `/holdings` `/signals` `/research` `/training` `/control` `/ghost` `/dev-tasks` `/reminders` → a retired zone path + `?tab=` (then re-chained by `middleware.ts`); plus 3 `/api/auto-trader/*` → `/api/auto/*`.
- Sub-tabs are `?tab=` query params only — no nested routes except `/stocks/scout`. Per zone: stocks → `stock`/`dca`; intel → `similar`/`calibration`/`shadow`/`lessons`/`journal`; memory → `brain`/`memory`/`chroma`/`health`/`aggressive`. (autotrader and docs are single-view — no zone-level sub-tabs; docs has its own internal category tab strip inside the Downloads section from Wave B1.)

---

## API Routes

70 `route.ts` files under `src/app/api/`, grouped by zone (Wave E2 deleted 7 manual-scalp routes):

- **Dashboard** — `status`, `live`, `dashboard/calibration`, `stats/daily-pnl`, `heartbeat`, `prices`, `nav-badges`. (Wave B1 dropped the `/dashboard` page and its `active`/`pnl`/`edge`/`quick-stats` API routes. `dashboard/calibration` is kept but now orphaned — its sole consumer, the SCALP calibration section, was deleted in Wave C2; retained pending a cleanup wave.)
- **AutoTrader** — `auto/{state,config,trades}`, `capital`, `circuit-breaker`, `entry-preflight`, `exit-signals`, `analytics/{confidence-tiers,duration,regime-performance}`, `time-slots`, `trade-stats`.
- **Manual / Trades** — `signals/unread-count`, `trades` + `trades/{close,close-status,command-status,edit-entry,flip}`, `watchlist`, `reminders`, `dca`. (Wave E2 deleted the `signals` parent route, `live-board` + `live-board/{enter,ticker}`, and `trades/{add-position,partial-close,tranches}` with the manual-scalp helper teardown — `signals/unread-count` kept, it backs the nav unread badges.)
- **Intel** — `intel/{lessons,journal,similar,calibration,shadow,downloads}`, `journal`, `optuna`, `quality`, `training`.
- **Docs** — `docs/categories` (GET list + POST create), `docs/categories/[id]` (PUT rename / DELETE), `docs/categories/reorder` (PUT), `docs/downloads/[filename]/move` (PUT). Downloads category/folder system — all route through `query_docs_categories.py` → bot-side `download_manager` (backend, 2026-05-19; frontend lands in B1).
- **Memory** — `memory/{brain,chroma,daily,health,journal,aggressive,autotrader-toggle}`, `brain`, `system-health`, `aggressive`.
- **Chat** — `chat`, `chat/{stream,budget,suggestions}`.
- **Control / Admin** — `killswitch`, `kill-switch`, `admin/{current-state,reset-capital,reset-history,reset-pnl-stats,reset-xp}`, `feature-flags`, `commits`, `auth`, `health`.

Conventions:
- Handlers call `runPython()`, parse its stdout as JSON, and return that. Live-data routes set `export const dynamic = "force-dynamic"` to bypass caching; several wrap the call in try/catch and return a fail-safe JSON shape instead of throwing.
- About 30 of the 70 accept `POST` (writes/actions); the rest are GET-only reads.
- `chat/stream` is the one streaming endpoint — it returns a `ReadableStream` (SSE); every other route returns plain JSON.
- `admin/*` routes are destructive resets (capital / P&L stats / XP / history) — POST-gated, Ghost-only. `commits` reads recent git history for the in-app deploy widget.
- High-traffic reads: `live` (full dashboard payload), `status` (service state + XP + signal counts), `nav-badges` (bottom-nav unread counts), `heartbeat` (Observatory pulse).
- Dynamic segments: `intel/journal/[source]/[id]`, `intel/similar/[source]/[id]`, `memory/brain/[name]`, `memory/daily/[date]`, `quality/[id]`, `intel/downloads/[filename]`, `docs/categories/[id]`, `docs/downloads/[filename]/move`.

---

## Component Map

`src/components/` — 13 zone directories + 14 top-level files. Each redesigned zone has a `*-zone-view` (or `*-view`) dispatcher that the zone page renders and that swaps sections on the `?tab=` param.

| Directory | Files | Key components |
|---|---|---|
| `ui/` | 20 | A4 + legacy primitives — `card`, `panel`, `pill`, `tab-bar`, `metric-tile`, `bottom-sheet`, `skeleton` |
| `navigation/` | 4 | `bottom-nav`, `sidebar-rail`, `zone-sub-tabs`, `chat-fab` |
| `autotrader-v2/` | 8 | `scalper-view`, `scalper-header`, `capital-hero`, `config-card`, `autotrader-toggle-card` |
| `stocks/` | 3 | `stocks-zone-view` (dispatcher), `stock-section`, `dca-section` (was `scalp/`; SCALP sections deleted, Wave C2) |
| `scout/` | 14 | `scout-tabs`, `discovery-feed-v3`, `filings-stream`, `insider-heatmap`, `swing-signals-panel` |
| `intel/` | 4 | `intel-zone-view`, `similar-trades-section`, `calibration-section`, `shadow-section` |
| `docs/` | 4 | `downloads-section`, `lessons-section`, `lesson-card`, `journal-section` (migrated from `intel/`, Wave D2) |
| `memory/` | 9 | `memory-zone-view`, `brain-section`, `chroma-section`, `health-section`, `killswitch-control-card` |
| `chat/` | 4 | `chat-panel`, `chat-modal`, `chat-message`, `chat-empty-state` |
| `trades/` | 4 | `live-board`, `trade-form`, `history-table`, `journal-tab` |
| `charts/` | 2 | `StyledLineChart`, `StyledBarChart` (Recharts wrappers) |
| `control/` | 2 | `brain-editor`, `chroma-browser` |
| `intelligence/` | 1 | `OptunaShadowCard` (legacy) |

- Top-level: `app-shell.tsx` (+ `-nav`, `-legacy`), `header.tsx` (+ `-legacy`), `sidebar.tsx`, `status-bar.tsx`, `theme-provider.tsx`, `KillswitchPill.tsx`, `PriceStrip.tsx`, `change-password-modal.tsx`, `TabContainer.tsx`, `typing-dots.tsx`, `Skeleton.tsx`.
- `layout.tsx` mounts `<ThemeProvider><AppShell>`; the `*-legacy` shells are pre-redesign chrome kept for `HUB_REDESIGN_NAV` rollback.
- Chat is reachable two ways — the `/chat` page and a global `chat-fab` → `chat-modal` overlay.
- `scout/` carries its own data layer (`api.ts`, `use-fetch.ts`, `types.ts`, `format.ts`), separate from the shared `runPython` path.

---

## Python Helper Scripts

The Hub has no direct SQLite binding — every DB read/write goes through Python scripts at the repo root. Verified counts:

- **`query_*.py` × 42** — READ-ONLY (`trevor.db` opened `mode=ro`); Wave E2 deleted 6 manual-scalp query helpers. Notable: `query_brain.py`, `query_trades.py`, `query_training.py`, `query_feature_flags.py` (the last backs `/api/feature-flags`).
- **`set_*.py` × 5** — WRITE: `set_killswitch.py`, `set_aggressive.py`, `set_autotrader_enabled.py`, `set_dca.py`, `set_reminders.py`.
- **`write_*.py` × 2** — WRITE: `write_brain_file.py`, `write_chat_log.py`.
- **`manage_*.py` / `chat_*.py`** — `manage_{brain,portfolio,schedule,watchlist}.py`, `chat_bridge.py`, `chat_ai.py`.

Invoked from `src/lib/api-helpers.ts`:
- **`runPython(script, args)`** — `spawnSync` with an argv array: **no shell, no string interpolation**, so user input is injection-safe (it never reaches a shell). Synchronous — **never `await` it**. Default timeout 15 s, `maxBuffer` 10 MB; runs with `cwd=/home/trevor/trevor` and `HOME=/home/trevor`.
- **`runPythonInline(code)`** — runs a snippet via `python3 -` (stdin); untrusted values must be passed through the env map, never interpolated into the code string.
- A non-zero exit becomes a thrown `Error` carrying the first 500 chars of stderr; scripts must print one JSON object to stdout. Python binary: `/home/trevor/trevor/venv/bin/python3`.

---

## Design System

- A4 tokens live in `globals.css` under `@theme inline` — a **locked** parallel namespace. Do not extend it without an A4-revision prompt.
- A4 token families: `--color-*`, `--shadow-glow-*`, `--radius-*` (incl. `--radius-pill`), `--transition-duration-*` (instant 80 ms / fast 160 ms / medium 240 ms / slow 400 ms), `--breakpoint-*` (`xs` 375 px, `mm` 430 px), `--animate-*`.
- Legacy tokens stay under `:root` (`--background`, `--card`, `--neon-*`, `--glow-*`, `--sidebar`) and still drive pre-A4 components; the two namespaces coexist deliberately.
- Cyberpunk palette: primary/brand **cyan `#00f0ff`**; neon accents — green `#00ff88`, magenta `#ff00ff`, amber `#ffaa00`, red `#ff3366`, violet `#b478ff`. Backgrounds `#0a0a0f` / `#12121a`. The `html.oled` class swaps to true-black.
- Font: **JetBrains Mono** — the only `@font-face`-loaded family (weights 400/700), exposed as `--font-mono`.
- **19 `@keyframes`** in `globals.css` — legacy (`shake`, `pulseLive`, `scanline`, `ticker-scroll`, `quickJumpIn`, …) and A4 (`pulse-cyan/amber/green/magenta`, `shimmer-ds`, `slide-up`, `fade-in`, `slide-up-spring`, `slide-down-spring`, `scrim-fade-in`).
- **20 primitives** in `src/components/ui/`, including trading-domain ones — `direction-badge`, `money-text`, `confidence-bar`, `killswitch-pill`, `live-pulse`. `tw-animate-css` is imported; dark styling uses the `@custom-variant dark` selector.
- `/design-system` renders every `ui/` primitive live — review it before building a new one. Mobile-interaction hooks: `useLongPress`, `usePullToRefresh`, `useScrollDirection`.
- The "live data" affordance is `live-pulse` + the `pulse-*` keyframes — reuse it rather than rolling a new indicator.
- Mobile-first — verify every layout at **375 px** (the `xs` breakpoint) before calling it done.
- Bottom nav: 5 zones — Auto, Stocks, Intel, Docs, Memory (Wave B3 dropped the HOME slot; Wave C2 renamed Manual→Stocks; Wave D3 added the Docs slot). Chat is a floating action button, not a tab.

---

## Feature Flags

`HUB_REDESIGN_*` flags are rows in the `auto_config` DB table. The Hub reads them via `/api/feature-flags` → `query_feature_flags.py` (fail-safe: any error → all-off → old layout). A flag flip is a direct `auto_config` write — picked up within seconds on the next read, no restart needed. The `hub_redesign_override=` cookie lets Ghost preview a flag per-session without flipping the DB (format: `hub_redesign_override=HUB_REDESIGN_CHAT=true`, comma-separate multiple).

Live values, verified from `auto_config` on 2026-05-16:

| Flag | Value | Gates |
|---|---|---|
| `HUB_REDESIGN_MODE` | `false` | master switch for the whole redesign |
| `HUB_REDESIGN_NAV` | `true` | redesigned nav shell (sidebar + bottom bar) |
| `HUB_REDESIGN_DASHBOARD` | `true` | rebuilt `/dashboard` |
| `HUB_REDESIGN_AUTO` | `true` | AutoTrader v2 (`autotrader-v2/`) |
| `HUB_REDESIGN_AUTO_API` | `true` | consolidated `/api/auto/*` endpoints |
| `HUB_REDESIGN_SCALP` | `true` | gates the `/stocks` page — legacy flag name kept (Wave C2 renamed the zone, not the inert `auto_config` key; additive-DB rule) |
| `HUB_REDESIGN_INTEL` | `true` | rebuilt `/intel` sections |
| `HUB_REDESIGN_MEMORY` | `true` | rebuilt `/memory` sections |
| `HUB_REDESIGN_CHAT` | `false` | new chat surface |
| `HUB_REDESIGN_DOCS` | `true` | gates the `/docs` page — Downloads / Lessons / Journal live (Wave D2) |
| `SCOUT_V3_FEED` | `true` | SCOUT discovery feed v3 |

Eight wave flags are live; `MODE` (master) and `CHAT` remain off. Note: `feature-flags.ts:readFlag()` is a leftover stub that always returns `false` — `/api/feature-flags` is the real source.

---

## Deploy Checklist

Commit first — explicit `git add <files>` (never `-A`) on branch `master` — then:

1. `npm run build` (`next build`) — must succeed.
2. `npx tsc --noEmit` — must pass.
3. `sudo systemctl restart trevor-dashboard.service` — **required after every build.** The running Next.js server caches its build manifest in memory; rebuilding without a restart leaves it serving HTML that references deleted fingerprinted CSS/JS → 400/404 on every asset, pages render unstyled. After the restart, check `journalctl -u trevor-dashboard.service -n 30` for boot errors before moving on.
4. `bash verify_deploy.sh` — ~50 smoke checks: service health, page routes, API GETs, the brain-write 423 gate, the unauth 401 gate, chat-budget gate, recurring-bug canaries, litestream. It exits non-zero if any check fails, and still probes the retired `ghost-qa.service`, so expect one pre-existing FAIL — judge the run on the rest.
5. Confirm the change live at https://trevor-prime.com.

Ad-hoc route test (auth is a cookie):
```bash
curl -s -c /tmp/c -X POST localhost:3333/api/auth -H 'Content-Type: application/json' \
  -d "{\"action\":\"login\",\"username\":\"trevor\",\"password\":\"$(grep ^DASHBOARD_PASS= .env.local|cut -d= -f2-)\"}"
curl -s -b /tmp/c localhost:3333/api/status
```

No service restarts mid-task — restart only at step 3, and only with Ghost approval.

---

## Known Issues

- `feature-flags.ts:readFlag()` is a stub that always returns `false`; the real flag source is `/api/feature-flags`. Components must not call `readFlag()` directly.
- Duplicate API routes `api/killswitch/` and `api/kill-switch/` both exist — `killswitch/` is live (it calls `set_killswitch.py`); `kill-switch/` looks legacy. Consolidate when next touched.
- Two `aggressive` endpoints exist — `api/aggressive/` and `api/memory/aggressive/`; only `memory/aggressive/` calls `set_aggressive.py` (same split pattern as the killswitch routes).
- `next.config.ts` legacy redirects target retired zone names (`/trading`, `/intelligence`, `/command`) and only resolve because `middleware.ts` re-chains them — editing either file alone can silently break legacy links.
- `verify_deploy.sh` still probes `ghost-qa.service` (retired) and the pre-rename `/scalp?tab=*` paths — the service check is a pre-existing FAIL; the page checks pass only because the 308 redirect is accepted.
- `verify_deploy.sh` briefly force-mutates two `auto_config` rows (`HUB_BRAIN_EDIT_ENABLED`, `ANTHROPIC_API_DAILY_TOKENS_USED`) during its gate tests and restores them — don't run it alongside a real config edit.
- `middleware.ts` hardcodes the VM IP `34.28.231.36` for the direct-IP→domain redirect; a VM IP change silently breaks it.
- `/chat` injects a page-scoped `<style>` block overriding the global theme (Termius-blue) — a deliberate zone-local exception to the design tokens.
- `api/admin/reset-history/route.ts` exists but exposes no `POST` handler — incomplete or a stub.
- `change-password-modal.tsx` is present but historically buggy (field-name mismatch) — verify before relying on it.
- `tsconfig.tsbuildinfo` and `.env.local` are perpetually modified in `git status`; the repo root also carries stale `*.bak` files — never stage any of them in a selective commit.

---

## Hub-Specific Rules

- **`trevor.db` belongs to the bot.** The Hub reads it `mode=ro`. Writes happen only through the ~30 `POST` API routes — config flags (killswitch, aggressive, autotrader-toggle, DCA), trade actions (close / flip / edit-entry / partial-close / add-position), reminders & DCA CRUD, chat logging, brain-file edits, admin resets. Treat every other route as read-only and keep it that way.
- DB changes are **additive** — new rows / new `auto_config` keys, never destructive schema edits.
- Surgical edits only — change what the prompt asks and nothing more; diagnose before you touch.
- Verify after every change — build, restart, hit the route — before reporting it done.
- `HUB_REDESIGN_*` and other `auto_config` flags are Ghost-controlled rollout switches — never flip one without explicit direction.
- **Brain-file edits** go through `/api/memory/brain/[name]` → `write_brain_file.py`, gated by the `HUB_BRAIN_EDIT_ENABLED` flag; the bot's protected brain documents are rejected with HTTP 423.
- **Secrets**: `.env.local` (perms 600) holds `DASHBOARD_USER` / `DASHBOARD_PASS`; `.env` holds `DISCORD_BOT_TOKEN`. Append-only — never overwrite an existing key. `/api/auth` re-reads `.env.local` on every POST, so a password rotation needs no restart.
- **Never modify files under `/home/trevor/trevor/`** from a Hub prompt — only read its `trevor.db`.
- Bot-side engineering rules — file protection, deploy discipline, the honesty protocol — live in `/home/trevor/trevor/BEHAVIOR_RULES.md` + `/home/trevor/trevor/CLAUDE.md`. Cross-reference them; do not copy them here.
- Honesty protocol applies to Hub work too: never claim done / fixed / working without pasted command output.

---

## Hub Wave Changelog (additive — most recent at top)

### 2026-05-20 — Docs cleanup: Uncategorized first, archive UI removed
- **Uncategorized is now the FIRST tab** in the Docs category strip — newly-delivered files land in Uncategorized, so it is the default landing tab. `src/components/docs/category-tabs.tsx`: the `items` useMemo prepends Uncategorized to `categoryItems` instead of appending; the surrounding comment is updated to reflect the new ordering.
- **Archive UI removed entirely** from `src/components/docs/downloads-section.tsx`. The All/Active/Archived `<SegmentedToggle>` (and its `DownloadFilter` type + `FILTER_OPTIONS` const) is gone; the Archive / Unarchive `<HapticButton>` on each file card is gone; the `archiving` in-flight `Set<string>` state + the `handleArchiveToggle` async handler are gone; the `Archive` and `RotateCcw` lucide-react imports are gone; the `SegmentedToggle` + `SegmentedToggleOption` ui imports are gone; the `opacity-70 border-border-amber/40` className conditional on `file.archived` is gone (the Card now always renders at full opacity); the amber "📦 Archived" `<Pill>` is gone; the cyan/amber `{stats.active_count} active` / `{stats.archive_count} archived` pill pair in the header collapsed into a single `{stats.active_count} files` pill (archive_count is always 0 now); the empty-state copy lost its `filter === "active"` / `filter === "archived"` branches; the listing fetch URL `/api/intel/downloads?status=${status}` lost its `?status=` querystring. File cards now show **Download / Move / Delete** only.
- **Additive principle preserved on the backend side.** The `archived: boolean` and `archived_at: string | null` fields stay in the `DownloadFile` TypeScript interface (and in `manifest.json`); the `archive_count: number` field stays in the `DownloadStats` interface (and in `get_stats()`); the `filter` field stays in `DownloadsResponse` as an optional documentation marker. The bot-side `archive_file` / `unarchive_file` functions and the `/api/intel/downloads/archive` + `/unarchive` API routes are untouched on disk — just unreachable from the UI. No backend code changed in this Hub wave.
- **Paired bot-side wave (2026-05-20):** downloads auto-delete permanently disabled. With archive-as-protection gone, the cleanup path it shielded files from must also stay off. `/home/trevor/trevor/download_manager.py` got a new module constant `DOWNLOADS_AUTO_DELETE_ENABLED = False` guarding `cleanup_expired()` at the function entry; `scripts/cleanup_downloads.sh` is a no-op early-exit; `trevor-downloads-cleanup.timer` is `systemctl disable --now`; `hooks/guard_recurring_bugs.sh` gained Bug #15 (canary count 14 → 15). Bot-side detail in `/home/trevor/trevor/CLAUDE.md`.
- **Verified post-build:** `npx tsc --noEmit` clean (0 errors); `next build` clean — `/docs` route **6.17 kB** (down from B2's 6.7 kB; SegmentedToggle + Archive button + their handlers stripped). Live verification + dashboard restart happens in Phase 3 of this wave.

### 2026-05-19 — Lessons + Journal moved back to /intel, /docs becomes single-view
- **Reversed Wave D2's split for Lessons/Journal.** They're back on `/intel` as tabs 4 and 5; `/docs` becomes a single-view zone showing only the Downloads category browser (B1/B2). Component source files stay under `components/docs/` per Ghost direction; only dispatcher routing changes. The API namespace (`/api/intel/lessons`, `/api/intel/journal/...`) was already on `/intel` from Wave D2 and required no change.
- **`src/lib/navigation.ts`** — Intel zone `subTabs` extended to `[similar, calibration, shadow, lessons, journal]` (`defaultSubTab` unchanged: `similar`; magenta accent unchanged). Docs zone `subTabs` + `defaultSubTab` dropped entirely (matches `/autotrader` single-view pattern — `<ZoneSubTabs />` auto-hides on zones without subTabs, line 17). File-header comment (lines 11–12) corrected to reflect the new zone layout.
- **`src/components/intel/intel-zone-view.tsx`** — added `LessonsSection` + `JournalSection` imports from `@/components/docs/...` and the two new `case "lessons"` / `case "journal"` branches. The Wave-D2-history comment was rewritten to record the 2026-05-19 reversal.
- **`src/app/docs/docs-zone-view.tsx`** — removed `LessonsSection` + `JournalSection` imports and the `case "lessons"` / `case "journal"` branches; the file-header comment now records the single-view state. Switch shape is retained on purpose so a stale `/docs?tab=lessons` bookmark falls through to the default `DownloadsSection` (no broken state, no console error).
- **`src/components/docs/downloads-section.tsx`** — corrected one now-stale JSX comment near the category-tabs render that referenced a "DOWNLOADS / LESSONS / JOURNAL zone strip" that no longer exists.
- **Untouched on purpose:** the component files themselves (`lessons-section.tsx`, `lesson-card.tsx`, `journal-section.tsx`) stay under `components/docs/` — only the dispatcher routes them differently now. No new primitives, no new design tokens, no new npm deps. Auto, Stocks, Memory, design-system, and all Python under `/home/trevor/trevor/` are untouched.
- **Verified live post-deploy:** `npx tsc --noEmit` clean (0 errors, both phase checkpoints); `next build` clean — `/intel` route **7.73 kB** (up from prior baseline; +2 sections), `/docs` route **6.7 kB** (down from B2's 10.2 kB; −2 sections — bundle redistribution visible). `trevor-dashboard.service` restarted 2026-05-19 22:11:23 UTC PID 1936180 → `[HUB] TREVOR Hub ready on http://127.0.0.1:3333` in 1 s, 0 boot errors / warnings (`journalctl --since "2 minutes ago"` grep `error|warning|fail|fatal|exception` returned empty). Cookie-auth SSR probes: `GET /intel` 200 (26.7 kB) — all 5 tab labels present (`Similar`/`Calibration`/`Shadow`/`Lessons`/`Journal`); `GET /intel?tab=lessons` 200 (28.8 kB) renders the `LESSONS` card; `GET /intel?tab=journal` 200 (27.4 kB) renders the `JOURNAL` card; `GET /docs` 200 (26.4 kB) — zone strip absent (no `Lessons`/`Journal`/`Downloads` outer labels), Downloads section header `DOWNLOADS` present, B1 category `tablist` + B1/B2 controls (`Filter downloads`, `Manage categories`) intact. Sacred 9/9 byte-identical to Phase 0 capture (md5 match); `guard_recurring_bugs.sh` 14/14 PASS.
- Hub commit `3b99307` on `master` (4 code files, +44/−45). This `CLAUDE.md` entry is a separate `docs:` commit. Bot side: a parallel `docs:` commit refreshes `/home/trevor/trevor/BEHAVIOR_RULES.md` Sections 2 + 3 + `/home/trevor/trevor/CLAUDE.md` Hub zone description — no Python touched.

### 2026-05-19 — Docs page: Move-to + category settings (Wave B2)
- **Move-to file controls + ⚙️ settings modal** on the `/docs?tab=downloads` page, completing the A1 backend + B1 tab strip. Every file card gains a fourth button (**MOVE**, violet `accent-violet`, `FolderInput` lucide icon) that opens a `<BottomSheet>` listing every category (sort_order) + Uncategorized; tap → `PUT /api/docs/downloads/[filename]/move` → list refetches, the card drops from the current tab, count badges recompute via the existing `useMemo` (no extra plumbing — single-fetch design from B1 already feeds the counts). The DOWNLOADS `<CardHeader>` gains a ⚙️ `Settings` gear (top-right next to the stats pills, magenta hover accent) opening a second `<BottomSheet>` titled MANAGE CATEGORIES.
- **`src/components/docs/move-to-sheet.tsx`** (NEW, ~165 lines) — presentational; one shared sheet at section level, opened for whichever file was tapped (`moveSheetFile: DownloadFile | null` state in the parent). Per-row in-flight (`Moving…`) + error (`Failed`, auto-reverts after 2 s) state; current category cyan-highlighted with `Check` icon, disabled (tap is a no-op + close). Uncategorized rendered last, `category_id: null` path.
- **`src/components/docs/category-settings-sheet.tsx`** (NEW, ~370 lines) — category CRUD inside a `<BottomSheet>`: each category row renders `[name (tap-to-edit input)] [file count Pill] [Trash2 delete]`. **Inline rename** — tap name → cyan-bordered input → Enter/blur saves → `PUT /api/docs/categories/[id]`. **Inline 2-tap delete** — first tap arms `Confirm (N→Uncat)` pulsing red for 3 s; second tap fires `DELETE /api/docs/categories/[id]`; backend auto-moves files to Uncategorized. **Add Category** — `+ Add Category` footer button reveals an inline input → Enter creates → `POST /api/docs/categories`. Uncategorized rendered last as a dashed-border locked row (system category, no edit/delete affordance). Per-row error notes surface inline below the row.
- **Reuse — no new primitives, no new deps.** `<BottomSheet>` (existing ui/) covers both sheets — slide-up on mobile with scrim + Escape + body-scroll-lock + sticky header ✕, centered modal `md:max-w-2xl` on desktop. `HapticButton`, `Pill`, `Card`, lucide icons (`FolderInput`, `Settings`, `Check`, `Pencil`, `Plus`, `Trash2`, `X`) all reused. **Drag-reorder intentionally NOT implemented** — no DnD library installed; the prompt's hard constraint forbids adding one just for reorder. The A1 `PUT /api/docs/categories/reorder` route stays available for a future wave.
- **`src/components/docs/downloads-section.tsx`** (modified) — surgical additions: import the two new sheets + the `Settings` icon; add `moving: Set<string>`, `moveSheetFile: DownloadFile | null`, `settingsOpen: boolean` state; add `handleMove(filename, category_id)` (mirrors `handleArchiveToggle`/`handleDelete` patterns — PUT then refetch then clear); pass `moving` + `onMove` through to `DownloadFileCard`; insert the MOVE button after Download in the file-card button row (`flex-wrap` keeps 4 buttons usable at 375 px); wrap the header right-slot in `<div className="flex items-center gap-2">` to host the stats + gear; mount both sheets at section root. **New effect** falls back to `UNCATEGORIZED_KEY` when `activeCategory` is no longer in the categories list (e.g. user deleted the active tab from the settings sheet). Existing handlers Download / Archive / Delete are byte-identical to pre-B2.
- **Untouched:** `src/lib/navigation.ts`, `<ZoneSubTabs/>`, `docs-zone-view.tsx`, `category-tabs.tsx`, `LessonsSection`, `JournalSection`, the Intel zone, every Python module under `/home/trevor/trevor/`. The two sheets live inside the Downloads sub-tab only; the global zone tabs and Lessons/Journal sub-tabs are unaffected.
- **Verified live post-deploy:** `npx tsc --noEmit` clean (0 errors); `next build` clean — `/docs` route 10.2 kB (up from 8.6 kB at B1 baseline, +1.6 kB for the two new sheets); `trevor-dashboard.service` restarted 2026-05-19 21:43:21 UTC PID 1925389 → `[HUB] TREVOR Hub ready on http://127.0.0.1:3333` in 2 s, 0 boot errors / warnings. Unauth probes: `/api/docs/categories` 401, `/api/docs/downloads/x/move` 401 — auth gate intact. Authed end-to-end smoke (8 steps): file move to `reports` → counts `{reports:1, uncategorized:18}` → move back → success; create `B2 Smoke` → list grows to 4 → rename to `B2 Smoke Renamed` (id preserved) → delete (returns `files_moved: 0`) → clean state restored (3 categories, 19 uncategorized). Sacred 9/9 byte-identical to Phase 0 capture (md5sum match); `.sacred_manifest.sha256` check OK; `guard_recurring_bugs.sh` 14/14 PASS (re-run post-restart, baseline-match).
- Hub commit on `master`. Bot side has no commit this wave (no Python touched).

### 2026-05-19 — Docs category tabs frontend (Wave B1)
- **Frontend for the A1 category system.** The `/docs?tab=downloads` view now renders a category tab strip (**Reports · Audits · Monitor · Uncategorized**, categories in `sort_order` then Uncategorized last) with per-tab count badges, and the file list filters to the selected tab. The global zone strip (DOWNLOADS / LESSONS / JOURNAL) is unchanged — Lessons and Journal are unaffected.
- **New `src/components/docs/category-tabs.tsx`** — presentational; wraps the shared `<TabBar>` primitive (the same component `<ZoneSubTabs/>` uses), so the strip matches the Similar / Calibration / Shadow styling exactly: horizontal scroll, 44 px tap targets, cyan active underline, muted count-pill badges. Responsive negative margins extend `TabBar`'s built-in `-mx-4` bleed to the section's `md:p-6` / `lg:px-8` padding so the strip stays edge-to-edge at every breakpoint.
- **`src/components/docs/downloads-section.tsx`** — adds `categories` + `activeCategory` state, fetches `GET /api/docs/categories` once on mount (degrades to a lone Uncategorized tab if the route 404/500s — same defensive shape `LessonsSection` uses), derives per-tab file counts via `useMemo` over the existing listing, and filters the displayed list client-side. The status `SegmentedToggle` (All / Active / Archived) and every action handler (Download / Archive / Delete) are byte-identical to pre-B1. `DownloadFile.category_id` added to the interface (was already returned by the API since A1).
- **Single-fetch design** — one `/api/intel/downloads?status=…` call holds every file with its `category_id`, so tab switches filter in-memory with 0 network and no stale-response risk. The `?category=` server filter A1 added stays available (verified live below) but is unused by the UI — count badges already force a full client-side dataset, which would make a per-tab fetch redundant. Recommended over the prompt's per-tab `?category=` and Ghost-confirmed at the Phase 0 gate.
- **Default tab on first load** — the first category (by `sort_order`) that has files, else Uncategorized. Picked exactly once (a `categoryInitRef` guard) so later 60 s polls and status-toggle changes never yank the user off their selected tab. With every file currently `category_id=null`, the live default resolves to Uncategorized.
- **Untouched:** `src/lib/navigation.ts`, `<ZoneSubTabs/>`, `docs-zone-view.tsx`, `LessonsSection`, `JournalSection`, the Intel zone, every Python module under `/home/trevor/trevor/`. The category tabs are a second-level strip inside the Downloads sub-tab; the global zone tabs are unaffected.
- ⚠️ **Path note** (carry-over from A1): the prompt's stated component path (`src/components/intel/downloads-section.tsx`) is stale — the component moved to `src/components/docs/` in Wave D2. Real `docs/` path used.
- **Verified live post-deploy:** `npx tsc --noEmit` clean, `next build` clean, `trevor-dashboard.service` restarted 2026-05-19 21:19:55 UTC PID 1921309 → `[HUB] TREVOR Hub ready on http://127.0.0.1:3333` in 1 s, 0 boot errors / warnings. `GET /api/docs/categories` 200 (3 categories + `uncategorized_count=19`); `GET /api/intel/downloads?category=reports` 200 with `files: []`; `GET /api/intel/downloads` 200 returning 19 files all `category_id=null` (matches `manifest.json` state); `GET /docs?tab=downloads` 200 (cookie-auth). Sacred 9/9 byte-identical to Phase 0; `discord_bot.py` regression check unchanged (`signal_guard|cooldown|cleanup` refs = 20).
- Commit `ab6fc03` (Hub, `master`); this CLAUDE.md entry is a separate `docs:` commit. Bot side has no commit this wave (no Python touched).

### 2026-05-19 — Docs category system: backend + API routes (frontend deferred to B1)
- **Bot side** (`download_manager.py`, repo `trevor` / `main`) — new `downloads/categories.json` (folder defs: `id` slug · `name` · `sort_order` · `created_at`) and a `category_id` field on every `manifest.json` entry (`null` = Uncategorized; 19 existing entries backfilled). 8 new functions — `load_categories` / `save_categories` / `create_category` / `rename_category` / `delete_category` / `reorder_categories` / `move_file_to_category` / `list_downloads_by_category` — atomic tmp-rename writes + the existing module lock.
- **New dispatcher `query_docs_categories.py`** at the Hub repo root (beside `query_downloads.py`) — actions `categories-list` / `category-create` / `category-rename` / `category-delete` / `category-reorder` / `file-move` / `list-by-category`; always emits one JSON object and exits 0.
- **4 new API routes** under `src/app/api/docs/` — `categories/route.ts` (GET list + uncategorized_count, POST create), `categories/[id]/route.ts` (PUT rename, DELETE), `categories/reorder/route.ts` (PUT), `downloads/[filename]/move/route.ts` (PUT). Auth is `middleware.ts`-global — no per-route auth code, matching the existing downloads routes. Status codes 400 / 404 / 500.
- **`src/app/api/intel/downloads/route.ts`** extended — optional `?category=<id>` / `?category=uncategorized` filter (via `list-by-category`); no param → unchanged behavior. Every file in the response now carries `category_id`.
- Verified: `npx tsc --noEmit` clean; `query_docs_categories.py` exercised for all 7 actions + negative cases. **Live `curl` checks + the Hub build/restart are deferred to Wave B1** — this wave ships no frontend and triggers no restart. Bot `main` carries the `download_manager.py` / `categories.json` / `manifest.json` commit; Hub `master` carries the routes + dispatcher + this entry.

### 2026-05-19 — Downloads: delete button (confirm-to-delete + Discord cleanup)
- **New API route `src/app/api/intel/downloads/delete/route.ts`** — `POST {filename}`, mirrors `archive/route.ts` exactly: filename validation (rejects empty / `/` / `..`), `runPython("query_downloads.py", ["delete", filename])`, returns the result JSON — `200` success, `404` not-found, `400` bad input, `500` on a Python error.
- **`query_downloads.py`** — new `delete` action alongside `list` / `archive` / `unarchive` / `path`; calls bot-side `download_manager.delete_download()` and emits `{success, filename, discord_deleted, error}`. Touching `query_downloads.py` was required to mirror the archive route — the archive route routes through this dispatcher, it does not import `download_manager` directly; the change is purely additive (one `elif` branch).
- **`src/components/docs/downloads-section.tsx`** — each file card gains a red (`accent-red` / `#ff3366`) DELETE button beside ARCHIVE. Two-tap confirm: first tap → "CONFIRM DELETE" (pulsing, brighter red) armed for 3 s; a second tap within the window fires the delete; otherwise it reverts to "DELETE". A failure shows "FAILED" for 2 s, then reverts. On success the list refetches — the card disappears and the header stats (active / archived counts + total MB) refresh from server truth. Works for active and archived files. `HapticButton` supplies the 44 px tap target + `uppercase` rendering.
- ⚠️ The prompt's stated component path (`src/components/intel/downloads-section.tsx`) was stale — the component moved to `src/components/docs/` in Wave D2. The real `docs/` path was used.
- Verified: `tsc --noEmit` clean, `next build` clean; live (cookie-auth) — `GET /api/intel/downloads` 200, `POST …/delete` nonexistent → `404 {"success":false,"error":"not found"}`, missing / `..` filename → `400`. `trevor-dashboard.service` restarted 2026-05-19 12:30 UTC — `[HUB] ready on :3333`, 0 boot errors.
- Commit `11e7171` (Hub, `master`); bot commit `842d431` (`main`). This `CLAUDE.md` entry is a separate `docs:` commit.

### 2026-05-19 — Heartbeat view: AutoTrader / Pipeline / Services detail cards + budget breakdown
- The HB-05/06/07 catch-up (entry below) extended `HeartbeatData` with sub-fields on `autotrader` / `pipeline` / `services` / `connectivity` / `budget`, but added detail cards only for Docker / Component Rates / Stuck Trades / Stale Loops / Self-Health — leaving those sub-fields typed-but-not-rendered. This fills the gap.
- **3 new detail cards** in the `grid-cols-1 md:grid-cols-2` strip: **AutoTrader** (status · trades today · today's P&L when `trades_today>0` · open positions when `open_count>0`, `unrealized_pnl_usd` shown only when non-null), **Pipeline** (scanner · regime · signals scored · guard pass/block · exit events), **Services** (per-service uptime + `↻ N (reason)` when `restart_count>0`).
- **Budget breakdown** — one-line `swarm $X · briefing $Y · …` (categories > $0.01, descending) under the Budget `ResourceBar` in System Resources. **Gateway blocks** — a `StatusRow` in the Connectivity card, shown only when `blocks_in_last_2h>0`.
- Graceful degradation throughout — every new render is conditional (zero/null/undefined → nothing shown, never a crash); `UNKNOWN` regime is gated out (collector miss-fallback). All optional fields handled TS-strict-safe (`?? 0` / null-narrowing) — `npx tsc --noEmit` clean, `next build` clean.
- ⚠️ Phase 0 gate notes: the prompt's Phase 1-4 assumed pre-existing AUTOTRADER/PIPELINE/SERVICES detail cards — they did not exist (only one-line summary tiles), so they were built fresh as detail cards (Ghost-approved Option A). The prompt's `git push origin main` was corrected to **`master`**.
- Single-file change: `src/components/memory/heartbeat-view.tsx`. `trevor-dashboard.service` restarted 2026-05-19 03:39:48 UTC; `/memory?tab=health` → 307 (auth gate), `/login` → 200, 0 startup errors.

### 2026-05-18 — Heartbeat view parity (HB-05/06/07 catch-up)
- `src/components/memory/heartbeat-view.tsx` (HB-04 vintage) had drifted behind the HB-05/06/07 Observatory collector extensions — surgical single-file fix; view renders at `/memory?tab=health`.
- **`HeartbeatData` interface extended** — added `docker` / `component_rates` / `self_health` categories (all optional → graceful "Data unavailable" fallback) plus `OpenPosition`/`GatewayInfo`/`BudgetBreakdown`/`StuckTrade`/`ContainerItem`/`ComponentRate` types and missing sub-fields on `services`, `pipeline`, `autotrader`, `connectivity`, `budget`; `stuck_trades.trades` retyped `unknown[]` → `StuckTrade[]`.
- **Connectivity card** — hardcoded `pending (HB-05)` pills replaced with live HL-API / Discord-WS reachability + latency + reconnection data.
- **5 new cards** — Docker, Component Rates, Stuck Trades, Stale Loops, Observatory Self-Health — full-width `grid-cols-1 md:grid-cols-2`, mobile-first.
- **Countdown fix** — "Next/Last heartbeat" now key off the API `timestamp` (real post time), not `lastUpdated` (the 30s poll time, which reset every cycle).
- New local `StatusRow` + `CardNote` components. Verified: `tsc --noEmit` clean, `npm run build` OK, `trevor-dashboard.service` restarted 2026-05-18 17:16 UTC (clean boot), `/memory?tab=health` 200, `/api/heartbeat` 200 (13 categories). Only `heartbeat-view.tsx` touched.

### 2026-05-17 — Wave G (AutoTrader Consolidation roadmap closeout — Hub side)
- Wave G1 full-system smoke verified the Hub: all 5 zones return 200 and the legacy redirects resolve correctly (Domain 5 PASS). Overall G1 verdict was **PARTIAL** — full report in the bot repo at `audits/wave_g1_full_system_smoke_2026-05-17.md`.
- G1 flagged one **pre-existing Rule 26 violation** in `src/app/api/watchlist/route.ts` — its GET/POST/DELETE handlers interpolate user input into `execSync` template strings instead of using the `runPython` argv bridge. Pre-dates the A-G roadmap; a surgical fix prompt (convert to `runPython`) is scheduled. (`status/route.ts` also uses `execSync` but with no user input; `trades/route.ts` uses `execSync` with proper single-quote escaping — `watchlist` is the lone genuine violation.)
- G2 — this Hub `CLAUDE.md` Wave G entry; bot `BEHAVIOR_RULES.md` + `CLAUDE.md` state lock-in. **No Hub code changed.**
- Final 5-zone nav AUTO (landing) · STOCKS · INTEL · DOCS · MEMORY confirmed live; Hub-Only Control Doctrine (Rule 32) in effect.
- AutoTrader Consolidation roadmap (Waves A-G) — functionally complete with the one open security item above.

### 2026-05-16 — Wave E2 (Manual-scalp Python helpers + routes deleted)
- 6 manual-scalp `query_*.py` helpers deleted
- 7 manual-scalp API routes deleted (`live-board` ×3, `signals` parent, `trades/{add-position,partial-close,tranches}`)
- `signals/unread-count` kept — backs the nav unread badges

### 2026-05-16 — Wave D3 (DOCS nav slot)
- 5-zone final nav: AUTO, STOCKS, INTEL, DOCS, MEMORY
- grid-cols-5 mobile layout

### 2026-05-16 — Wave D2 (Docs content migration)
- Downloads + Lessons + Journal moved from /intel to /docs
- /intel reduced to Similar + Calibration + Shadow
- HUB_REDESIGN_DOCS flipped to true

### 2026-05-16 — Wave D1 (Docs scaffold)
- /docs route scaffolded with 3 placeholder tabs
- HUB_REDESIGN_DOCS flag added (default false)

### 2026-05-16 — Wave C2 (Stocks rename)
- /manual → /stocks (308 redirect)
- SCALP tab + scalp/* components deleted
- /scalp also redirects to /stocks

### 2026-05-16 — Wave B3 (HOME slot removed from bottom nav)
- HOME slot removed from the bottom nav

### 2026-05-16 — Wave B2 (DEGEN removal)
- /autotrader single-view (Scalper renamed AUTOTRADER)
- DEGEN tab + components deleted

### 2026-05-16 — Wave B1 (HOME drop)
- / redirects to /autotrader
- /dashboard route + components deleted
- Login post-auth → /autotrader
