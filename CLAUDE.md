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
| `/dashboard` | Main dashboard — P&L hero, active positions, supporting widgets |
| `/autotrader` | AutoTrader — Scalper + Degen views |
| `/manual` | Manual signals — Scalp / Stock / DCA sub-tabs |
| `/manual/scout` | SCOUT discovery feed |
| `/intel` | Lessons / Journal / Similar / Calibration / Shadow / Downloads |
| `/memory` | Brain / Memory / ChromaDB / System Health / Aggressive |
| `/chat` | TREVOR chat (direct Anthropic API) |
| `/login` | Cookie auth |
| `/design-system` | A4 primitive showcase (internal) |

- App-level files in `src/app/`: `layout.tsx` (shell), `error.tsx` (error boundary), `not-found.tsx` (404), `globals.css`.
- Every page except `/login` is auth-gated by `middleware.ts`; an unauthenticated page request 302-redirects to `/login?from=<path>`, and unauthenticated `/api/*` calls get a 401.
- Redirect-only pages: `/` → `/dashboard`; `/brain` → `/control` (chains through to `/memory`).
- Legacy redirects in `middleware.ts` (308): `/trading` & `/scalp` → `/manual`, `/command` → `/memory`, `/intelligence` → `/intel`.
- Legacy redirects in `next.config.ts` (308): `/trades` `/holdings` `/signals` `/research` `/training` `/control` `/ghost` `/dev-tasks` `/reminders` → a retired zone path + `?tab=` (then re-chained by `middleware.ts`); plus 3 `/api/auto-trader/*` → `/api/auto/*`.
- Sub-tabs are `?tab=` query params only — no nested routes except `/manual/scout`. Per zone: autotrader → `scalper`/`degen`; manual → `scalp`/`stock`/`dca`; intel → `lessons`/`journal`/`similar`/`calibration`/`shadow`/`downloads`; memory → `brain`/`memory`/`chroma`/`health`/`aggressive`.

---

## API Routes

81 `route.ts` files under `src/app/api/`, grouped by zone:

- **Dashboard** — `status`, `live`, `dashboard/{active,pnl,edge,calibration,quick-stats}`, `stats/daily-pnl`, `heartbeat`, `prices`, `nav-badges`.
- **AutoTrader** — `auto/{state,config,trades}`, `capital`, `circuit-breaker`, `entry-preflight`, `exit-signals`, `analytics/{confidence-tiers,duration,regime-performance}`, `time-slots`, `trade-stats`.
- **Manual / Trades** — `signals`, `signals/unread-count`, `trades` + `trades/{add-position,close,close-status,command-status,edit-entry,flip,partial-close,tranches}`, `live-board` + `live-board/{enter,ticker}`, `watchlist`, `reminders`, `dca`.
- **Intel** — `intel/{lessons,journal,similar,calibration,shadow,downloads}`, `journal`, `optuna`, `quality`, `training`.
- **Memory** — `memory/{brain,chroma,daily,health,journal,aggressive,autotrader-toggle}`, `brain`, `system-health`, `aggressive`.
- **Chat** — `chat`, `chat/{stream,budget,suggestions}`.
- **Control / Admin** — `killswitch`, `kill-switch`, `admin/{current-state,reset-capital,reset-history,reset-pnl-stats,reset-xp}`, `feature-flags`, `commits`, `auth`, `health`.

Conventions:
- Handlers call `runPython()`, parse its stdout as JSON, and return that. Live-data routes set `export const dynamic = "force-dynamic"` to bypass caching; several wrap the call in try/catch and return a fail-safe JSON shape instead of throwing.
- About 30 of the 81 accept `POST` (writes/actions); the rest are GET-only reads.
- `chat/stream` is the one streaming endpoint — it returns a `ReadableStream` (SSE); every other route returns plain JSON.
- `admin/*` routes are destructive resets (capital / P&L stats / XP / history) — POST-gated, Ghost-only. `commits` reads recent git history for the in-app deploy widget.
- High-traffic reads: `live` (full dashboard payload), `status` (service state + XP + signal counts), `nav-badges` (bottom-nav unread counts), `heartbeat` (Observatory pulse).
- Dynamic segments: `intel/journal/[source]/[id]`, `intel/similar/[source]/[id]`, `memory/brain/[name]`, `memory/daily/[date]`, `quality/[id]`, `intel/downloads/[filename]`.

---

## Component Map

`src/components/` — 13 zone directories + 14 top-level files. Each redesigned zone has a `*-zone-view` (or `*-view`) dispatcher that the zone page renders and that swaps sections on the `?tab=` param.

| Directory | Files | Key components |
|---|---|---|
| `ui/` | 20 | A4 + legacy primitives — `card`, `panel`, `pill`, `tab-bar`, `metric-tile`, `bottom-sheet`, `skeleton` |
| `navigation/` | 4 | `bottom-nav`, `sidebar-rail`, `zone-sub-tabs`, `chat-fab` |
| `dashboard/` | 7 | `dashboard-view`, `hero-pnl-card`, `active-positions-card`, `edge-analysis-card` |
| `autotrader-v2/` | 9 | `scalper-view`, `capital-hero`, `config-card`, `degen-section`, `autotrader-toggle-card` |
| `scalp/` | 10 | `scalp-zone-view`, `recent-signals-section`, `live-board-section`, `dca-section`, `stock-section` |
| `scout/` | 14 | `scout-tabs`, `discovery-feed-v3`, `filings-stream`, `insider-heatmap`, `swing-signals-panel` |
| `intel/` | 8 | `intel-zone-view`, `lessons-section`, `journal-section`, `similar-trades-section`, `shadow-section` |
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

- **`query_*.py` × 48** — READ-ONLY (`trevor.db` opened `mode=ro`). Notable: `query_brain.py`, `query_trades.py`, `query_training.py`, `query_feature_flags.py` (the last backs `/api/feature-flags`).
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
- Bottom nav: 6 zones — Dashboard, Auto, Manual, Intel, Memory, Chat.

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
| `HUB_REDESIGN_SCALP` | `true` | rebuilt MANUAL zone (`scalp/`) |
| `HUB_REDESIGN_INTEL` | `true` | rebuilt `/intel` sections |
| `HUB_REDESIGN_MEMORY` | `true` | rebuilt `/memory` sections |
| `HUB_REDESIGN_CHAT` | `false` | new chat surface |
| `SCOUT_V3_FEED` | `true` | SCOUT discovery feed v3 |

Seven wave flags are live; `MODE` (master) and `CHAT` remain off. Note: `feature-flags.ts:readFlag()` is a leftover stub that always returns `false` — `/api/feature-flags` is the real source.

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
