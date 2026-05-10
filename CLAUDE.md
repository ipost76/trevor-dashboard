# TREVOR Hub — Mission Control Dashboard

## Project Info
- **Path**: `/home/trevor/trevor-dashboard/`
- **Framework**: Next.js 15.3.3 (App Router), React 19, Tailwind CSS 4
- **Service**: `trevor-dashboard.service` (systemd), port 3333
- **Public URL**: http://34.28.231.36:3333
- **Auth**: Cookie-based session (`trevor_session`), 7-day validity, password in `.env`

## Hub v3.1 Overhaul — 2026-03-07

### Phase 0: Full codebase audit
### Phase 1: Performance fixes (data layer)
### Phase 2: Visual remodel (IBM Plex Mono + Orbitron, mobile bottom tab bar)
### Phase 3: Error boundaries, visibility-aware polling, training timeout fix
### Phase 4: Smoke tests, git commit, deploy

## Architecture

### Data Flow
- API routes (`src/app/api/*/route.ts`) call Python helper scripts via `child_process.execSync`
- Python helpers query `trevor.db` in read-only mode (`file:...?mode=ro`)
- No sqlite3 CLI on VM — all DB access through Python
- Chat uses direct Anthropic API (not Discord, not n8n)
- Chat sessions stored in `data/chat-sessions/*.json`

### Python Helpers (root level)
| File | Purpose |
|------|---------|
| `query_brain.py` | XP, rank, brain files, costs, ChromaDB stats |
| `query_trades.py` | Signals, active trades, history, watchlist, trade delete |
| `query_trevor_trades.py` | READ-ONLY query for TREVOR trade data (trade_outcomes + active_trades + ghost_trades) |
| `query_training.py` | Training summary stats (aggregated queries) |
| `query_research.py` | Signal analyses, vector search |
| `query_signal_quality.py` | Signal quality metrics from trade_outcomes |
| `chat_bridge.py` | Direct Anthropic API chat with brain context |
| `query_ghost.py` | CRUD backend for ghost_trades, ghost_strategies, ghost_notes |
| `manage_watchlist.py` | Watchlist CRUD (Hub-side metadata) |

### API Routes
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/status` | GET | Service status, XP, rank, signal counts |
| `/api/live` | GET | Full dashboard data (signals, watchlist, logs, costs) |
| `/api/signals` | GET | Paginated signal feed (?limit=&offset=) |
| `/api/trades` | GET | Active/history/watchlist (?scope=active\|history\|watchlist) |
| `/api/security` | GET | Security events, paginated |
| `/api/training` | GET | Training summary/records/chroma (?scope=) |
| `/api/brain` | GET | Brain files, XP, vectors, costs (?scope=) |
| `/api/chat` | GET/POST | Chat health/history/sessions (GET), send message (POST) |
| `/api/logs` | GET | Log file tail |
| `/api/research` | GET/POST | Analyses, vector search, quick analysis |
| `/api/auth` | GET/POST | Login/logout/change-password |
| `/api/watchlist` | GET/POST/DELETE | Watchlist management |

### Key Components
| Component | Purpose |
|-----------|---------|
| `app-shell.tsx` | Layout wrapper (sidebar + header + main + status bar) |
| `sidebar.tsx` | 5-zone nav: desktop collapsible sidebar + mobile 64px bottom bar + quick-jump |
| `header.tsx` | Top bar with status, XP badge, clock, auth buttons |
| `status-bar.tsx` | Footer with version, stats (hidden on mobile) |
| `dashboard-view.tsx` | Main dashboard grid (stats, signals, watchlist, logs) |
| `page-error.tsx` | Shared error boundary component |
| `use-polling.ts` | Visibility-aware polling hook (pauses on hidden tab) |

### Database Tables (trevor.db — READ ONLY)
| Table | Rows | Notes |
|-------|------|-------|
| trade_insights | 429 | Signal feed (NO `direction` column!) |
| trade_outcomes | 40 | Closed trades with P&L |
| watchlist | 24 | Tracked tickers |
| xp_ledger | 8 | XP transactions (use `SUM(amount)` for total) |
| security_events | 864 | Code scans, alerts |
| training_trades | 1,633,412 | Synthetic training data |
| training_observations | 149,659 | Market observations |
| training_sentiment | 100,870 | Sentiment data |
| cost_tracking | 139 | API costs by day |
| swarm_analyses | 0 | Research analyses (empty) |
| quality_patterns | 72 | Mined patterns (2026-04-11) w/ `source_paper`/`source_backfill`/`source_live` counts + `source_bias_flag` |

### Signal Quality Intelligence — Source Bias (2026-04-11)
`quality_patterns` stores every mined pattern alongside a source distribution. `SOURCE_BIAS_THRESHOLD = 0.80` lives in `trevor/quality_intelligence.py:80` — any source ≥80% of total tags the row `BACKFILL_HEAVY (N%)` / `PAPER_HEAVY (N%)` / `LIVE_HEAVY (N%)`. Current state: all 72 patterns are `BACKFILL_HEAVY (~93%)` because the training universe is 867 backfill / 60 live / 2 paper. Bias fades as live data accumulates; the Hub `QualityPanel` surfaces a prominent amber banner on the Hero Status Card whenever any source crosses the 80% threshold.

### Critical Gotchas
1. **`trade_insights` has NO `direction` column** — queries referencing it return 0 rows. Default to "LONG" in display.
2. **XP uses `SUM(amount)` from `xp_ledger`** — no `running_total` or `xp_after` column.
3. **Rank thresholds are hardcoded** in both `query_brain.py` and API routes (15 ranks from Intern Quant at 0 to CEO at 400,000 XP). AST parsing of `xp_system.py` is fragile — don't rely on it.
4. **Training timeout** — `query_training.py summary` can take 30-60s due to ChromaDB scan. Timeout set to 60s.
5. **gcloud SSH segfaults** — intermittent `Exit code 139` on SSH. Commands still complete; ignore the segfault.
6. **Credentials live in `.env.local`** (perms 600) — `DASHBOARD_USER=trevor`, `DASHBOARD_PASS=<rotating, see file>`. The `/api/auth` route reads this file directly at `process.cwd()` on every POST (no caching, no Hub restart needed after a rotation). `.env` contains only `DISCORD_BOT_TOKEN` (separate concern). QA agent's expected password lives in `/home/ghost/ghost_qa/.env.ghost` as `HUB_PASSWORD=…` — must match `.env.local` byte-for-byte.
7. **Auth requires `username` AND `password`** fields in login POST body.
8. **`npm run build` requires service restart** — Next.js production server caches the app-build manifest in memory at startup. Rebuilding while the service is running deletes the old fingerprinted CSS/JS files but leaves the running process serving HTML that still references them, returning 400/404 on every static asset and rendering pages as raw unstyled HTML. **Always run `sudo systemctl restart trevor-dashboard.service` after any rebuild.** Symptom: served HTML's `_next/static/css/<hash>.css` link does not match the file on disk in `.next/static/css/`. Diagnosed 2026-05-01.

### Fonts
- **Body/Data**: IBM Plex Mono (`--font-mono`)
- **Headings/Labels**: Orbitron (`--font-display`)
- Loaded from Google Fonts in `layout.tsx`

### Color Palette
- Background: `#0a0a0f` | Surface: `#12131a` | Border: `#1e2030`
- Green accent: `#00ff88` | Cyan: `#00d4ff` | Red: `#ff4757` | Amber: `#ffa502`
- Text: `#e8e8f0` primary, `#8888a0` muted

### Mobile (<768px)
- 5-zone bottom tab bar: Dashboard, Trading, Intel, Command, Chat (64px height)
- Green active state (#00ff88) with 2px top indicator bar
- Long-press on Trading/Intel/Command shows quick-jump popup with sub-items
- 48px minimum touch targets, `env(safe-area-inset-bottom)` padding
- StatusBar hidden
- Main content has `pb-20` for bottom bar clearance

### Testing
```bash
# Login and get cookie
curl -s -c cookies.txt -X POST http://localhost:3333/api/auth \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"trevor\",\"password\":\"$(grep ^DASHBOARD_PASS= /home/trevor/trevor-dashboard/.env.local | cut -d= -f2-)\"}"

# Test any API route
curl -s -b cookies.txt http://localhost:3333/api/status
curl -s -b cookies.txt http://localhost:3333/api/live
curl -s -b cookies.txt "http://localhost:3333/api/signals?limit=5"
```

### Rollback
```bash
cd /home/trevor/trevor-dashboard
git log --oneline
git reset --hard <previous-commit-hash>
npx next build
sudo systemctl restart trevor-dashboard
```

## Git History
- `365af64` — Hub v3.1: full diagnostic, performance overhaul, visual remodel (56 files)
- `bcc9497` — Phase 3: error boundaries, visibility-aware polling, training timeout (17 files)

## Hub v3.2 � Training + Watchlist Fix (2026-03-07)

### Training Page
- Removed Records tab (was loading 1.6M rows) and Vectors tab (duplicate)
- Single scrollable page: summary cards + 4 Recharts charts + strategy table
- Frontend field mapping: `totalRecords`, `winRate`, `topTickers`, `strategyBreakdown`, `outcomes`, `timeframes`, `dateRange`, `distinctTickers`
- API: existing `/api/training?scope=summary` (calls `query_training.py summary`)

### training_trades Column Mapping
| Column | Values |
|--------|--------|
| `outcome_result` | WIN, LOSS, SCRATCH |
| `signal_type` | OBV_CONFIRM_LONG, OBV_CONFIRM_SHORT, EMA_STACK_PULLBACK, etc (20+) |
| `direction` | LONG, SHORT |
| `regime_trend` | BEARISH, BULLISH, CHOPPY, bear_trend, bull_trend, crash, high_vol, low_vol, ranging, squeeze |
| `date` | timestamp field (1962 to 2034 range � synthetic data) |

### Watchlist Revamp
- Hub-side metadata: `data/watchlist-meta.json` (24 ticker entries with category + description)
- New route: `/api/watchlist/meta` � GET (merged DB+meta), PUT (edit description), POST (batch cleanup)
- Categories: crypto_perp, crypto_spot, equity, etf, speculative
- Grouped collapsible view, inline editing, inline delete confirmation
- watchlist table columns: `id`, `ticker`, `reason`, `priority`, `earnings_date`, `alert_threshold_pct`, `notes`, `last_checked`, `added_at`, `asset_type`, `mode`

### Git
- `0c1b8a7` � Hub v3.2: Training page rebuild + Watchlist revamp (3 files, 711 ins, 292 del)

## Hub Mobile Layout + Feature Fixes (2026-03-27)

### Mobile Layout Root Cause (commits aaf86e1, fe99f4c)
- globals.css: max-width 100vw -> 100%, overflow-x hidden -> overflow hidden + height 100%
- app-shell.tsx: Added 100dvh with vh fallback for dynamic viewport height
- sidebar.tsx: md: prefix on border-r and transition (defensive)
- signals/page.tsx: Column header responsive -- Tier/Regime/R:R hidden on mobile (was 528px)
- history-table.tsx: Filter row flex-wrap, delete modal w-full max-w-sm (was w-80)
- trade-form.tsx: Modal w-full max-w-md (was w-96)
- trades/page.tsx: min-w-0 on tab bar flex wrapper (5 tabs forced page to ~405px), overflow-x-hidden
- dashboard-view.tsx: All 7 stats in 4-col grid, compact panels (AutoTrader 100px, Chat 80px)

### Signals Page Redesign (commit a6df52b)
- Merged Feed+Quality tabs into single unified summary view, no individual signal list
- API: /api/signals?scope=summary returns pre-aggregated GROUP BY data + quality metrics
- Sections: summary cards, quality metrics, ticker breakdown, charts (direction trend, confidence dist, cumulative P&L)

### Training Page Redesign (commit a6df52b)
- Expanded from 4 stats to full informational view
- Added: educational section, regime/direction/timeframe breakdowns, top tickers, storage breakdown
- API: byDirection + byRegime queries added to query_training.py, timeout 60s->90s

### P&L Double-Leverage Fix (commit a7bc192)
- Bug: query_trades.py line 106 multiplied already-leveraged pnl_pct by leverage again
- DB stores correct values; only Hub API was doubling
- Fix: leveraged_pnl_pct = round(pnl_pct, 2) -- no extra multiplication

### Git (2026-03-27)
- aaf86e1 -- fix: mobile layout root cause
- fe99f4c -- fix: trades page horizontal shift + dashboard vertical scroll
- a6df52b -- feat: redesign Signals + Training pages
- a7bc192 -- fix: P&L double-leverage

## Signals Page Visual Upgrade (2026-03-28)
- Added P&L trade tracker section at top of Signals page (performance cards, exposure, capital)
- Removed <35 confidence calibration bucket (query_signal_quality.py + route.ts + page.tsx)
- Upgraded all chart colors to cyberpunk palette (green/pink direction bars, gradient confidence bars, green/red split P&L line)
- Chart components extended: StyledBarChart (colors, positiveColor, negativeColor props), StyledLineChart (splitColorAtZero prop)
- New theme exports: CONF_DIST_COLORS, CAL_BUCKET_COLORS

## Terminal Page (2026-03-28)
- Full browser bash shell: xterm.js frontend + node-pty WebSocket backend
- Custom server.js replaces `next start` — serves Next.js + WebSocket on port 3333
- WebSocket path: /ws/terminal (same port, no firewall changes needed)
- Auth: session cookie validated on WS upgrade (same trevor_session cookie)
- Theme: Termius-blue (scoped CSS vars, not Hub green) — #0d1117 bg, #58a6ff accent
- Font: JetBrains Mono, 14px desktop, 13px mobile
- Desktop: tab bar (36px) + full-bleed terminal + status bar (24px) + search addon
- Mobile: tab bar (32px) + terminal + key toolbar (44px) + status bar (20px)
- Key toolbar: Tab, Ctrl (sticky toggle), Alt (sticky toggle), Esc, arrows, |, /, ~, -, _
- Keyboard: native xterm + visualViewport resize
- Nav: first in sidebar (desktop), first in mobile tab bar (Dashboard to More menu)
- Limits: 3 sessions, 4hr idle, 5000 scrollback
- node-pty: native module, needs build-essential, in serverExternalPackages
- SSR: disabled via dynamic import (xterm needs window)
- SystemD ExecStart: /usr/bin/node /home/trevor/trevor-dashboard/server.js

## Ghost Command Center Overhaul (2026-03-30)

### Page: `/ghost` (was 6 tabs, now 4)
- **Removed**: Training tab, Tasks tab, ghost_training table, ghost_tasks table, `/api/ghost/training`, `/api/ghost/tasks`
- **Page file**: `src/app/ghost/page.tsx` — slim tab router (~45 lines), imports component files
- **Components**: `src/components/ghost/` — vault-tab.tsx, trades-tab.tsx, strategies-tab.tsx, notes-tab.tsx, shared.tsx

### Vault Tab
- `/api/ghost` now returns parsed heartbeat + memory sections (not just raw text)
- Heartbeat parsed: last_active, signals_today, trades_closed, api_budget, alive_status (alive/warn/dead)
- Memory split into collapsible sections by `## ` headings
- Daily timeline: horizontal scrollable date pills (reads from brain/memory/*.md, 18 files)
- Sync status: compact single-line bar with green/red indicator

### Trades Tab
- **NEW API**: `/api/ghost/trevor-trades` — READ-ONLY query of active_trades + trade_outcomes + ghost_trades
- **Python helper**: `query_trevor_trades.py` — computes stats, hold duration, win/loss, best/worst
- Active positions section (from active_trades WHERE status='open')
- Trade history with ALL/WINS/LOSSES filter tabs (from active_trades WHERE status='closed')
- Manual journal section (collapsible, preserves ghost_trades CRUD)
- Stats bar: total, W/L, WR%, avg P&L, total P&L, best/worst

### Strategies Tab
- **11 new columns** added to ghost_strategies: assets, direction, timeframe, entry_conditions, exit_rules, risk_per_trade, min_confidence, win_count, loss_count, total_pnl, last_triggered_at
- Status filter tabs: ALL/ACTIVE/TESTING/RETIRED/IDEAS
- Cards: collapsed (title + badges) / expanded (full detail + edit/archive/delete)
- Create/Edit modal with all structured fields
- **NEW API**: `/api/ghost/strategies/match?ticker=SOL&direction=LONG&confidence=62` — returns active strategies matching criteria (future TREVOR integration hook)

### Notes Tab
- Extracted to component file, unchanged functionality
- Search, pin, CRUD all preserved

### Ghost DB Tables (current state)
| Table | Rows | Status |
|-------|------|--------|
| ghost_trades | 1 | Active (manual journal) |
| ghost_strategies | 2 | Active (11 new columns) |
| ghost_notes | 2 | Active |
| ghost_training | — | DROPPED |
| ghost_tasks | — | DROPPED |

## Navigation Restructure — Prompt 1 of 3 (2026-04-02)

### Phase 1: Terminal Removed
- Deleted `/terminal` page (was Chat UI), moved to `/chat`
- Deleted `TerminalView.tsx` (xterm.js component, unused)
- Removed WebSocket handler from `server.js` (was at `/ws/terminal`)
- Uninstalled: @xterm/xterm, @xterm/addon-fit, @xterm/addon-search, @xterm/addon-web-links, node-pty, ws
- Removed `serverExternalPackages: ['node-pty']` from next.config.ts
- Updated `app-shell.tsx`: `isTerminal` → `isChat` for /chat path

### Phase 2-4: 5-Zone Navigation
- **sidebar.tsx** fully rewritten with NAV_ZONES data structure
- **Desktop**: 5 collapsible zone groups (Dashboard, Trading, Intelligence, Command, Chat). Zone headers navigate, chevrons toggle children. Auto-expands active zone. Sub-items use `?tab=` query params.
- **Mobile**: 64px bottom nav with 5 icon+label pairs. Green active state (#00ff88). Long-press popup on zones with children (400ms, haptic feedback).
- quickJumpIn animation added to globals.css
- Bottom padding: pb-14 → pb-20 (80px clearance for 64px nav)

## Tab Architecture — Prompt 2 of 3 (2026-04-02)

### TabContainer Component
- `src/components/TabContainer.tsx` — shared reusable tab container
- URL-synced via `?tab=<id>` (useSearchParams + router.replace)
- Wrapped in Suspense for useSearchParams
- Active tab: green bottom border + text (#00ff88). Inactive: #3d6b4a
- Sticky tab strip with horizontal scroll, hidden scrollbar
- Only active tab panel rendered (inactive unmounted)
- Optional `pageTitle` prop above tab strip

### Trading (/trading) — 3 tabs
- `trades` → TradesPanel (from /trades, 1320 lines, has 6 internal tabs: Live Board, Active, Scalp, LT, History, Journal)
- `holdings` → HoldingsPanel (from /holdings, 531 lines, has 6 filter tabs)
- `autotrader` → AutoTraderPanel (from /autotrader, 454 lines, single scrollable)
- Sidebar updated: Trading children 4→3 (merged Active Trades + History since both in Trades page)

### Intelligence (/intelligence) — 3 tabs
- `signals` → SignalsPanel (from /signals, 608 lines, unified view)
- `research` → ResearchPanel (from /research, 247 lines, has 4 internal tabs)
- `training` → TrainingPanel (from /training, 487 lines, single scrollable)

### Command (/command) — 4 tabs
- `control` → ControlPanelPanel (from /control, 304 lines, has 7 internal tabs)
- `ghosthq` → GhostHQPanel (from /ghost, 47 lines, has 4 internal tabs)
- `reminders` → RemindersPanel (from /reminders, 318 lines, has 4 filter tabs)
- `devtasks` → DevTasksPanel (from /dev-tasks, 245 lines)

### Old Route Redirects (next.config.ts)
- /trades → /trading?tab=trades (308)
- /holdings → /trading?tab=holdings (308)
- /autotrader → /trading?tab=autotrader (308)
- /signals → /intelligence?tab=signals (308)
- /research → /intelligence?tab=research (308)
- /training → /intelligence?tab=training (308)
- /control → /command?tab=control (308)
- /ghost → /command?tab=ghosthq (308)
- /reminders → /command?tab=reminders (308)
- /dev-tasks → /command?tab=devtasks (308)
- Old page files also have file-level redirects as backup

### Type Export Fix
- `Position` type moved from `/holdings/page` → `/trading/panels/HoldingsPanel`
- Updated imports in: allocation-chart.tsx, close-dialog.tsx, leverage-widget.tsx, position-form.tsx

## Navigation Restructure — Prompt 3 of 3 (2026-04-03) — FINAL

### Dashboard Reminders Widget
- `src/components/RemindersWidget.tsx` — compact card showing next 3 upcoming reminders
- Fetches `GET /api/reminders` (pending+active), auto-refresh every 60s
- Time urgency: OVERDUE (red), < 1hr (amber), normal (muted)
- "View All →" links to `/command?tab=reminders`
- Added to dashboard-view.tsx after Signals & Quality section

### Dead Code Cleanup
- Dashboard links updated: `/trades` → `/trading?tab=trades`, `/signals` → `/intelligence?tab=signals`
- All 10 old page dirs contain redirect files (intentional backwards compatibility)
- Terminal code fully removed (confirmed clean)

### Responsive Polish
- TabContainer tab buttons: smaller padding on narrow screens (`px-3.5 sm:px-5`, `text-[11px] sm:text-[12px]`)

## Navigation Restructure — Complete Summary

### What Changed (3 prompts, 2026-04-02 to 2026-04-03)
- 13 separate pages consolidated into 5 zones
- Terminal page removed entirely (xterm.js, node-pty, ws uninstalled)
- Mobile: 5-icon bottom nav (64px) + quick-jump long-press gesture (no More menu)
- Desktop: 5 collapsible sidebar groups with sub-items
- 3 mega-pages (Trading, Intelligence, Command) use TabContainer with URL-synced ?tab= params
- Dashboard has Reminders widget
- All old routes redirect (308 permanent)

### New Routes
| Route | Content |
|-------|---------|
| `/dashboard` | Dashboard with live stats + reminders widget |
| `/trading` | Tabs: Trades (6 internal), Holdings (6 internal), AutoTrader |
| `/intelligence` | Tabs: Signals, Research (4 internal), Training |
| `/command` | Tabs: Control Panel (7 internal), Ghost HQ (4 internal), Reminders, Dev Tasks |
| `/chat` | Chat with TREVOR AI |

### Components Added
| Component | Purpose |
|-----------|---------|
| `TabContainer.tsx` | Reusable URL-synced tab strip + panel renderer |
| `RemindersWidget.tsx` | Dashboard widget for upcoming reminders |
| `sidebar.tsx` (rewritten) | 5-zone collapsible nav + mobile bottom bar + quick-jump |

### Old Routes (all redirect 308)
/trades → /trading?tab=trades, /holdings → /trading?tab=holdings, /autotrader → /trading?tab=autotrader, /signals → /intelligence?tab=signals, /research → /intelligence?tab=research, /training → /intelligence?tab=training, /control → /command?tab=control, /ghost → /command?tab=ghosthq, /reminders → /command?tab=reminders, /dev-tasks → /command?tab=devtasks

## Bug Fixes — 2026-04-03

### Hold Time / Regime Duplication Fix
- `TradeAnalytics` (Hold Time Analysis + Regime Performance) was rendered outside the tab content wrapper in TradesPanel, making it visible under all 6 sub-tabs
- Moved into `tab === "history"` conditional — now only appears on History sub-tab
- File: `src/app/trading/panels/TradesPanel.tsx`

### Unicode Escapes Fix (Ghost HQ Trades)
- `\u26a1`, `\u26a0\ufe0f`, `\u2192` in JSX text content rendered as literal strings (JSX doesn't process unicode escapes in text nodes)
- Replaced with actual unicode characters: ⚡, ⚠️, →
- File: `src/components/ghost/trades-tab.tsx` (lines 109, 116, 159)

### Holdings Live Prices Fix
- Holdings table showed "--" for Current Price and P&L% on open positions — no price fetching existed
- Added `livePrices` state with `useEffect` fetching `/api/prices?tickers=...` every 30s (same pattern as TradesPanel)
- P&L% calculated from live price, entry price, direction, and leverage
- File: `src/app/trading/panels/HoldingsPanel.tsx`

### Vector Memory Count Fix
- Memory tab showed 0 for trade_patterns and knowledge_base — was trying dead sidecar at port 5100
- Replaced sidecar fetch with `query_brain.py vectors` call (same proven path as ChromaDB browser tab)
- 5-min cache preserved. Counts now match ChromaDB browser exactly
- File: `src/app/api/memory/route.ts`

### Dev Tasks Rendering Fix
- Only DB entry (id=1) was a raw Discord cheat sheet with channel IDs like `<#1485100214934175966>`
- Filtered cheat sheet entries (containing `<#`) from task list display
- Added collapsible "How to Add Tasks" reference section with formatted commands
- Updated empty state message
- File: `src/app/command/panels/DevTasksPanel.tsx`

### Sub-Tab Scroll Indicators
- Tab strips had no visual cue that more tabs exist off-screen on mobile
- Added gradient fade indicators to shared TabBar component with scroll position detection (useRef + ResizeObserver)
- Right fade shows when tabs overflow right, left fade when scrolled right
- Auto-applies to all 4 panels using TabBar (ControlPanel, Trades, Holdings, Research)
- GhostHQPanel custom tab bar also updated with same scroll indicators
- Files: `src/components/ui/tab-bar.tsx`, `src/app/command/panels/GhostHQPanel.tsx`

### Sticky Tab Strips
- TabBar wrapper now has `sticky top-0 z-[19]` with solid background — tabs stay visible during scroll
- GhostHQPanel custom tab bar also made sticky
- TabContainer zone tabs already had sticky (verified)
- Files: `src/components/ui/tab-bar.tsx`, `src/app/command/panels/GhostHQPanel.tsx`

### Dashboard LIVE Deduplication
- Removed duplicate sticky LIVE bar from dashboard (pulse dot + "LIVE" + clock + XP)
- Header already shows LIVE/OFFLINE + time + XP — second bar was redundant
- System status strip (Scanner OK, API ms, signals, STOP) kept and made sticky
- Saves ~48px of viewport space
- File: `src/components/dashboard-view.tsx`

### Responsive Holdings Position Cards
- Mobile (<768px): positions render as stacked cards with ticker, direction badge, leverage, entry/current prices, P&L%, type, action buttons
- Desktop: table layout unchanged (hidden on mobile via `hidden md:flex`)
- Action buttons have 44px+ min-height touch targets on mobile
- File: `src/app/trading/panels/HoldingsPanel.tsx`

### Collapsible Signals Sections
- 10 sections wrapped in CollapsibleSection accordion component
- Default open: Trade Performance, Signal Quality by Confidence
- Default closed: Quality Metrics, Expectancy, Circuit Breakers, Ticker Breakdown, P&L By Ticker, Direction Trend, Confidence Distribution, Cumulative P&L
- Summary Stats grid always visible (no collapse)
- Each section header shows summary text and clickable chevron
- File: `src/app/intelligence/panels/SignalsPanel.tsx`

### Journal Win/Loss Visual Differentiation
- Journal entry cards now have color-coded left borders: green (profit), red (loss), muted (neutral)
- P&L parsed from content via regex matching `P&L: +X%` patterns
- Badge next to date: "▲ profit" / "▼ loss"
- File: `src/components/trades/journal-tab.tsx`

### Research Empty States Enhanced
- Analyses empty state: added guidance to use Quick Analysis tab or `!research` command
- Knowledge empty state: updated text for `!kb add <url>` command
- File: `src/app/intelligence/panels/ResearchPanel.tsx`

### Active Trade Elapsed Timer
- Shows `⏱ Xh Ym` on each active trade card with 60s auto-refresh
- Color-coded: green (within hold time), amber + "EXTENDED" (1-2x), red + "OVERDUE" (>2x)
- Uses `max_hold_minutes` from DB (defaults to 120 if unavailable)
- File: `src/app/trading/panels/TradesPanel.tsx`

### Dashboard Quick CLOSE Button
- Close button on each Dashboard active trade card (red outline `✕`)
- Two-tap confirmation: first tap shows "Confirm?", auto-dismisses in 3s, second tap executes
- Uses live price as exit price, calls same `POST /api/trades/close` endpoint
- Prevents Link navigation via `e.preventDefault()` + `e.stopPropagation()`
- File: `src/components/dashboard-view.tsx`

### Confidence Band Indicator
- Shows historical WR% context line below confidence on active trade cards
- Hardcoded bands from trade_insights data: <45 (40% WR), 45-54 (61.9%), 55-64 (40%), 65+ (50%)
- Color-coded: green ≥50% WR, amber 40-49%, red <40%
- Displays on BOTH Dashboard active trades and Trading → Active trade cards
- Files: `src/app/trading/panels/TradesPanel.tsx`, `src/components/dashboard-view.tsx`

### Signal Filter Status Indicator
- New API route: `/api/nav-badges` — returns active trades, recent signals, overdue reminders, and filter rules (30s cache)
- Dashboard: "🛡 4" filter badge in system status strip, expandable to show all filter rules with descriptions
- Signals page: filter count badge in header next to title
- Files: `src/app/api/nav-badges/route.ts` (new), `src/components/dashboard-view.tsx`, `src/app/intelligence/panels/SignalsPanel.tsx`

### Navigation Notification Dots
- Replaced broken `signalBadge` (was polling non-existent `/api/signals/unread-count`) with `navBadges` from `/api/nav-badges`
- Green dot on Trading when active trades exist
- Cyan dot on Intelligence when signal fired in last 30 min
- Red dot on Command when reminder is overdue
- 7px colored dots on both desktop sidebar and mobile bottom nav, polling every 60s
- File: `src/components/sidebar.tsx`

### Live Board Historical Win Rate
- New API route: `/api/trade-stats` — returns win/loss by ticker+direction from trade_outcomes + blocked combos from signal_filter_rules (60s cache)
- Each Live Board card shows "📊 BTC LONG: 3W/1L (75.0% WR)" with color coding (green ≥55%, amber 40-54%, red <40%)
- Falls back to insight_line or "No trade history" for combos with no data
- Blocked combos (ETH LONG, FARTCOIN LONG) show "🚫 BLOCKED" instead of ENTER button
- Files: `src/app/api/trade-stats/route.ts` (new), `src/components/trades/live-board.tsx`

### Context-Aware Chat Quick Actions
- Chat page quick action buttons now dynamic based on system state
- With active trade: "Check BTC position" button. On losing streak: "Review my losing streak"
- Falls back to "How am I doing?" + "Market overview" when no context-specific actions
- Uses `/api/nav-badges` for context (streak, activeTradeDetails)
- File: `src/app/chat/page.tsx`

### Reminders Quick-Add
- "+" button in Dashboard reminders widget header, inline form with text input + time presets (1h, 3h, Tomorrow)
- Uses existing `POST /api/reminders` endpoint. Auto-refreshes widget after creation
- Prevents Link navigation via `e.preventDefault()` + `e.stopPropagation()`
- File: `src/components/RemindersWidget.tsx`

### Streak Awareness on Dashboard
- Streak indicator in P&L hero section between W/L bar and stats grid
- Streak >= 3: green "🔥 X streak". Streak <= -3: red "❄️ -X streak"
- Otherwise: shows last trade result ("Last: +6.61% (W)")
- Data from extended `/api/nav-badges` (streak, lastPnl fields added)
- File: `src/components/dashboard-view.tsx`

### Data Freshness Indicators
- Dashboard status strip: "● Xs ago" / "⚠ Xm ago" next to signals count
- Live Board: stale warning "⚠ stale" when last scan > 3 min old
- Active trade cards: freshness dot next to current price showing price age
- FreshnessDot component: 5s interval update, red warning when > 2 min stale
- Files: `src/components/dashboard-view.tsx`, `src/components/trades/live-board.tsx`, `src/app/trading/panels/TradesPanel.tsx`

### Regime Data Backfill
- Backfill script at `/home/trevor/trevor/scripts/backfill_regime.py` — matches trade_outcomes to trade_insights by ticker + timestamp
- 7/54 trades backfilled (older trades predate regime tracking). TRENDING: 6 trades, 66.7% WR. VOLATILE: 1 trade.
- `/api/analytics/regime-performance` route rewritten to query trade_outcomes.regime_at_entry (was querying active_trades, now correct)
- New trades auto-populate regime_at_entry via trade entry flow
- Files: `scripts/backfill_regime.py` (new), `src/app/api/analytics/regime-performance/route.ts`

### Schedule Last Run Indicators
- Each schedule card now shows "Last: ✓ Thu 09:25" or "Last: ✗ error" from journalctl
- Parses last 500 lines of trevor.service logs from past 7 days, matches by handler keyword
- Green for success, red for error/fail/traceback matches
- Files: `src/app/api/schedule/route.ts`, `src/components/control/schedule-manager.tsx`

### AutoTrader Stop Loss Critical Alert
- Red-bordered alert card at TOP of AutoTrader page when stop_loss exits have 0% WR and >= 5 trades
- Shows WR%, trade count, total losses, and recommendation text
- Current data: 15 stop-loss exits, 0% WR, -$303.77 (58% of total trades)
- File: `src/app/trading/panels/AutoTraderPanel.tsx`

### Expectancy Improvement Projection
- Green-bordered projection card below Expectancy calculation in Signals page
- Shows: "IF FILTERED TO 45-54 CONFIDENCE: Projected WR 61.9%, Trades: 21 of 65"
- Highlights that filtering to optimal confidence band would likely turn negative edge positive
- File: `src/app/intelligence/panels/SignalsPanel.tsx`

### Persistent Live Price Strip
- `PriceStrip` component shows BTC, ETH, SOL, HYPE, FARTCOIN prices in 24px strip below header
- Fetches from existing `/api/prices` route every 30s (reuses Hyperliquid+CoinGecko, no extra API calls)
- Inserted in app-shell.tsx between Header and main content (flex layout, no padding adjustment needed)
- Files: `src/components/PriceStrip.tsx` (new), `src/components/app-shell.tsx`

### Trade Entry Confirmation Modal
- Live Board ENTER button now opens pre-flight confirmation modal instead of entering directly
- New API: `/api/entry-preflight?ticker=X&direction=Y` returns exposure (capital, margin, % used), track record (W/L/WR), block status
- Modal shows: ticker+direction+price, confidence band + historical WR, exposure level with warnings, track record, filter block status
- CONFIRM triggers existing `handleEnter` flow (POST /api/live-board/enter). CANCEL dismisses. Blocked entries disabled.
- Files: `src/app/api/entry-preflight/route.ts` (new), `src/components/trades/live-board.tsx`

### Training Key Insights Card
- Computed insights card at top of Training page: direction split (SHORT vs LONG WR), top ticker, regime survival, exit patterns count, total records
- Values computed from existing Training API data (not hardcoded)
- File: `src/app/intelligence/panels/TrainingPanel.tsx`

### Collapsed Storage Breakdown
- Storage Breakdown section collapsed by default showing one-line summary: "📦 STORAGE: 1.9M SQLite rows · 294K vectors"
- Click to expand full table/collection listing + VM Health
- Saves ~2 screens of scroll
- File: `src/app/intelligence/panels/TrainingPanel.tsx`

### Time-of-Day Overlay on Active Trades
- New API: `/api/time-slots` — win rates by 4-hour bucket + day-of-week from trade_outcomes (60s cache)
- Active trade card shows "📊 2/4 (50% WR) in 16-19 Thu ✓" below elapsed timer
- Color coded: green ≥50%, amber 30-49%, red <30%
- 24 time slots covering all hour+day combinations with trade history
- Files: `src/app/api/time-slots/route.ts` (new), `src/app/trading/panels/TradesPanel.tsx`

## Upgrade Sprint QA — 2026-04-03 (Prompt 10/10)

### Test Results: ALL PASS
- 33 features verified across 9 upgrade prompts
- 0 regressions, 0 missing features
- All primary routes: 200 (/ redirects 307 to /dashboard)
- All tab params: 200 (10/10)
- All API routes: 200 (7/7 including new routes)
- All old route redirects: 200 after redirect (8/8)
- Z-index stack: clean (10→19→20→50→60)
- Intervals: 24 setInterval with 26 clearInterval (no leaks)
- Mobile bottom padding: 80px (pb-20) + 90px dashboard (sufficient)
- Build: passes, 0 type errors
- trevor.service: untouched (11:11 AM ET timestamp preserved)

### New API Routes Added During Sprint
| Route | Purpose | Cache |
|-------|---------|-------|
| `/api/nav-badges` | Active trades, signals, reminders, filters, streak | 30s |
| `/api/trade-stats` | Win/loss by ticker+direction, blocked combos | 60s |
| `/api/entry-preflight` | Exposure, track record, filter blocks for entry modal | none |
| `/api/time-slots` | Win rates by 4h bucket + day-of-week | 60s |

## Auto Trader Page Overhaul — Part 1 (2026-04-23)

Real-time Auto Trader page with SSE-driven open positions + editable config.
Rewrites `AutoTraderPanel.tsx` from a 30s-polling table into a scrollable
page with full exit engine visibility. Part 2 will add equity chart + closed
trade history (current P2 placeholder renders in-page).

### New files
| Path | Purpose |
|------|---------|
| `src/app/api/auto-trader/stream/route.ts` | SSE endpoint, 30s tick, emits `positions` + `summary` events. Uses a 5s module-level cache to coalesce multi-tab ticks. |
| `src/app/api/auto-trader/config/route.ts` | `GET` reads auto_config; `PUT` writes a single whitelisted key. |
| `query_auto_trader_live.py` | READ-ONLY extended snapshot (all exit engine columns, 7d stats, trades_today, full config). |
| `query_auto_trader_config.py` | Whitelisted writer for `auto_config` ONLY. Enforces `ALLOWED_WRITE_KEYS` + type coercion (bool/int/float). |
| `src/hooks/useAutoTraderStream.ts` | SSE hook, exposes `{ positions, summary, state, lastUpdate }`. |
| `src/components/autotrader/HeaderBar.tsx` | Hero bar: enabled pill, equity hero, 7D stats, connection indicator. |
| `src/components/autotrader/PositionCard.tsx` | Per-position card: primary row (ticker/dir/entry→current/P&L/leverage/hold) + exit engine row (Trail/BE/Peak/Partials/R/Conf/regime). |
| `src/components/autotrader/ConfigPanel.tsx` | Inline-editable auto_config grid with optimistic save (saving…/✓ SAVED/failed). View-only per-ticker leverage. |

### Modified
- `src/app/trading/panels/AutoTraderPanel.tsx` — single scroll: Header → Open Positions (cards) → Config Panel → Part 2 placeholder. Recent closed trades removed (moves to P2).

### Architecture
- SSE stream pushes every 30s; shared 5s cache keeps Python spawns to one per tick across all subscribed clients.
- Live P&L computed Node-side using executor's formula (LONG: `(curr-entry)/entry*100*lev`, SHORT: `(entry-curr)/entry*100*lev`). `live_pnl_usd = notional * live_pnl_pct / 100`.
- R-multiple = `live_pnl_pct / (|entry-stop|/entry*100*leverage)`.
- Hyperliquid `allMids` fetched directly in SSE tick; `price_stale: true` falls through to "stale" badge when HL is unreachable.
- Auth: middleware cookie. New routes inherit `/api/*` protection (401 without cookie) for free.
- `trevor.db` remains READ-ONLY from Hub except for `auto_config` (whitelist: AUTO_TRADER_ENABLED, MAX_CONCURRENT, MAX_TRADES_PER_DAY, MAX_CONSECUTIVE_LOSSES, PAUSE_AFTER_LOSSES_MINUTES, AGGRESSIVE_THRESHOLD, TICKER_DISCOVERY, CAPITAL_USD, PER_TRADE_USD, LEVERAGE_DEFAULT). Whitelist enforced in both Node body validator AND Python writer.
- Legacy `/api/auto-trader` + `query_auto_trader.py` left in place, no callers; deprecate in P2.
- Per-ticker leverage map is a Python constant in `auto_trader/executor.py` — shown view-only in Config Panel.

### Verification
- Build: clean, 0 type errors. `/trading` bundle +3.1kB.
- SSE first event ~100ms after connect. Both open positions enrich with Hyperliquid prices + computed hold_display + R-multiple.
- Config PUT rejected non-whitelisted key `DISCOVERED_TICKERS` with 400. Valid whitelisted key saved canonically.
- Sacred files unchanged (5 .py in /home/trevor/trevor/, 4 .md in /home/trevor/trevor/brain/).
- Auto-close canary clean (no `auto.close`/`force_close`/`AUTO_CLOSE` introductions in Hub src).
- Mobile: HeaderBar wraps enabled pill + equity stacked on narrow. PositionCard exit-engine row wraps. ConfigPanel collapses to 1-col at <640px.

### Next (Part 2)
- Equity curve chart (Recharts already in deps).
- Expandable closed trades table (replaces legacy `recent_trades`).
- WR by ticker, by exit reason.
- Deprecate legacy `/api/auto-trader` + `query_auto_trader.py` once P2 lands.

## Auto Trader Page Overhaul — Part 2 (2026-04-23)

Adds analytics charts + expandable trade history below the P1 config panel.
The Auto Trader page is now a complete single-scroll dashboard:
**Header → Open Positions (SSE) → Config → Analytics → History**.

### New API routes
| Route | Purpose | Cache |
|-------|---------|-------|
| `/api/auto-trader/equity-curve` | Chronological equity snapshots (running P&L from starting capital) | 30s |
| `/api/auto-trader/analytics` | by_ticker + by_exit_reason (zero-seeded canonical list) + overall summary | 30s |
| `/api/auto-trader/history` | Paginated closed trades. Query params: `page`, `limit` (≤100), `filter` (all\|winners\|losers), `period` (all\|7d\|30d). Full detail columns per row. | none |

One consolidated Python helper `query_auto_trader_history.py` with three scopes: `equity-curve`, `analytics`, `history [page] [limit] [filter] [period]`. READ-ONLY (`file:...?mode=ro`). Canonical exit-reason palette seeded at count=0 so the chart always shows the full executor surface: `timeout_240min` (amber), `stop_hit` (red), `trailing_stop` (blue), `tech_signals` (cyan), `partial_profit` (green). DB reasons not in the canonical list merge in with a sign-based color.

### New components
| Path | Purpose |
|------|---------|
| `src/components/autotrader/EquityCurveChart.tsx` | Recharts `ComposedChart` — line + area-fill with gradient that crosses at starting_capital (not 0). Ref line at starting capital. Custom tooltip: Trade #N · TICKER DIR · Equity · Cum · Δ. |
| `src/components/autotrader/WinRateByTickerChart.tsx` | Vertical bars, per-ticker WR%. Color tiers (green ≥55, amber 45-54, red <45). `LabelList` shows trade count above each bar. 50% ref line. |
| `src/components/autotrader/PnlByExitReasonChart.tsx` | Horizontal bars, total P&L per reason. Green ≥0, red <0. Labels "reason (count)" on Y, dollar values on bar-end. |
| `src/components/autotrader/AnalyticsSection.tsx` | Fetches both endpoints (60s refresh), renders overall stat strip + 3 charts (equity full width, WR & exit-reason 2-col on lg). Shimmer skeletons while loading. |
| `src/components/autotrader/TradeHistoryTable.tsx` | Filter pills (All/Winners/Losers × 7D/30D/All), paginated list (20/page + Load More), click-to-expand rows. Exit-reason color pills match analytics palette. Expanded detail grid: entry→exit, leverage, size, confidence (+adj), regime, market_state, peak P&L, breakeven, partials count+realized, fees, net P&L, opened/closed. |

### Modified
- `src/app/trading/panels/AutoTraderPanel.tsx` — P2 placeholder replaced with `<AnalyticsSection />` + `<TradeHistoryTable />`. Five-section scroll: Header → Positions → Config → Analytics → History.

### Verification
- Build: clean, 0 type errors. `/trading` bundle 41.5 → 48.1 kB (+6.6kB for charts + history).
- All 3 endpoints returned expected shapes. `history?filter=winners&period=7d` correctly narrows results.
- Pagination validated: 26 trades → 6 pages at limit=5, `has_more` flips correctly.
- Analytics: 5 tickers + 5 reasons (with canonical zero-fill) + overall summary including profit_factor.
- Sacred files unchanged (5 .py + 4 .md in brain/).
- Auto-close canary clean.
- Chart primitives reuse `CHART_COLORS` theme (no new palette drift).
- No new npm deps (Recharts 2.15.4 was already installed).

## Auto Trader Premium Live Dashboard (2026-04-26)

Premium overhaul of `/trading?tab=autotrader` for the paper→live transition.
Page is mode-aware end-to-end (HeaderBar, PositionCards, charts, history,
config). Single-scroll: Header → Open Positions → Config → Analytics → History.

### New behavior
- **Mode badge** in HeaderBar — "🟢 LIVE" or "📄 PAPER", driven by
  `AUTO_LIVE_ENABLED` config key. Sticky on scroll (z-21 above tab strip).
- **Kill switch** (new `KillSwitch.tsx`) — 2-tap with 3s confirmation
  window. POSTs `/api/kill-switch` activate/deactivate (flag file
  `/home/trevor/trevor/.kill_switch`). Shows DEACTIVATE state when active.
- **4 hero stat cards** — Equity, Total P&L, Today P&L, Open positions
  (count/max + $ exposure). 2×2 mobile, 4×1 desktop.
- **Warning chips** — SDK errors (live + count > 0), N-loss streak (≥2),
  near hard cap (live equity ≥ 90% of `LIVE_HARD_CAPITAL_CAP_USD`).
- **PositionCard** — LIVE/PAPER micro-badge + stop→target progress bar
  (current price floats as glowing dot; entry tick at midpoint).
- **EquityCurveChart** — two `<Line>` series; `live_equity` and `paper_equity`
  tracked at every step. Live/Paper/Both pill above chart. Empty-live placeholder.
- **WR by ticker / P&L by exit reason** — re-fetch on mode change
  (`?mode=live|paper|all`).
- **TradeHistoryTable** — mode pill (Live/Paper/All) + per-row LIVE/PAPER
  badge. Defaults to current bot mode.
- **ConfigPanel** — split into PAPER and LIVE collapsible sections.
  LIVE section editable: `AUTO_LIVE_ENABLED`, `LIVE_PER_TRADE_USD`,
  `LIVE_MAX_CONCURRENT`, `LIVE_MAX_DAILY_TRADES`, `LIVE_LEVERAGE_DEFAULT`,
  `LIVE_CAPITAL_USD`, `LIVE_SLIPPAGE_PCT`, `LIVE_DEAD_MAN_SWITCH_MS`,
  `LIVE_SDK_ERROR_THRESHOLD`. View-only: `LIVE_HARD_CAPITAL_CAP_USD`
  ($50 code-enforced), SDK error count, dead-man switch (seconds), order type.

### SSE summary fields added
`mode`, `equity_source` ("hyperliquid" | "simulated"), `today_pnl`,
`today_count`, `open_notional`, `last_trade_at`, `consecutive_losses`,
`sdk_errors`, `live_hard_cap`. SSE tick lowered 30s → 15s.

### API routes
| Route | Change |
|------|--------|
| `/api/auto-trader/stream` | New summary fields; 15s tick |
| `/api/auto-trader/equity-curve` | Each point carries `trade_mode` + `live_equity` + `paper_equity` running totals |
| `/api/auto-trader/analytics` | Accepts `?mode=all\|live\|paper` |
| `/api/auto-trader/history` | Accepts `?mode=all\|live\|paper`; rows include `trade_mode` |
| `/api/auto-trader/config` | Whitelist extended with 9 LIVE_* keys (plus AUTO_LIVE_ENABLED). `LIVE_HARD_CAPITAL_CAP_USD` and `LIVE_ORDER_TYPE` remain view-only. |

### Whitelist (final, 17 keys)
Paper/generic: AUTO_TRADER_ENABLED, MAX_CONCURRENT, MAX_TRADES_PER_DAY,
AGGRESSIVE_THRESHOLD, TICKER_DISCOVERY, CAPITAL_USD, PER_TRADE_USD,
LEVERAGE_DEFAULT.
Live (real money): AUTO_LIVE_ENABLED, LIVE_CAPITAL_USD, LIVE_PER_TRADE_USD,
LIVE_MAX_CONCURRENT, LIVE_MAX_DAILY_TRADES, LIVE_LEVERAGE_DEFAULT,
LIVE_DEAD_MAN_SWITCH_MS, LIVE_SDK_ERROR_THRESHOLD, LIVE_SLIPPAGE_PCT.
Mirrored exactly in `query_auto_trader_config.py` ALLOWED_WRITE_KEYS.

### Files
- New: `src/components/autotrader/KillSwitch.tsx`
- Rewritten: `EquityCurveChart.tsx`, `HeaderBar.tsx`, `ConfigPanel.tsx`,
  `AnalyticsSection.tsx`
- Edited: `PositionCard.tsx`, `TradeHistoryTable.tsx`,
  `useAutoTraderStream.ts`, all 5 `auto-trader/*` API routes,
  `query_auto_trader_live.py`, `query_auto_trader_history.py`,
  `query_auto_trader_config.py`

### Verification
- Build clean. /trading bundle 48.1 → 51.7 kB (+3.6kB).
- SSE first event ~100ms; emits both `positions` and `summary` with all new fields.
- Analytics + history mode filter end-to-end (paper: 53 trades, 47.2% WR;
  live: 0 trades; all: 53). Equity-curve splits correctly: live_count=0,
  paper_count=53, current_equity_live=$50, current_equity_paper=$40.69.
- Config write+read+restore tested for `LIVE_PER_TRADE_USD`. Disallowed
  key (`LIVE_HARD_CAPITAL_CAP_USD`) rejected with 400.
- Kill switch GET returns `{"active":false}` baseline.
- Sacred files unchanged. trevor.service untouched (PID 2076449 preserved).

## AutoTrader Premium Redesign — Flow + Activity Feed + Per-Ticker (2026-04-26)

Front-end-only restructure of `/trading?tab=autotrader` per Ghost's "cramped,
cluttered, dev-y" feedback on the prior dd294b2 deploy. Backend (SSE stream,
mode-aware analytics, equity curve splits, config whitelist) UNCHANGED. Three
NEW READ-ONLY query helpers + three NEW API routes + three NEW components +
KillSwitch.tsx DELETED + PositionCard rewritten + AnalyticsSection refactored.
trevor.service PID 2076449 preserved (only trevor-dashboard restarted).

### Section order (top to bottom)

1. **Header zone** — calm 3-row layout: identity bar (status pill + watch
   summary + last-signal pulsing dot) → equity hero (Orbitron 36/48px + 30-trade
   sparkline) → context strip (Total / Today / Open / Win / Streak inline, `·`
   separated). Total height <200px on 375vw. Kill button DELETED entirely.
2. **Active section** — open positions (rich 5-section cards) OR
   `<ScanningEmptyState>` with radar pulse + 5 sacred-ticker pills (green
   scanning / amber cooldown with Nm remaining / gray recent_reject). Tap a
   pill → expand to last-3 confidence trail with reject reasons.
3. **Activity feed** — `<ActivityFeed>` polls `/api/auto-trader/activity` every
   15s, last 50 events from auto_trades + active_signal_cards. 4 filter pills
   (All / Live / Trades / Rejects). Newer-than-60s events pulse green;
   older-than-1h fade to 55% opacity. Type-color icons (🟢/💰/🔴/✅/⏸️).
4. **Per-ticker performance** — `<PerTickerCards>` 5-card grid (2-col mobile,
   5-col desktop). Each card: ticker + sparkline / large total P&L + W/L
   record / color-coded WR bar (red <40 / amber 40-55 / green >55) / avg win,
   avg loss, best. Mode pills (All / Live / Paper, default = current bot mode).
5. **Analytics** — equity curve (kept) + `PnlByExitReasonChart` rendered ONLY
   when `by_exit_reason.some(count > 0 OR |total_pnl| > 0.005)` — no empty
   chart on fresh deploy. WR-by-ticker chart REMOVED (replaced by per-ticker
   cards above).
6. **Trade history** — `<TradeHistoryTable>` unchanged.
7. **Configuration** — `<ConfigPanel>` moved to bottom. Polish: 1.6s green
   border flash on save commit (extends `borderColor` memo), 🔒 prefix on
   view-only labels (`Hard Cap`, `SDK Errors`, `Dead-Man`, `Order Type`).

### NEW Python helpers (READ-ONLY, mode=ro URI)

| File | Purpose | Cache TTL |
|---|---|---|
| `query_auto_trader_scan_status.py` | Per-ticker scan state for empty-state pills (signal_cooldowns + last 3 active_signal_cards rows) | 30s |
| `query_auto_trader_activity.py` | Activity feed events from auto_trades (open/close) + active_signal_cards (accept/reject). Args: limit, since_iso, filter | 10s |
| `query_auto_trader_per_ticker.py` | Per-ticker stats + 60-point cumulative-pnl sparkline. Mode arg | 60s |

All use `datetime()` SQL wrappers on timestamp comparisons to avoid the
2026-04-24 Observatory T-vs-space string-comparison trap.

### NEW API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/auto-trader/scan-status` | GET | 5 sacred tickers, scanning/cooldown/recent_reject status |
| `/api/auto-trader/activity?limit=N&filter=all\|live\|trades\|rejections&since=ISO` | GET | Activity feed events, newest first |
| `/api/auto-trader/per-ticker?mode=all\|live\|paper` | GET | Per-ticker performance breakdown |

All cached, all 401 without session cookie (existing middleware).

### NEW components

| Path | Purpose |
|---|---|
| `src/components/autotrader/ScanningEmptyState.tsx` | Replaces giant `PauseCircle` empty state. Radar-pulse + 5 ticker pills + click-to-expand confidence trail. |
| `src/components/autotrader/ActivityFeed.tsx` | Real-time event stream with filter pills + 60s-fresh pulse + 1h fade. |
| `src/components/autotrader/PerTickerCards.tsx` | 5 ticker cards with sparkline + WR bar + stat detail. Mode-aware. |

### Modified components

| Path | Change |
|---|---|
| `src/components/autotrader/HeaderBar.tsx` | Full rewrite: 3-row calm layout, KillSwitch import deleted, equity sparkline added. |
| `src/components/autotrader/PositionCard.tsx` | Full rewrite: 6 sections (header / entered-line / big P&L+progress / stats / mini chart / exit logic). Mini-chart accumulates client-side from SSE updates with reference lines for entry/stop/target. Exit logic line computed from BE state + partials + peak + remaining timeout. |
| `src/components/autotrader/AnalyticsSection.tsx` | Removed `WinRateByTickerChart` + `EmptyMode` helper. P&L-by-exit-reason rendered only when data exists. |
| `src/components/autotrader/ConfigPanel.tsx` | Save-commit 1.6s green border flash (`borderColor` memo extended). 🔒 prefix on `ViewOnly` labels. |
| `src/app/trading/panels/AutoTraderPanel.tsx` | Section reorder per spec. |

### Deleted

- `src/components/autotrader/KillSwitch.tsx` — Discord `!auto kill` is the
  kill switch; the in-page button caused stress/clutter per Ghost. The
  system-wide kill switch on the main Dashboard (`/api/kill-switch` + `.kill_switch`
  flag) is a different feature, untouched.

### Ghost-approved deviations from prompt

1. **HTTP polling instead of new SSE channel** for the activity feed. The
   prompt suggested adding an `activity` event to the existing 15s SSE tick;
   I went with `/api/auto-trader/activity` polling at 15s for simpler
   integration. Same effective cadence, no `stream/route.ts` modification.
2. **Mini-chart history accumulated client-side** from SSE `current_price`
   updates (deque-in-useRef, max 60 points). Avoids new HL endpoint or extra
   API pressure — chart fills in over the trade's lifetime. Cold-start shows
   "accumulating price history…" placeholder for first ~30s.
3. **Python helpers in trevor-dashboard root** (matching existing convention:
   `query_auto_trader_live.py`, `query_auto_trader_history.py`,
   `query_auto_trader_config.py`). Per Ghost's prompt #2 confirmation: dashboard
   helpers are READ-ONLY query scripts, NOT bot pipeline edits. No new npm deps.

### Verification (all PASS)

- `npm run build` clean. /trading bundle **51.7 → 53.6 kB** (+1.9kB net for
  the entire restructure including 3 new components + KillSwitch deletion).
- All 3 new endpoints return JSON via authenticated curl:
  - `/api/auto-trader/scan-status` — 5 tickers; live state showed
    BTC/ETH/SOL=scanning, HYPE=cooldown 55.4m, FARTCOIN=cooldown 16.3m
  - `/api/auto-trader/per-ticker?mode=paper` — 5 tickers with full stats +
    equity_points (BTC 7 trades, ETH 5, SOL 11, HYPE 8, FARTCOIN 22)
  - `/api/auto-trader/activity?limit=5` — 5 most recent accepted events
    incl. fresh post-deploy HYPE LONG @ 23:54:30 UTC; `?filter=rejections`
    correctly returned only `expired` + `direction_flip` events
- Negative test: `/api/auto-trader/activity` without cookie → 401 (middleware
  auth). `/api/auto-trader/per-ticker` invalid mode → falls through to default
  ("all").
- **trevor.service PID 2076449 UNCHANGED** (the meta-check Ghost cares about).
  Only `trevor-dashboard.service` restarted: 2150463 → 2158290 at
  2026-04-26 23:57:33 UTC. Pattern 2 readiness gate fired READY at 23:58:52.
- Sacred 12/12 byte-identical pre/post via md5sum against
  `/tmp/sacred_pre_phase5.md5`.
- `hooks/guard_recurring_bugs.sh` 13/13 PASS.
- `signal_filter_rules` UNCHANGED (1 inert REGIME_THRESHOLD_CAP enabled=0
  reseed row per Rule 30 known residual).
- Pattern 1 dashboard-error watch + Pattern 6 trevor.service recurring-bug
  canary (both 540s wrapped, dispatched per Mandate before restart): 0
  qualifying emits during active window.

### Files

**Dashboard repo (this commit):**
- New: `query_auto_trader_scan_status.py`, `query_auto_trader_activity.py`,
  `query_auto_trader_per_ticker.py`
- New: `src/app/api/auto-trader/scan-status/route.ts`,
  `src/app/api/auto-trader/activity/route.ts`,
  `src/app/api/auto-trader/per-ticker/route.ts`
- New: `src/components/autotrader/ScanningEmptyState.tsx`,
  `src/components/autotrader/ActivityFeed.tsx`,
  `src/components/autotrader/PerTickerCards.tsx`
- Modified: `src/components/autotrader/HeaderBar.tsx`,
  `src/components/autotrader/PositionCard.tsx`,
  `src/components/autotrader/AnalyticsSection.tsx`,
  `src/components/autotrader/ConfigPanel.tsx`,
  `src/app/trading/panels/AutoTraderPanel.tsx`
- Deleted: `src/components/autotrader/KillSwitch.tsx`
- Docs: `CLAUDE.md` (this section)

**Trevor repo:** zero source-code changes. `BEHAVIOR_RULES.md` Section 3
changelog + `CLAUDE.md` Hub-only cross-reference entry committed separately.

### Rollback

```bash
cd /home/trevor/trevor-dashboard
git revert <commit-hash>
sudo systemctl restart trevor-dashboard.service
# Restores prior cramped header + KillSwitch + WR-by-ticker chart layout.
# trevor.service PID 2076449 stays untouched either way.
```

### Hard constraints honored

- Rule 1 (NO AUTO-CLOSE) preserved — display-only restructure, zero trade-
  closing code added or modified
- Rule 14 (sacred files) — 12/12 byte-identical pre/post
- Rule 15 (additive DB) — N/A (zero schema changes)
- Rule 16 (surgical edits) — only files specified in prompt's Phase 5 git
  add list staged
- Rule 22 (no Discord channels touched)
- Rule 30 (no ticker/direction blocks) — `signal_filter_rules` unchanged
- Rule 31 (auto trader never self-pauses) — N/A (UI only)
- No new npm dependencies (Recharts 2.15.4 reused; no `pandas_ta`-style PyPI
  installs)
- Mobile-first verified at 375vw (header <200px, ticker pills wrap cleanly,
  activity feed scrollable, per-ticker grid 2-col)
- No HTML `<form>` tags introduced
- Honesty: live behavioral proof of mini-chart price history accumulation
  deferred to first opened position post-deploy (0 open at deploy time;
  smoke validated via existing 53 closed paper trades + scan-status
  cooldown rendering)

## Auto Trader Nav Promotion — 2026-04-27

Promoted Auto Trader from a Trading-tab to a standalone top-level page in the
Hub navigation. Six-item bottom nav: Dashboard → Auto Trader → Trading →
Intelligence → Command → Chat. Trading page now has only Trades + Holdings
tabs. Zero backend changes; pure routing + nav restructure. trevor.service
untouched. Deploy verified live with open FARTCOIN LONG position +1.39%.

### What changed

- **New route `/autotrader`** — `src/app/autotrader/page.tsx` wraps the
  extracted `AutoTraderPage` component in the same Orbitron page-title +
  scrollable content chrome that `TabContainer` provides. `loading.tsx`
  mirrors `trading/loading.tsx` (Skeleton).
- **AutoTraderPanel relocated** — moved from
  `src/app/trading/panels/AutoTraderPanel.tsx` →
  `src/components/autotrader/AutoTraderPage.tsx`. File contents unchanged
  except the default export name (`AutoTraderPanel` →`AutoTraderPage`).
  Imports of the 8 sub-components untouched.
- **`next.config.ts` redirect removed** — dropped the
  `/autotrader → /trading?tab=autotrader` 308 line at line 12. The new page
  route now resolves directly. `/trades` and `/holdings` redirects retained.
- **Sidebar `NAV_ZONES` extended** — new entry inserted at index 1 (between
  Dashboard and Trading): `id="autotrader"`, `label="AUTO TRADER"`, icon
  `Bot` (lucide-react), `href="/autotrader"`, no children. Mobile bottom-nav
  label special-case extended (`zone.id === "autotrader" ? "AUTO" : ...`)
  alongside the existing `INTEL` shortening for Intelligence — keeps 6 items
  fitting cleanly on a 375px viewport.
- **Trading page reduced to 2 tabs** — `src/app/trading/page.tsx` drops the
  `autotrader` tab. `AutoTraderPanel` import removed. `?tab=autotrader` URL
  param falls through to default tab (`trades`) cleanly via TabContainer's
  existing `defaultTab` fallback.
- **`!auto` Discord command references removed**:
  - `src/components/autotrader/ScanningEmptyState.tsx:107-109` — the
    visible "Use `!auto on` in Discord to enable" text under "Auto Trader
    OFF" is gone. Empty state now shows just the OFF label.
  - `src/components/autotrader/HeaderBar.tsx:18` — stale comment
    "Kill button removed entirely (Discord !auto kill is the kill switch)"
    deleted.
  - `src/app/api/auto-trader/route.ts:7` — stale comment "Writes
    (enable/disable) go through the Discord !auto command" deleted.
  - The `!auto` Discord commands no longer exist in TREVOR; config changes
    happen via CC prompts only.

### Sidebar active-state behavior

`getActiveZoneId(pathname)` already supports the new zone via the existing
`pathname.startsWith(zone.href)` check (sidebar.tsx:90). When on
`/autotrader`, the Auto Trader nav item highlights `#00ff88` and Trading
does NOT. Verified via authenticated curl: all 6 routes return 200.

### Bundle deltas (post-build)

| Route | Before | After |
|---|---|---|
| `/trading` | 36.2 kB / 272 kB First Load | 36.8 kB / 253 kB |
| `/autotrader` | (didn't exist as page) | 20.1 kB / 224 kB |

The `-19 kB` First Load reduction on `/trading` is the AutoTrader weight
moving to its own route. The route-level chunks code-split as expected.

### Verification (all PASS)

| Check | Result |
|---|---|
| `npm run build` | clean, 0 type errors, 0 lint warnings (Phase 1 + Phase 2 + Phase 3 builds all clean) |
| `hooks/guard_recurring_bugs.sh` | **13/13 PASS** |
| Sacred files (9) md5 pre/post | **9/9 byte-identical** (IDENTITY/BRAIN/SOUL/AGENTS in `brain/`, swarms_brain, training_bridge, signal_guard, signal_cooldown, signal_cleanup) |
| Auto-close canary | CLEAN (no `auto.close`/`force_close`/`AUTO_CLOSE` introductions in Hub `src/`; one positive-assertion match in TrainingPanel.tsx text "Never auto-closes" — pre-existing doc string) |
| `!auto` strings remaining in Hub `src/` | **0** |
| `auto.trader` strings remaining in `src/app/trading/` | **0** |
| All 6 nav routes (authenticated) | 200/200/200/200/200/200 |
| SSE `/api/auto-trader/stream` | 200, content-type text/event-stream, both `positions` + `summary` events emitted with live FARTCOIN data ($0.21218, +1.394% live P&L, equity $49.50, mode=live) |
| trevor-dashboard.service post-restart | active (running), MainPID 2203445, NRestarts=0, "TREVOR Hub ready" within 4s |
| trevor.service | UNTOUCHED (only Hub restarted) |

### Risk flags handled

- **`/trading?tab=autotrader` URL bookmarks**: TabContainer's `defaultTab`
  fallback at `TabContainer.tsx:23-25` (`validTab = tabs.find(t => t.id ===
  paramTab); activeTab = validTab ? paramTab! : (defaultTab || tabs[0]?.id)`)
  silently routes invalid tab params to the default — anyone with the old
  bookmark lands on Trades. Acceptable for single-user Hub.
- **308 redirect cache**: browsers cache `permanent: true` redirects
  aggressively. Hard refresh may be needed if `/autotrader` was visited
  during the redirect period. Acceptable since Hub is single-user (Ghost).
- **Mobile bottom nav width at 375px**: 6 items × ~62px each, all icons
  retain ≥48px touch targets via `minWidth: 48px`. Auto Trader uses 4-char
  "AUTO" label (shortest of any zone), Intelligence keeps 5-char "INTEL"
  shortening — both fit cleanly at `font-size: 9px`.
- **`useLongPress` rules-of-hooks lint**: pre-existing eslint-disable
  comment at `sidebar.tsx:436` calls the hook inside `.map()`. Safe because
  array length never changes at runtime; adding one entry keeps it stable.
  Not refactored in this PR.

### Files

**Added:**
- `src/app/autotrader/page.tsx`
- `src/app/autotrader/loading.tsx`
- `src/components/autotrader/AutoTraderPage.tsx`

**Modified:**
- `src/components/sidebar.tsx` (Bot icon import + new NAV_ZONES entry +
  AUTO label special-case)
- `src/app/trading/page.tsx` (drop autotrader tab + import)
- `src/components/autotrader/HeaderBar.tsx` (stale `!auto` comment)
- `src/components/autotrader/ScanningEmptyState.tsx` (visible `!auto`
  Discord instruction removed)
- `src/app/api/auto-trader/route.ts` (stale `!auto` comment)
- `next.config.ts` (drop `/autotrader → /trading?tab=autotrader` redirect)

**Deleted:**
- `src/app/trading/panels/AutoTraderPanel.tsx` (relocated to
  `components/autotrader/AutoTraderPage.tsx`)

**Untouched (pre-existing local edits, NOT included in commit):**
- `.env`, `.env.local` — Discord token + DASHBOARD_PASS rotations from the
  2026-04-24 Hub Lockdown work, never committed; deliberately stayed out
  of scope here.
- `tsconfig.tsbuildinfo` — build cache churn, ignored.

### Hard constraints honored

- Rule 1 (NO AUTO-CLOSE) preserved — pure nav restructure, zero
  trade-closing code touched
- Rule 14 (sacred files) — 9/9 byte-identical
- Surgical edits — only the listed files staged
- No new npm dependencies (`Bot` icon already present in lucide-react)
- TREVOR (`trevor.service`) UNTOUCHED — only `trevor-dashboard.service`
  restarted at 2026-04-27 04:29:38 UTC

## Multi-Bot Auto Trader Layout — 2026-04-27

The `/autotrader` page is now a multi-bot hub. The existing TREVOR auto trader
(BTC/ETH/SOL/HYPE/FARTCOIN) is wrapped in a labeled **SCALPER** section; a
**DEGEN** UI skeleton sits below it (no backend yet — the bot service does
not exist). A horizontal pill selector at the top scrolls Ghost between
sections without a tab swap so both are always visible at once.

### Layout (top → bottom)

1. Sticky page title `AUTO TRADER` (preserved from 2026-04-27 nav promotion)
2. **`<BotNavStrip>`** — sticky pill row: 🔪 SCALPER · active / 💀 DEGEN · coming soon. Tap → `scrollIntoView` to the section.
3. SCALPER section (`<section id="bot-scalper">`):
   - `<BotSectionHeader bot=SCALPER dynamicMode>` — green accent line, icon, name, LIVE/PAPER pill, ticker list, exchange + capital
   - `<AutoTraderPage />` — **byte-identical**, the existing 7-section component (HeaderBar / Active / ActivityFeed / PerTickerCards / AnalyticsSection / TradeHistoryTable / ConfigPanel)
4. DEGEN section (`<section id="bot-degen">`) via `<DegenSection>`:
   - Magenta `#ff00ff` accent line + header + amber `NOT CONNECTED` pill + ticker `ALL` + description "Meme/Low-Cap Focus"
   - **Awaiting Connection card** — dashed magenta border, `Rocket` icon in glow ring, 4 trait bullets, "Bot not deployed" status line
   - **Static config card** — 6 read-only ViewOnly fields (Capital $50 / Mode Paper / Max Concurrent 5 / Strategy YOLO Moonshot / Risk Level MAX bar / Tickers ALL auto-scan)
   - **Empty Recent Activity card** — same chrome as `ActivityFeed`, "No activity yet · Bot will appear here once deployed"

### SCALPER mode source

`useScalperMode()` hook in `src/app/autotrader/page.tsx` polls
`/api/auto-trader/config` every 60 s, reads `AUTO_LIVE_ENABLED`, and feeds
the section-header pill. **No second `useAutoTraderStream` EventSource** is
opened — `AutoTraderPage` keeps the single existing SSE connection.

### BotConfig registry

Adding a future bot is now mechanical:

1. Append a `BotConfig` entry to `src/lib/bots.ts` (id / name / icon / accentColor / status / tickers / exchange / capital / mode / scrollAnchorId / apiBasePath)
2. Build a `<XxxSection>` component (use `DegenSection` as a template)
3. Render it under `BotNavStrip` in `src/app/autotrader/page.tsx`
4. (Eventually) create API routes at the `apiBasePath` value

The DEGEN bot's planned API base is `/api/degen` (does not exist yet).

### Files

**Added:**
- `src/lib/bots.ts` — `BotConfig` interface + `SCALPER_CONFIG` + `DEGEN_CONFIG` + `BOT_CONFIGS` array
- `src/components/autotrader/BotNavStrip.tsx` — sticky pill selector
- `src/components/autotrader/BotSectionHeader.tsx` — reusable header (icon / name / mode-or-status badge / tickers / exchange + capital + accent border)
- `src/components/autotrader/DegenSection.tsx` — full DEGEN UI skeleton (3 cards)

**Modified:**
- `src/app/autotrader/page.tsx` — adds `useScalperMode` hook, `<BotNavStrip>`, wraps `<AutoTraderPage>` in SCALPER section, appends DEGEN section

**Untouched:**
- All 11 existing autotrader components (`HeaderBar` / `PositionCard` / `ConfigPanel` / `EquityCurveChart` / `AnalyticsSection` / `PerTickerCards` / `PnlByExitReasonChart` / `ScanningEmptyState` / `ActivityFeed` / `TradeHistoryTable` / `WinRateByTickerChart`)
- All 9 `auto-trader/*` API routes
- `useAutoTraderStream.ts`
- Sacred files (9/9 byte-identical)

### Verification

| Check | Result |
|---|---|
| `npm run build` | clean. `/autotrader` bundle **20.1 → 22.3 kB** (+2.2 kB net for nav strip + section header + DEGEN skeleton + bots lib) |
| `hooks/guard_recurring_bugs.sh` | **13/13 PASS** |
| Sacred files | **9/9 byte-identical** pre/post (`brain/{IDENTITY,BRAIN,SOUL,AGENTS}.md` + `swarms_brain.py` + `training_bridge.py` + `signal_guard.py` + `signal_cooldown.py` + `signal_cleanup.py`) |
| Auto-close canary | CLEAN |
| `/autotrader` authenticated | HTTP 200, 46 KB |
| `/api/auto-trader/stream` | emits `positions` + `summary` with mode=`live`, equity $49.18, 10 trades today, stats_7d intact |
| `/api/auto-trader/config` | `AUTO_LIVE_ENABLED=true` → SCALPER section header shows LIVE pill |
| `trevor.service` | **UNTOUCHED** (PID 2182549, 9 h uptime) |
| `trevor-dashboard.service` | active (running), MainPID 2255303 since 2026-04-27 12:24:54 UTC, 0 errors in journal |

### Hard constraints honored

- Rule 1 (NO AUTO-CLOSE) — display-only restructure
- Rule 14 (sacred files) — 9/9 byte-identical
- Surgical edits — only the 5 files in the "Files" block staged
- No new npm dependencies (`Rocket` + `Activity` icons already in `lucide-react`)
- Mobile responsive at 375 px — pill row uses `overflow-x-auto`, section headers use `flex-wrap`, DEGEN config grid collapses to 1-col

### Rollback

```bash
cd /home/trevor/trevor-dashboard
git revert <commit-hash>
sudo systemctl restart trevor-dashboard.service
# Restores single-bot Auto Trader (no nav strip, no SCALPER wrapper, no DEGEN section)
```

## A4 — Design System Foundation (shipped 2026-04-29)

Locks the design tokens, primitives, gestures, and accessibility floor that
every Wave B–H prompt consumes. Additive only: no existing component is
modified, no behavior changes, no DB writes. Future waves migrate consumers
on top of these primitives.

### Tokens registered in `src/app/globals.css` `@theme inline` block

Tailwind v4 CSS-first registration — **no `tailwind.config.ts` exists** (v4
uses the `@theme` directive directly). All design-system tokens live as
`--color-*` / `--shadow-*` / `--radius-*` / `--duration-*` / `--breakpoint-*`
/ `--animate-*` and produce Tailwind utilities of the same name (e.g.
`bg-bg-card`, `text-fg-muted`, `shadow-glow-cyan`, `rounded-pill`,
`duration-fast`, `xs:flex`, `mm:grid-cols-2`, `animate-pulse-cyan`).

| Namespace | Tokens |
|---|---|
| Surface (bg) | `bg-primary` `bg-card` `bg-elevated` `bg-glass` `bg-sidebar` `bg-overlay` |
| Foreground (fg) | `fg-primary` `fg-muted` `fg-dim` `fg-faint` |
| Accents | `accent-cyan` `accent-magenta` `accent-green` `accent-amber` `accent-red` `accent-violet` |
| Borders | `border-subtle` `border-strong` `border-accent` `border-amber` `border-red` |
| Glow shadows | `shadow-glow-cyan/magenta/green/amber/red` + `shadow-card` |
| Radii (added) | `xs` (0.125rem) · `xl` (1rem) · `pill` (9999px) — existing `sm/md/lg` kept |
| Durations | `instant` 80ms · `fast` 160ms · `medium` 240ms · `slow` 400ms |
| Breakpoints (added) | `xs` 375px · `mm` 430px — Tailwind v4 defaults `sm/md/lg/xl` PRESERVED (640/768/1024/1280) |
| Animations | `pulse-cyan/amber/green/magenta` · `shimmer-ds` · `slide-up` · `fade-in` |

### Parallel-namespace coexistence

Existing legacy tokens (`--background`, `--card`, `--neon-cyan`, `--accent-brand`,
…) remain live for currently-shipped components. New `--color-bg-*`,
`--color-fg-*`, `--color-accent-*` tokens point at identical hex values but
with the design-system naming convention. Both schemes coexist; Wave B+
components migrate at their own cadence.

### `cn()` helper extended

`src/lib/utils.ts` now uses `extendTailwindMerge()` to register the 7 custom
typography classes (`text-display/h1/h2/h3/body/caption/micro`) as members of
the `font-size` group. Without this, tailwind-merge would default-classify them
as text-color and merge them out when stacked alongside `text-accent-*`.

### 12 primitives in `src/components/ui/`

| File | Export | Purpose |
|---|---|---|
| `card.tsx` | `Card` `CardHeader` `CardTitle` | Base card with cyan/magenta/green/amber/red glow variants |
| `metric-tile.tsx` | `MetricTile` | label + value + sub, 6 tones × 4 sizes |
| `pill.tsx` | `Pill` | Status pill, 7 tones × 2 sizes, optional pulse |
| `segmented-toggle.tsx` | `SegmentedToggle` | URL-friendly tab/segment toggle (system, range pickers) |
| `tab-bar-v2.tsx` | `TabBar` | Horizontal-scrollable tab bar w/ underline indicator + badge |
| `empty-state-v2.tsx` | `EmptyState` | min-h-[40vh] centered state w/ icon + title + body + action |
| `skeleton-shimmer.tsx` | `Skeleton` | Animated `animate-shimmer-ds` placeholder |
| `killswitch-pill.tsx` | `KillswitchPill` | Migrated from `src/components/`, now uses `<Pill tone="amber" pulse>` primitive. Legacy import path preserved via re-export alias. |
| `live-pulse.tsx` | `LivePulse` | Pulse dot + optional label, 4 tones |
| `money-text.tsx` | `MoneyText` | Sign + tone + size, $ or % unit, tabular-nums |
| `bottom-sheet.tsx` | `BottomSheet` | Mobile-first modal sheet w/ ESC + backdrop close + body-scroll lock |
| `haptic-button.tsx` | `HapticButton` | Button w/ vibrate(8ms), 4 variants × 3 sizes, `active:scale-[0.98]` |

Barrel `src/components/ui/index.ts` exports the 12 primitives + their type
interfaces. Legacy primitives (`panel.tsx`, `empty-state.tsx`, `skeleton.tsx`,
`tab-bar.tsx`, `stat-block.tsx`, `direction-badge.tsx`, `confidence-bar.tsx`)
are NOT re-exported from the barrel — import them from their individual paths
if you still need the legacy API. The 3 collision cases (EmptyState/Skeleton/
TabBar) live at distinct `*-v2` / `*-shimmer` paths so the ~19 existing
consumers continue working untouched.

### 2 gesture hooks in `src/hooks/`

| File | Hook | Purpose |
|---|---|---|
| `usePullToRefresh.ts` | `usePullToRefresh` | Mobile pull-to-refresh w/ progress + threshold + isRefreshing state |
| `useLongPress.ts` | `useLongPress` | Long-press handler set, 450ms default, `vibrate(20)` on fire |

### Accessibility floor at `src/lib/a11y.ts`

`focusRing` className (`outline-accent-cyan/60 outline-offset-2`) + `reactId()`
helper. The `prefers-reduced-motion` `@media` block was already in
`globals.css:405` — not duplicated.

Floor we hit:
- Tap-target `.tap-target` class → 44×44px iOS HIG minimum.
- ARIA: `role="tablist"` + `aria-selected` (SegmentedToggle), `aria-current` (TabBar), `role="dialog" aria-modal` (BottomSheet), `role="status" aria-label="Loading"` (Skeleton).
- Reduced-motion preserved (existing `@media (prefers-reduced-motion: reduce)`).
- Keyboard nav: every interactive element is `<button>` or `<a>` and tab-reachable.

### Showcase route at `/design-system`

`src/app/design-system/page.tsx` — internal preview (4.69 kB / 114 kB First
Load). Exercises every primitive at every breakpoint. NOT linked from any
sidebar or nav. Original prompt called it `/_design-system` — Next.js App
Router excludes folders prefixed with `_` from routing, so the underscore
was dropped. Reachable only by typing the URL.

### What A4 does NOT do

- Does not migrate any existing component to use the new primitives. Wave B–H migrate their own zones.
- Does not change navigation (Wave B1), topbar (Wave B2), or any zone (C-H).
- Does not introduce dark/light theme toggle (out of scope).
- Does not add Storybook (showcase route is the simpler equivalent).
- Does not add framer-motion or any new dependency.
- Does not delete legacy components.
- Does not touch backend, Discord, or sacred files.

### Verification (all PASS)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 type errors |
| `npm run build` | clean, 0 errors / 0 warnings; new `/design-system` route 4.69 kB / 114 kB First Load |
| `trevor-dashboard.service` restart | active, MainPID 2719817, "TREVOR Hub ready" within 1s |
| All 10 routes (authenticated) | 200/200/200/200/200/200/200/200/200/200 |
| Design-system HTML smoke | bg-bg-card×11 · text-fg-muted×25 · shadow-glow-cyan×4 · animate-pulse-cyan×3 · animate-shimmer-ds×3 · rounded-pill×11 · tap-target×12 · text-display×2 · text-h2×14 · text-micro×22 · duration-fast×16 · duration-instant×6 |
| 6/6 recurring-bug canaries | CLEAN |
| Sacred files (9 in `brain/` + root + 2 shadow `.md`) | 11 OK + 2 pre-existing FAILED on `BEHAVIOR_RULES.md` + `CLAUDE.md` (will be modified in this commit; manifest stays stale until next manifest-refresh prompt) |
| `trevor.service` | UNTOUCHED |

### Files

**Hub repo (this commit):**
- New: `src/components/ui/{card,metric-tile,pill,segmented-toggle,tab-bar-v2,empty-state-v2,skeleton-shimmer,killswitch-pill,live-pulse,money-text,bottom-sheet,haptic-button}.tsx` + `index.ts`
- New: `src/hooks/{usePullToRefresh,useLongPress}.ts`
- New: `src/lib/a11y.ts`
- New: `src/app/design-system/page.tsx`
- Modified: `src/app/globals.css` (added @theme block + 7 typography classes + 7 keyframes + safe-area + tap-target)
- Modified: `src/lib/utils.ts` (`extendTailwindMerge` for typography group)
- Modified: `src/components/KillswitchPill.tsx` (legacy alias re-export from `ui/killswitch-pill`)

**Trevor repo (sibling commit, --no-verify per sacred-bypass policy):**
- Modified: `BEHAVIOR_RULES.md` (Section 3 changelog entry)
- Modified: `CLAUDE.md` (cross-reference)

### Hard constraints honored

- Rule 1 (NO AUTO-CLOSE) — display-only foundation, zero trade-closing code
- Rule 14 (sacred files) — 9 in `brain/`+root byte-identical. `BEHAVIOR_RULES.md`+`CLAUDE.md` modified intentionally per A4 spec; --no-verify per memory `feedback_sacred_bypass`.
- Rule 15 (additive DB) — N/A (zero schema changes)
- Rule 16 (surgical edits) — only the listed files staged
- Rule 22 (no Discord channels touched)
- Rule 30 (no ticker/direction blocks) — `signal_filter_rules` UNCHANGED
- No new npm dependencies — `clsx`, `tailwind-merge`, `lucide-react`, `next-themes`, `recharts`, `tw-animate-css` all pre-existing
- Mobile-first verified — all primitives degrade cleanly at 375vw
- Cyberpunk preserved — only the 6 sacred accent colors; near-black bg; JetBrains Mono only

### Rollback

```bash
cd /home/trevor/trevor-dashboard
git revert <a4-commit>
sudo systemctl restart trevor-dashboard.service
# Removes new tokens, primitives, hooks, a11y, showcase. Existing components
# untouched throughout, so revert leaves the live Hub functionally identical
# to its 2026-04-29 pre-A4 state.
```



## B1 — Navigation Primitive (shipped 2026-04-29)

Mobile-first 5-zone bottom nav + desktop collapsing sidebar rail + floating
Chat button + URL realignment. Establishes the canonical zone + sub-tab
contract every Wave C–H prompt consumes. Old `sidebar.tsx` 6-zone shell is
preserved as the LegacyAppShell behind a feature flag for 15-second rollback.

### Zone contract — `src/lib/navigation.ts`

5 zones, 14 sub-tabs, locked at this single source of truth.

| Zone | Path | Accent | Sub-tabs |
|---|---|---|---|
| DASHBOARD | `/dashboard` | cyan | (none) |
| AUTO | `/autotrader` | green | Scalper / Degen |
| SCALP | `/scalp` | violet | Live Board / Recent / Quality / Calibration |
| INTEL | `/intel` | magenta | Lessons / Journal / Similar / Calibration / Shadow |
| MEMORY | `/memory` | cyan | Brain / Memory / ChromaDB / System Health / Aggressive |

CHAT is a floating action button (`/chat` route), present on every page
except itself. NOT a sixth tab.

### URL transitions (legacy → canonical, 308 redirects in middleware)

- `/trading` → `/scalp`
- `/command` → `/memory`
- `/intelligence` → `/intel`

Legacy page directories (`src/app/{trading,command,intelligence}/`) deleted.
Existing inbound `href="/trading"` etc. references in the preserved
`sidebar.tsx` (the legacy reference component, untouched in B1) hop through
the 308 redirect — kept intentionally so flag-OFF rollback behavior matches
pre-B1 exactly.

### Components shipped

- `src/lib/navigation.ts` — zone contract (`ZONES`, `CHAT_FAB`,
  `LEGACY_REDIRECTS`, `zoneFromPath()`, `accentTextClass()`,
  `accentGlowClass()`).
- `src/components/navigation/bottom-nav.tsx` — mobile bottom nav
  (`lg:hidden`), long-press → BottomSheet with sub-tabs, click suppression
  on long-press fire so opening sub-tabs does NOT also navigate.
- `src/components/navigation/chat-fab.tsx` — floating cyan-glow chat button,
  bottom-right above safe-area on mobile, top-right on desktop.
- `src/components/navigation/sidebar-rail.tsx` — desktop-only rail
  (`hidden lg:flex`), icon-only at `lg`, expanded labels at `xl`.
- `src/components/navigation/zone-sub-tabs.tsx` — TabBar wrapper that reads
  `?tab=` query param and writes URL on change. Auto-hides on zones without
  sub-tabs.
- `src/components/app-shell-nav.tsx` — new chrome wrapper. SidebarRail +
  Header + ZoneSubTabs + main + BottomNav + ChatFAB. `/login` bypasses chrome.
- `src/components/app-shell-legacy.tsx` — preserves the pre-B1 38-line
  AppShell verbatim (Sidebar + Header + PriceStrip + main + StatusBar).
  Renamed `AppShell` → `LegacyAppShell`. Kept until I1 fully removes it.
- `src/components/app-shell.tsx` — REWRITTEN as a server component flag
  selector. Reads `HUB_REDESIGN_NAV` via `runPython("query_feature_flags.py")`
  directly (NOT via `/api/feature-flags` self-fetch — middleware would
  401-redirect that on the auth gate). Cookie override
  `hub_redesign_override=HUB_REDESIGN_NAV=true` allows Ghost-only preview
  without flipping the global flag. Memoized via React `cache()` so a single
  page render hits the resolver once.

### Placeholder pages shipped

- `/scalp` — EmptyState card. Wave E1 fills.
- `/memory` — EmptyState card. Wave G1+G2 fills.
- `/intel` — EmptyState card. Wave F1–F3 fills.

Each reads the `?tab=` param and renders the matching sub-tab label so
the URL contract is testable now.

### Middleware redirects (`src/middleware.ts`)

Inserted BEFORE the auth gate so legacy paths redirect whether the session
is authed or not. Single block with `legacyMap` + 308 `NextResponse.redirect`.

### Feature flag

`HUB_REDESIGN_NAV` row in `auto_config`. False → LegacyAppShell renders.
True → AppShellNav renders. **15-second rollback path:**

```sql
UPDATE auto_config SET value='false', updated_at=datetime('now')
WHERE key='HUB_REDESIGN_NAV';
```

No service restart needed — the next page request reads the new flag value
(React `cache()` is per-request only, so the flip propagates immediately).

Ghost-only preview without global flip:
```
Cookie: hub_redesign_override=HUB_REDESIGN_NAV%3Dtrue
```

### Verification (all PASS)

- `tsc --noEmit` clean.
- `npm run build` ✓ Compiled successfully in 42s. 0 errors / 0 warnings.
  New routes `/scalp` 1.91 kB, `/memory` 1.89 kB, `/intel` 1.92 kB. Old
  `/trading`, `/command`, `/intelligence` removed from build output.
- `trevor-dashboard.service` restart healthy. MainPID 2741776 ready in 8s.
  Pre-existing `syslogd-6afdb5d` rogue process in the OLD cgroup forced a
  SIGKILL during stop — surfaced separately; not B1.
- All 6 zone routes 200 (dashboard / autotrader / scalp / intel / memory /
  chat). All 3 legacy redirects 308 with correct `Location:` headers.
  Followed redirects land at 200.
- Chrome diff via HTML grep on `/scalp`:
  - Flag OFF: 31353 B, ChatFAB=0, BottomNav=0, legacy "TRADING" text=2.
  - Cookie override: 23479 B, ChatFAB=1, SidebarRail v3=1, BottomNav=1,
    legacy "TRADING" text=0.
  - Flag ON globally: 23479 B, same as cookie override.
- **Rollback trial verified:** flip OFF → /scalp HTML returns to 31353 B
  with legacy chrome. Flip back ON → 23479 B with new chrome.
- `guard_recurring_bugs.sh` 13/13 PASS.
- Open positions UNCHANGED (active_trades 0/0, auto_trades 0/0 — matches
  Phase 0 baseline).
- `trevor.service` was already FAILED at session start
  (`ModuleNotFoundError: No module named 'email_triage'` — file is named
  `email_triage_v4.py`, the import in `discord_bot.py:26` is unsuffixed,
  first crash 2026-04-29 04:07:48 UTC ~12h before B1 began). NOT a B1
  regression. Surfaced; out of B1 scope to fix.

### Files

**Added:** `src/lib/navigation.ts`, `src/components/navigation/{bottom-nav,
chat-fab,sidebar-rail,zone-sub-tabs}.tsx`, `src/components/app-shell-nav.tsx`,
`src/components/app-shell-legacy.tsx`, `src/app/{scalp,memory,intel}/{page,
loading}.tsx`.

**Modified:** `src/components/app-shell.tsx` (REWRITTEN as server-component
flag selector), `src/middleware.ts` (added legacy redirect map before auth gate).

**Deleted:** `src/app/{trading,command,intelligence}/` (page + loading +
panels — 12 files total).

**Untouched:** `src/components/sidebar.tsx`, `src/components/{header,
status-bar,PriceStrip}.tsx`, `src/app/autotrader/page.tsx`.

### Known transitional cosmetics

- `/autotrader` shows BOTH the new ZoneSubTabs strip (Scalper / Degen) and
  the existing `BotNavStrip` in-page picker. Intentional during B1→D1
  transition; D1 cleans up.
- Inbound legacy `href` values in `sidebar.tsx` redirect through middleware
  rather than going to canonical paths directly. Resolves when
  `LegacyAppShell` + `sidebar.tsx` are deleted in I1.
- `/brain` page route is now an orphan (no nav surface points at it).
  Harmless until I1 cleanup.

### What B1 does NOT do

Does not rebuild the Topbar (B2). Does not migrate `BotNavStrip` (D1). Does
not fill any zone content (C/D/E/F/G). Does not convert CHAT to a side-panel
modal (H1). Does not delete `LegacyAppShell` (I1). Does not delete legacy
`sidebar.tsx` (I1). Does not change auth middleware logic. Does not touch
backend, Discord, or sacred files. Does not change favicon, title, or theme.
Does not introduce dark/light toggle. Does not introduce any new dep.

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display-only restructure. Rule 14 (sacred files) —
9/9 byte-identical; `BEHAVIOR_RULES.md` + `CLAUDE.md` modified per B1 spec
via `--no-verify` per memory `feedback_sacred_bypass`. Rule 15 (additive DB)
— N/A (only existing `HUB_REDESIGN_NAV` row's value UPDATEd). Rule 16
(surgical) — only listed files staged. Rule 22 (no Discord channels). Rule
30 (no ticker/direction blocks) — `signal_filter_rules` UNCHANGED. Rule 31
(auto trader never self-pauses) — N/A (UI only). No new npm dependencies —
`lucide-react` icons all pre-existing. Mobile-first; chrome diff confirms
BottomNav at mobile widths, SidebarRail at lg+, ChatFAB on every page. Tap
target floor 44×44 via `.tap-target`. No HTML `<form>`. No scoring changes.
B1 ships in the flag-ON state (HUB_REDESIGN_NAV='true' final).

### Rollback

```bash
sqlite3 /home/trevor/trevor/trevor.db "UPDATE auto_config SET value='false' WHERE key='HUB_REDESIGN_NAV';"
# 15-second flag rollback. No restart required.

# Full code revert (if needed):
cd /home/trevor/trevor-dashboard
git revert <b1-commit>
sudo systemctl restart trevor-dashboard.service
# Restores legacy app-shell.tsx (single 38-line client component), removes
# the 5 navigation components + AppShellNav + LegacyAppShell, removes /scalp
# /memory /intel placeholders, restores /trading /command /intelligence,
# removes middleware legacy redirects, removes navigation contract.
```

## B2 — Topbar Rebuild (shipped 2026-04-29)

Mobile-first post-redesign topbar replaces the legacy 133-line `header.tsx` (custom OLED toggle, ChangePasswordModal, Wifi/WifiOff status icons, `/api/status` fetch with `safeFetch`). New 184-line `header.tsx` composes A4 design-system primitives (`LivePulse` + `Pill` + `KillswitchPill` from `@/components/ui` barrel) + new `useScrollDirection` hook for mobile collapse-on-scroll. **NO STOP / Kill / Halt / Pause button anywhere — Discord `!killswitch` is the single project-wide pause per Rule 32 (codified A2).** Same `HUB_REDESIGN_NAV` flag from B1 controls both nav AND topbar — 15-second SQL flip rolls back together.

### 5 Phase 0 audit deviations from prompt (Ghost-approved)

1. **API endpoint shape mismatch** — prompt specified `/api/system-health` (`{scanner_ok, bot_active, ...}`) + `/api/admin/current-state` (`{xp, level}`). Neither endpoint returns those fields. `/api/system-health` actually returns `{scanner: {last_signal_at, status}, signals: {...}, api: {hyperliquid: {...}}, kill_switch: {...}}` and `/api/admin/current-state` returns `{currentCapital, pnlCutoffDate}`. Switched to existing well-tested `/api/status` (`{ok, trevor: {running, pid}, xp, rank, signals: {...}}`) — single endpoint with the right shape, matches legacy header pattern.
2. **`liveTone` simplification** — dropped amber DEGRADED tier (no `scanner_ok` field exists in `/api/status` either; would always evaluate true). New tone: red when `status?.trevor.running === false`, cyan otherwise.
3. **Logout via POST body, not URL query** — `/api/auth/route.ts:47` reads `body.action` from POST body. Prompt's `fetch("/api/auth?action=logout", { method: "POST" })` would default to `"login"` with empty body and fail with 401. Used existing legacy header pattern: POST body `{action: "logout"}`.
4. **`PriceStrip` is default export** — `export default function PriceStrip()`. Prompt's `import { PriceStrip } from "@/components/PriceStrip"` (named) would fail build. Used `import PriceStrip from "@/components/PriceStrip"` (default).
5. **next-themes for theme toggle** — legacy header had custom localStorage `oled` class on documentElement. Switched to `useTheme()` from next-themes (already installed v0.4.6, ThemeProvider mounted at `layout.tsx:19`). Toggle now flips `html.dark` instead of `html.oled` — existing `globals.css:141 html.oled {...}` CSS becomes unreachable from this toggle. `ChangePasswordModal` orphaned (deferred to future Settings page).

### Architecture

```
src/components/header.tsx (NEW, 184 lines) — main topbar
  ├─ /api/status poll (30s) — single source for LIVE/OFFLINE + XP + rank
  ├─ Clock 1s tick (HH:MM:SS, 24-hour)
  ├─ useScrollDirection (rAF-throttled, mobile collapse-on-scroll)
  ├─ useTheme() from next-themes (Sun/Moon toggle)
  ├─ usePathname() — minimal /chat variant detection
  ├─ usePathname() === "/chat" early-return for minimal back-button variant
  ├─ Composes from @/components/ui barrel:
  │   - LivePulse  (cyan/red, label LIVE/OFFLINE)
  │   - KillswitchPill (renders null when killswitch off; STANDBY pill when on)
  │   - Pill tone="cyan" — XP badge with rank tooltip
  └─ Imports default PriceStrip from @/components/PriceStrip

src/hooks/useScrollDirection.ts (NEW, ~50 lines)
  └─ rAF-throttled scroll tracker, returns "up"|"down"|null
     Threshold default 8px, SSR-safe (returns null when window undefined)

src/components/header-legacy.tsx (RENAMED from header.tsx via git mv, 133 lines)
  └─ exports `LegacyHeader` (was `Header`); preserved verbatim for I1 rollback

src/components/app-shell-legacy.tsx (UPDATED, 2 line edits)
  └─ import { LegacyHeader } from "@/components/header-legacy"
     <LegacyHeader /> in legacy chrome wrapper

src/components/app-shell-nav.tsx (UPDATED for build hygiene, +3 lines)
  └─ <Suspense fallback={null}><ZoneSubTabs /></Suspense>
     Required by Next.js 15 strict-mode static prerender of /_not-found
     (latent B1 issue surfaced by my fresh `rm -rf .next && npm run build`;
     fix matches sidebar.tsx pattern). NOT a B2-introduced bug — ZoneSubTabs
     uses useSearchParams since B1 (commit bd16d5f); B1's build cache may
     have skipped /_not-found prerender.
```

### Layout contract

**Mobile (< lg / 1024px)** — 2 rows, collapses on scroll-down via `-translate-y-full`:
```
┌──────────────────────────────────────────────────────┐
│ ●LIVE  21:35:01            [STANDBY]?  214⚡  ☀  ↗ │  Row 1
│ BTC $76,724 · ETH $2,284 · SOL $83.99 · …           │  Row 2 (lg:hidden)
└──────────────────────────────────────────────────────┘
```

**Desktop (≥ lg / 1024px)** — single row, always visible (`md:translate-y-0` overrides hide):
```
┌────────────────────────────────────────────────────────────────────┐
│ ●LIVE  21:35:01     BTC $76,724 · ETH $2,284 · …    [STANDBY]?  214⚡  ☀  ↗ │
└────────────────────────────────────────────────────────────────────┘
```

**`/chat` route** — minimal variant (back button + title + LivePulse, no PriceStrip/XP/Theme/Logout):
```
┌──────────────────────────────────────────────────────┐
│ ←  TREVOR CHAT                                  ●LIVE │
└──────────────────────────────────────────────────────┘
```

`safe-pt` utility class respected for iPhone notch + Dynamic Island. `tap-target` 44×44 floor on every interactive element. `transition-transform duration-medium` for smooth collapse-on-scroll.

### Verification (all PASS)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 errors |
| `npm run build` | clean, 43s, all routes `ƒ Dynamic` server-rendered on demand |
| `hooks/guard_recurring_bugs.sh` (trevor side) | 13/13 PASS |
| Sacred files 12/12 (trevor side) | byte-identical via `sha256sum -c .sacred_manifest.sha256` |
| `signal_filter_rules` (trevor side) | UNCHANGED (1 inert `REGIME_THRESHOLD_CAP enabled=0` reseed row per Rule 30 known residual) |
| 6 canaries (trevor side) | CLEAN |
| Login + 6 zone URLs | All HTTP 200 (`/dashboard`, `/autotrader`, `/scalp`, `/intel`, `/memory`, `/chat`) |
| New header HTML markers | flag ON: `bg-bg-sidebar=1`, `border-border-subtle=1`, `tap-target=1`, `text-fg-muted=1`, `safe-pt=1`, `duration-medium=1`, `Toggle theme=1`, `aria-label="Logout"=1` |
| Legacy header HTML markers | flag ON: all=0; flag OFF: `panel-header=1`, `Change password=1`, `OLED toggle=1`, `lucide-wifi=1` |
| Killswitch smoke (API) | `/api/killswitch` returns `{enabled:true, lastToggle, lastAuthor, lastReason}` after DB flip; cleanup restores `enabled:false` |
| Killswitch sentinels | `[KILLSWITCH-ON]` + `[KILLSWITCH-OFF]` WARNING lines in journalctl via `main.py:27` filter |
| Bot health invariant | trevor.service active (PID 2752692, untouched), 0/0 open positions matches Phase 0 baseline |
| Rollback verified | flag flip OFF → 30089B legacy chrome (4 legacy markers + 0 new); flip back ON → 23113B byte-identical to first ON |

### Deploy

| Field | Value |
|---|---|
| Pre-restart Hub MainPID | 2741776 (B1 generation) |
| Restart time | 2026-04-29 21:35:18 UTC |
| Post-restart Hub MainPID | **2760604**, NRestarts=0 |
| First `[HUB] TREVOR Hub ready` | 21:35:20 UTC (~3s cold-start) |
| Pattern 2 readiness gate | READY at 21:35:20 UTC, completed in <90s |
| Pattern 1 dashboard error watch (15min wrapped) | 0 qualifying emits |
| Pattern 6 trevor recurring-bug canary (15min wrapped) | 0 emits |
| trevor.service | UNTOUCHED — PID 2752692, ActiveEnterTimestamp 20:33:21 UTC unchanged |

### What B2 does NOT do

- Does NOT delete `header-legacy.tsx` (kept for emergency rollback; final removal in I1)
- Does NOT change `/api/kill-switch` route file (kept for backward-compat per A2)
- Does NOT modify the auth flow
- Does NOT introduce dark/light theme toggle logic (uses existing `next-themes`)
- Does NOT refactor `PriceStrip.tsx` (kept tested, preserved as default-export)
- Does NOT delete `status-bar.tsx` (still mounted by `LegacyAppShell`; deletion deferred to I1)
- Does NOT touch backend, Discord, or sacred files
- Does NOT modify `trevor.service` — only `trevor-dashboard.service` restarted

### Rollback

```bash
# Soft (15-second flag flip — restores BOTH nav and topbar to legacy chrome)
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='HUB_REDESIGN_NAV';"
# No restart required (React cache() is per-request)

# Full code revert
cd /home/trevor/trevor-dashboard && git revert <hub-commit>
sudo systemctl restart trevor-dashboard.service
```

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display-only, zero trade-closing code. Rule 14
(sacred files) — 12/12 byte-identical (trevor side). Rule 15 (additive DB)
— N/A no schema changes. Rule 16 (surgical) — only listed files staged.
Rule 22 (no Discord channels touched). Rule 30 (no ticker/direction blocks)
— `signal_filter_rules` UNCHANGED. Rule 31 (auto trader never self-pauses)
— N/A UI only. Rule 32 (KILLSWITCH IS THE ONLY PROJECT-WIDE PAUSE; UI Stop
buttons banned) — ENFORCED. New topbar has zero kill affordance. No new
npm dependencies. JetBrains Mono only. Cyberpunk palette only via A4 tokens.


## C2 — Dashboard Supporting Widgets (shipped 2026-04-30)

Completes the Wave C dashboard composition started in C1. Three new
supporting widgets — Quick Stats Strip, Edge Analysis, Calibration Quick
Tile — three new dashboard-scoped API routes, three new READ-ONLY query
helpers, plus pull-to-refresh wired into `<DashboardView>`. Final dashboard
order locked: Hero → Active → Quick Stats → Edge → Calibration. The legacy
`dashboard-placeholder.tsx` is DELETED; the flag-OFF rollback path now
renders a small inline disabled message inside `dashboard/page.tsx`.

### Phase 0 audit findings (Ghost-approved schema deviations from prompt)

The C2 prompt assumed a `signals` table, a `direction` column, a
`calibration_cache` table, an `auto_config.LIFETIME_XP` row, and a 5-bucket
calibration distribution. Phase 0 audit found **none of those exist**:

| Prompt assumed | Real schema |
|---|---|
| `signals` table | doesn't exist — `trade_insights` is the equivalent |
| `direction` column | doesn't exist on `trade_insights` — `signal_type` (LONG/SHORT) |
| `confidence` 0-100 | `trade_insights.confidence` is **0-1**; multiply by 100 for display |
| `auto_config.LIFETIME_XP` | doesn't exist — read `xp_ledger.total_after` (latest row) |
| `calibration_cache` table | doesn't exist — calibration is computed dynamically from `unified_outcomes` (the same path `query_quality.py cmd_by_confidence` already uses for `/api/quality?scope=by_confidence`) |
| 5 buckets `35-44 / 45-54 / 55-64 / 65-74 / 75+` | actually 6: `30-40 / 40-50 / 50-60 / 60-70 / 70-80 / 80+`, `unified_outcomes.confidence` is on **0-100 scale** (range 35.05–86.05 in current data) |
| `?include_calibration=1` on `/api/quality` | not implemented; actual scope is `?scope=by_confidence`. Picked Option B from §5.2 — new dedicated `/api/dashboard/calibration` route — instead of extending the shared `/api/quality` endpoint. |

`unified_outcomes` is a VIEW (paper + backfill + live UNION ALL) — confirmed
via `SELECT type FROM sqlite_master`. 941 closed trades available in last
90d window for Edge Analysis (paper=0, backfill=867, live=74). Edge
script reads from this VIEW; sample size is plenty.

### New READ-ONLY Python helpers

| File | Purpose | Source |
|---|---|---|
| `query_dashboard_edge.py` | Aggregate expectancy, W/L ratio, avg win/loss, best, worst, asymmetric flag (90d window). Sample-floor 5; emits empty-state shape below floor. | `unified_outcomes` VIEW |
| `query_dashboard_quick_stats.py` | 24h signal count, avg confidence (×100 for display), L/S split, lifetime XP. | `trade_insights` (24h) + `xp_ledger.total_after` (latest) |
| `query_dashboard_calibration.py` | 6 calibration buckets with WR + sample size + sweet/dead-zone selection (n≥5 floor). Emits `win_rate` already in 0-100 percent for direct render. | `unified_outcomes` (mirrors `query_quality.py cmd_by_confidence` bucket logic) |

All three open SQLite read-only via `file:...?mode=ro`. Same convention as
the C1 helpers (`query_dashboard_pnl.py`, `query_dashboard_active.py`).

### New API routes (auth-gated by middleware)

| Route | Refresh cadence (component) |
|---|---|
| `/api/dashboard/edge` | 120 s polling in EdgeAnalysisCard |
| `/api/dashboard/quick-stats` | 60 s polling in QuickStatsStrip |
| `/api/dashboard/calibration` | 5 min polling in CalibrationQuickTile |

All wrap their helper via the existing `runPython` (synchronous spawnSync)
in `src/lib/api-helpers.ts`. Error path returns the empty shape with
HTTP 200 + `data_available: false` so the widget can render a real
empty-state instead of crashing.

### New widget components

| File | Notes |
|---|---|
| `src/components/dashboard/edge-analysis-card.tsx` | Card with 4-tile grid (Expectancy / W/L Ratio / Best / Worst). Asymmetric badge tone: green if asymmetric, amber if symmetric. Avg-win / avg-loss / 90d-window footer. Empty state when `sample_n < 5`. |
| `src/components/dashboard/quick-stats-strip.tsx` | 4 mini-tiles: Today / Avg Confidence / Bias (L/S split, amber when |Δ| > 30) / Lifetime XP. Mobile: horizontal `snap-x snap-mandatory` carousel with the page's `-mx-4 px-4` bleed; desktop: `md:grid md:grid-cols-4`. |
| `src/components/dashboard/calibration-quick-tile.tsx` | Two-column sweet/dead-zone summary; tap-target wraps the entire card and links to `/intel?tab=calibration`. **Honesty rule (Ghost-approved)**: only buckets with WR ≥ 55 earn the green pill; 45–54 (incl. exactly 50.0) = amber + "fragile edge" sublabel; <45 = red + "below breakeven". Dead zone is always red. |

The "fragile edge" treatment was added because Phase 0 audit revealed every
real bucket is currently ≤ 50% WR (sweet=70-80 at exactly 50.0%, dead=80+
at 37.5%). A green "sweet" pill would have been dishonest.

### Composition (final, locked)

```tsx
<DashboardView>
  <HeroPnLCard />          {/* C1 */}
  <ActivePositionsCard />  {/* C1 */}
  <QuickStatsStrip />      {/* C2 */}
  <EdgeAnalysisCard />     {/* C2 */}
  <CalibrationQuickTile /> {/* C2 */}
</DashboardView>
```

Pull-to-refresh wired via `usePullToRefresh` hook from A4 (`threshold=64`,
mobile-only; `lg:hidden` indicator). On release-past-threshold the
DashboardView bumps a `refreshKey` state, which re-mounts every child via
React's reconciler; each child's mount-effect refetches its endpoint. The
indicator copy is "Pull to refresh" → "Release to refresh" → "Refreshing…".

`animate-fade-in` (token registered in A4 `globals.css:102`,
`var(--duration-fast) ease-out`) is applied to the children container so
the whole grid fades in on mount AND on refresh-key bumps.

### `dashboard-placeholder.tsx` DELETED

The former flag-OFF fallback (under-reconstruction stub) is gone. The
flag-OFF path now renders a small inline `<DashboardDisabled>` card
inside `src/app/dashboard/page.tsx` with the explicit instruction
`HUB_REDESIGN_DASHBOARD=true` in `auto_config`. This keeps the rollback
path as a small in-file render rather than a separate component file.

The flag-resolution logic in `dashboard/page.tsx` is unchanged from C1:
cookie override `hub_redesign_override=HUB_REDESIGN_DASHBOARD=true` →
`auto_config.HUB_REDESIGN_DASHBOARD` row → default false. Memoized via
React `cache()`.

### Verification (all PASS)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 errors |
| `npm run build` | clean, 49s, 3 new `/api/dashboard/*` routes registered, `/dashboard` 12.9 kB / 225 kB First Load |
| `/api/dashboard/edge` | HTTP 200, `sample_n=941` matches `SELECT COUNT(*) FROM unified_outcomes WHERE pnl_pct IS NOT NULL AND outcome_timestamp >= datetime('now','-90 days')` |
| `/api/dashboard/quick-stats` | HTTP 200, `today_signals=12` matches `SELECT COUNT(*) FROM trade_insights WHERE created_at >= datetime('now','-1 day')`; `lifetime_xp=214` matches `xp_ledger.total_after` |
| `/api/dashboard/calibration` | HTTP 200, 6 buckets matching `query_quality.py by_confidence` exactly; sweet=70-80 (50.0%), dead=80+ (37.5%) |
| `/dashboard` flag ON | HTTP 200, 31111 B, EDGE ANALYSIS=1, CALIBRATION=1 |
| `/dashboard` flag OFF | HTTP 200, 23770 B, "Temporarily Disabled" inline message; "Under Reconstruction" placeholder gone |
| Rollback flag flip both ways | PASS — flip OFF→ON→OFF cleanly switches DashboardView ↔ DashboardDisabled |
| 6/6 recurring-bug canaries POST-deploy | CLEAN (matches Phase 0 baseline exactly) |
| Open positions invariant | 0/0 active_trades + 0/0 auto_trades live (matches Phase 0 baseline) |
| Sacred 12/12 manifest | byte-identical (the 9 protected Python files + 3 brain `.md` files; `BEHAVIOR_RULES.md`+`CLAUDE.md` modified per spec, `--no-verify` per `feedback_sacred_bypass` memory) |
| `signal_filter_rules` | UNCHANGED |
| `EMERGENCY_KILLSWITCH` | unchanged false |
| `trevor.service` PID 2752692 | UNTOUCHED through whole C2 |

### Browser smoke disclosure

Per CLAUDE.md guidance — Claude Code cannot operate a real browser. API
endpoints + SSR HTML markers were verified. Visual UX (mobile carousel
swipe, pull-to-refresh gesture, fade-in transition smoothness, tap-to-
navigate calibration tile, exact mobile breakpoint widths 375 / 390 / 430
/ 768 / 1024 / 1440) **was NOT exercised in a browser**. The responsive
Tailwind classes are emitted by the production build and the components
follow A4 mobile-first conventions, but a real-device smoke is the
honest validation step Ghost will perform after merge.

### Files

**Hub repo (this commit):**
- New: `query_dashboard_edge.py`, `query_dashboard_quick_stats.py`, `query_dashboard_calibration.py`
- New: `src/app/api/dashboard/edge/route.ts`, `src/app/api/dashboard/quick-stats/route.ts`, `src/app/api/dashboard/calibration/route.ts`
- New: `src/components/dashboard/edge-analysis-card.tsx`, `src/components/dashboard/quick-stats-strip.tsx`, `src/components/dashboard/calibration-quick-tile.tsx`
- Modified: `src/components/dashboard/dashboard-view.tsx` (composition + pull-to-refresh wiring)
- Modified: `src/app/dashboard/page.tsx` (inline `<DashboardDisabled>` replaces `<DashboardPlaceholder>` flag-OFF branch)
- Deleted: `src/components/dashboard-placeholder.tsx`

**Trevor repo (sibling commit):**
- Modified: `BEHAVIOR_RULES.md` (Section 3 changelog entry — Wave C complete)

**Untouched (NOT in commit, per Ghost's additive-only decision on dirty tree):**
- `.env`, `.env.local`, `tsconfig.tsbuildinfo`, `.env.local.bak.pre_lockdown_20260424` — pre-existing local files
- All pre-existing dirty trevor/ files (training/cache parquet deletes, brain/HEARTBEAT churn, observatory_v4/, embeds.py / observability.py mods, etc.) — out of C2 scope

### What C2 does NOT do

- Does NOT modify the C1 widgets (Hero PnL, Active Positions).
- Does NOT modify `/api/quality` or `/api/analytics/confidence-tiers` (kept; deprecation candidates for Wave I if zero non-dashboard callers).
- Does NOT touch `/api/admin/current-state` or `/api/trade-stats`.
- Does NOT add the Reset Capital / Aggressive Mode / Kill UI on `/dashboard` (E1 / G2 own those).
- Does NOT implement `/intel?tab=calibration` (F3 owns that — the tile only links to it).
- Does NOT add framer-motion or any new dependency.
- Does NOT touch backend, Discord, sacred Python files, or `signal_filter_rules`.
- Does NOT change confidence weights or thresholds.
- Does NOT modify `trevor.service` — only `trevor-dashboard.service` restarted (twice: once after Phase 7 build, once after Phase 8 placeholder delete + page rewrite).

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display-only widgets. Rule 14 (sacred files) —
12/12 byte-identical. Rule 15 (additive DB) — N/A no schema changes.
Rule 16 (surgical) — only listed files staged. Rule 22 (no Discord
channels touched). Rule 30 (no ticker/direction blocks) —
`signal_filter_rules` UNCHANGED. Rule 31 (auto trader never self-pauses) —
N/A UI only. Rule 32 (KILLSWITCH-only project-wide pause; UI Stop banned)
— ENFORCED, no kill affordance on `/dashboard`. No new npm dependencies.
Honesty Protocol — sweet zone shows real `WR.toFixed(1)%` numbers with
honest tone (only ≥55 earns green); below floor renders empty state with
explicit "Need ≥5 trades" message; calibration empty bucket renders honest
"No calibration data" rather than invented placeholder. JetBrains Mono only.
Cyberpunk palette only via A4 tokens.

### Rollback

```bash
# Soft (15-second flag flip — restores DashboardDisabled inline message)
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='HUB_REDESIGN_DASHBOARD';"
# No restart required (React cache() is per-request)

# Full code revert
cd /home/trevor/trevor-dashboard && git revert <c2-hub-commit>
sudo systemctl restart trevor-dashboard.service
# Restores dashboard-placeholder.tsx and the C1 2-widget DashboardView.
```

Wave C is complete. Wave D rebuilds the AUTO zone next.

## D1 — AUTO Scalper Section Rebuild (shipped 2026-04-30)

Mobile-first vertical card stack at `/autotrader?tab=scalper`. Replaces the
pre-D1 16-component layout with a tighter 6-card composition built on A4
primitives. NO STOP / kill / pause UI anywhere — Discord `!killswitch` is
the only project-wide pause per Rule 32. New components live under
`src/components/autotrader-v2/` so the legacy namespace stays intact for
flag-flip rollback. D3 prunes the legacy directory after API consolidation.

### Composition (locked, top → bottom)

```
ScalperHeader     — status pill (LIVE/PAPER/DISABLED) + KillswitchPill mirror
CapitalHero       — equity + today P&L + trades today + open positions
ActivePositionCard — live PnL with leverage, entry/now, hold, peak, exit hint
RecentTradesCard  — last 10 closed (mode pill + ticker/dir + hold + exit + PnL%)
ConfigCard        — READ-ONLY (Capital Cap / Per-Trade / Conf Floor / Max Lev)
WatchlistGrid     — 5 sacred tickers with tier pills + per-ticker thresholds
```

`?tab=degen` routes to a passthrough of the existing `DegenSection` skeleton
(D2 paints the content). B1's ZoneSubTabs handles sub-tab navigation.

### Endpoint strategy

D1 leans on the existing root `/api/auto-trader` "kitchen sink" endpoint
(30s cache, READ-ONLY mode=ro URI) for state/capital/positions/recent-trades/
config. Only ONE new endpoint added:

| Route | Purpose | Source |
|---|---|---|
| `/api/auto-trader/per-ticker-thresholds` | Live mirror of `ticker_thresholds.py` (BTC 34/37/40, ETH 36/39/42, SOL 38/41/44, HYPE 39/42/45, FARTCOIN 42/45/48 + tier mapping BLUE_CHIP/MID_CAP/MEME) | `query_auto_per_ticker_thresholds.py` (imports `ticker_thresholds` Python module dynamically — no hardcoded drift) |

`query_auto_trader.py::_open_positions()` extended to include `peak_pnl_pct`,
`exit_signals_log`, `trade_mode` (3 columns added to existing SELECT;
READ-ONLY).

### Phase 0 audit deviations from prompt (Ghost-approved)

1. **Endpoint shape mismatch** — prompt assumed `/api/auto-trader/state`,
   `/api/auto-trader/capital`, `/api/auto-trader/active-positions`,
   `/api/auto-trader/settings`. None exist with that exact shape. Used the
   existing root `/api/auto-trader` (returns `enabled` / `equity` /
   `open_positions[]` / `recent_trades[]` / `stats_7d` / `config{}` in one
   call) for ScalperHeader + CapitalHero + ActivePositionCard + ConfigCard.
   Surface area minimized — D3 has less to consolidate.
2. **`PER_TICKER_THRESHOLDS_ENABLED` is a Python module constant**, NOT in
   `auto_config`. New `query_auto_per_ticker_thresholds.py` does runtime
   `import ticker_thresholds` and returns `getattr(tt,
   'PER_TICKER_THRESHOLDS_ENABLED', False)` — single source of truth, no
   drift between the bot pipeline and the Hub UI.
3. **ConfigCard composition adjusted** for Aggressive Mode Sweep
   (2026-04-27 removed `MAX_CONCURRENT`, `MAX_TRADES_PER_DAY`, etc.).
   Final tiles: Capital Cap (`LIVE_HARD_CAPITAL_CAP_USD`) / Per-Trade
   (`LIVE_PER_TRADE_USD`) / Conf Floor (`AGGRESSIVE_THRESHOLD`) / Max Lev
   (`LIVE_LEVERAGE_DEFAULT`). No "Max Concurrent" tile (concept removed).
4. **24h price change deferred** — prompt example referenced
   `change_24h_pct` on `/api/prices`, which only returns `{price, source,
   stale}`. WatchlistGrid renders price + thresholds only. Not in D1 scope
   to extend `/api/prices`.
5. **`BEHAVIOR_RULES.md` lives at root**, not in `brain/` (the prompt's
   §7.3 path was wrong). Used the correct path
   `/home/trevor/trevor/BEHAVIOR_RULES.md` for the changelog edit.

### Rollback (15-second flag flip)

```bash
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='HUB_REDESIGN_AUTO';"
# No restart required — server component re-reads flag every render via
# React cache() per request.
```

Cookie-only preview without flipping the global flag:
```
Cookie: hub_redesign_override=HUB_REDESIGN_AUTO%3Dtrue
```

`LegacyAutotraderView` (`src/components/autotrader/legacy-autotrader-view.tsx`)
preserves the pre-D1 sticky-title + SCALPER + DEGEN layout MINUS the
`BotNavStrip` import (the file is deleted in D1; B1's `ZoneSubTabs` handles
sub-tab navigation now). Sections stack vertically when
`HUB_REDESIGN_NAV=false` (emergency rollback only).

### Verification (all PASS)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 errors |
| `npm run build` | clean, 0 errors / 0 warnings; `/api/auto-trader/per-ticker-thresholds` registered as `ƒ` dynamic at 321 B / 102 kB |
| `/api/auto-trader/per-ticker-thresholds` | HTTP 200, all 5 tickers, exact threshold match (BTC 34/37/40, ETH 36/39/42, SOL 38/41/44, HYPE 39/42/45, FARTCOIN 42/45/48), `enabled=true` |
| `/api/auto-trader` root | HTTP 200, includes new `peak_pnl_pct` + `exit_signals_log` + `trade_mode` on open_positions (live FARTCOIN LONG `peak_pnl_pct=1.18%` confirmed) |
| `/api/auto-trader/history?limit=5` | HTTP 200 |
| `/api/feature-flags` | HTTP 200, `HUB_REDESIGN_AUTO=true` reflected |
| `/api/prices?tickers=BTC,ETH,SOL,HYPE,FARTCOIN` | HTTP 200 |
| `/autotrader` flag ON | HTTP 200, 31179 B, v2 markers visible (`Auto Capital`, `AutoTrader · 5 tickers`, `Watchlist`, `FARTCOIN`); legacy markers absent |
| `/autotrader` flag OFF | HTTP 200, 54548 B, legacy `AUTO TRADER` title visible; v2 markers absent |
| `/autotrader?tab=degen` flag ON | HTTP 200, `AWAITING CONNECTION` + `DEGEN` markers; no scalper composition |
| Rollback flip OFF→ON→OFF→ON | bidirectional clean (54548 B legacy ↔ 31179 B v2) |
| All other zones (dashboard / scalp / intel / memory / chat) | HTTP 200 |
| Open auto positions baseline | unchanged: 1 live (FARTCOIN LONG) — pre-Phase-0 == post-deploy |
| Sacred manifest | 12/12 byte-identical (`BEHAVIOR_RULES.md` + `CLAUDE.md` modified per spec, expected manifest miss; `--no-verify` per memory `feedback_sacred_bypass`) |
| `signal_filter_rules` | UNCHANGED |
| 6/6 recurring-bug canaries POST-deploy | CLEAN (canary 6 hit at `discord_bot.py:9272` is the pre-existing legitimate Rule-8 sentinel auto-delete pattern, same as Phase 0 baseline) |
| STOP/Kill audit on `src/components/autotrader-v2/` | EMPTY — no kill UI anywhere |
| `trevor.service` | UNTOUCHED — PID 2752692, ActiveEnterTimestamp 2026-04-29 20:33:21 UTC unchanged |
| `trevor-dashboard.service` | restart healthy, PID → 2787987, NRestarts=0, Hub ready in ~2s |

### Browser smoke disclosure

Per CLAUDE.md guidance — Claude Code cannot operate a real browser. SSR
HTML markers + every API endpoint were verified via authenticated curl.
Visual UX (mobile breakpoints 375 / 390 / 430 / 768 / 1024 / 1440, fade-in
animation smoothness, tap-to-interact, layout density on real devices)
**was NOT exercised in a browser**. The components follow A4 mobile-first
conventions and the production build emits the responsive Tailwind
classes, but a real-device smoke is the honest validation step Ghost
performs after merge.

### Files

**Hub repo (this commit):**
- New: `src/components/autotrader-v2/{scalper-view,scalper-header,capital-hero,active-position-card,recent-trades-card,config-card,watchlist-grid}.tsx`
- New: `src/components/autotrader/legacy-autotrader-view.tsx`
- New: `src/app/api/auto-trader/per-ticker-thresholds/route.ts`
- New: `query_auto_per_ticker_thresholds.py`
- Modified: `src/app/autotrader/page.tsx` (rewritten as server-component flag selector)
- Modified: `query_auto_trader.py` (extended `_open_positions()` SELECT with 3 columns: `peak_pnl_pct`, `exit_signals_log`, `trade_mode`)
- Modified: `CLAUDE.md` (this section)
- Deleted: `src/components/autotrader/BotNavStrip.tsx` (B1's ZoneSubTabs replaces it)

**Trevor repo (sibling commit, --no-verify per `feedback_sacred_bypass`):**
- Modified: `BEHAVIOR_RULES.md` (Section 3 changelog entry)

### What D1 does NOT do

- Does NOT fill in DEGEN sub-tab (D2).
- Does NOT consolidate `/api/auto-trader/*` routes (D3).
- Does NOT delete `src/components/autotrader/` directory (D3, after API consolidation).
- Does NOT change confidence weights, calibration, or per-ticker threshold values (sacred — `!filter` Discord command only).
- Does NOT modify `signal_filter_rules`.
- Does NOT introduce any new edit affordance — `ConfigCard` and `WatchlistGrid` are READ-ONLY.
- Does NOT touch backend, Discord, or sacred Python files.
- Does NOT modify `trevor.service` — only `trevor-dashboard.service` restarted.

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display-only restructure. Rule 14 (sacred files)
— 12/12 byte-identical (`BEHAVIOR_RULES.md` + `CLAUDE.md` modified per
spec via `--no-verify` per memory `feedback_sacred_bypass`). Rule 15
(additive DB) — N/A no schema changes. Rule 16 (surgical edits) — only
listed files staged. Rule 22 (no Discord channels touched). Rule 30 (no
ticker/direction blocks) — `signal_filter_rules` UNCHANGED. Rule 31 (auto
trader never self-pauses) — N/A UI only. Rule 32 (KILLSWITCH-only
project-wide pause; UI Stop buttons banned) — ENFORCED, no kill
affordance on `/autotrader`. No new npm dependencies. JetBrains Mono
only. Cyberpunk palette only via A4 tokens. Mobile-first verified at
375vw via SSR HTML markup.

D1 ships the Scalper bones. D2 paints DEGEN. D3 collapses the API
surface.

## D1 — AUTO Scalper Section Rebuild (shipped 2026-04-30)

Mobile-first vertical card stack at `/autotrader?tab=scalper`. Replaces the
pre-D1 16-component layout with a tighter 6-card composition built on A4
primitives. NO STOP / kill / pause UI anywhere — Discord `!killswitch` is
the only project-wide pause per Rule 32. New components live under
`src/components/autotrader-v2/` so the legacy namespace stays intact for
flag-flip rollback. D3 prunes the legacy directory after API consolidation.

### Composition (locked, top → bottom)

```
ScalperHeader     — status pill (LIVE/PAPER/DISABLED) + KillswitchPill mirror
CapitalHero       — equity + today P&L + trades today + open positions
ActivePositionCard — live PnL with leverage, entry/now, hold, peak, exit hint
RecentTradesCard  — last 10 closed (mode pill + ticker/dir + hold + exit + PnL%)
ConfigCard        — READ-ONLY (Capital Cap / Per-Trade / Conf Floor / Max Lev)
WatchlistGrid     — 5 sacred tickers with tier pills + per-ticker thresholds
```

`?tab=degen` routes to a passthrough of the existing `DegenSection` skeleton
(D2 paints the content). B1's ZoneSubTabs handles sub-tab navigation.

### Endpoint strategy

D1 leans on the existing root `/api/auto-trader` "kitchen sink" endpoint
(30s cache, READ-ONLY mode=ro URI) for state/capital/positions/recent-trades/
config. Only ONE new endpoint added:

| Route | Purpose | Source |
|---|---|---|
| `/api/auto-trader/per-ticker-thresholds` | Live mirror of `ticker_thresholds.py` (BTC 34/37/40, ETH 36/39/42, SOL 38/41/44, HYPE 39/42/45, FARTCOIN 42/45/48 + tier mapping BLUE_CHIP/MID_CAP/MEME) | `query_auto_per_ticker_thresholds.py` (imports `ticker_thresholds` Python module dynamically — no hardcoded drift) |

`query_auto_trader.py` `_open_positions()` extended to include `peak_pnl_pct`,
`exit_signals_log`, `trade_mode` (3 columns added; READ-ONLY).

### Phase 0 audit deviations from prompt (Ghost-approved)

1. **Endpoint shape mismatch** — prompt assumed `/api/auto-trader/state`,
   `/api/auto-trader/capital`, `/api/auto-trader/active-positions`,
   `/api/auto-trader/settings`. None exist with that exact shape. Used the
   existing root `/api/auto-trader` (returns `enabled` / `equity` /
   `open_positions[]` / `recent_trades[]` / `stats_7d` / `config{}` in one
   call) for ScalperHeader + CapitalHero + ActivePositionCard + ConfigCard.
   Surface area minimized — D3 has less to consolidate.
2. **`PER_TICKER_THRESHOLDS_ENABLED` is a Python module constant**, NOT in
   `auto_config`. New `query_auto_per_ticker_thresholds.py` does runtime
   `import ticker_thresholds` and returns `getattr(tt,
   'PER_TICKER_THRESHOLDS_ENABLED', False)` — single source of truth, no
   drift between the bot pipeline and the Hub UI.
3. **ConfigCard composition adjusted** for Aggressive Mode Sweep
   (2026-04-27 removed `MAX_CONCURRENT`, `MAX_TRADES_PER_DAY`, etc.).
   Final tiles: Capital Cap (`LIVE_HARD_CAPITAL_CAP_USD`) / Per-Trade
   (`LIVE_PER_TRADE_USD`) / Conf Floor (`AGGRESSIVE_THRESHOLD`) / Max Lev
   (`LIVE_LEVERAGE_DEFAULT`). No "Max Concurrent" tile (concept removed).
4. **24h price change deferred** — prompt example referenced
   `change_24h_pct` on `/api/prices`, which only returns `{price, source,
   stale}`. WatchlistGrid renders price + thresholds only. Not in D1 scope
   to extend `/api/prices`.
5. **`BEHAVIOR_RULES.md` lives at root**, not in `brain/` (the prompt's
   §7.3 path was wrong). Used the correct path
   `/home/trevor/trevor/BEHAVIOR_RULES.md` for the changelog edit.

### Rollback path (15-second flag flip)

```bash
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='HUB_REDESIGN_AUTO';"
# No restart required — server component re-reads flag every render.
```

Cookie-only preview without flipping the global flag:
```
Cookie: hub_redesign_override=HUB_REDESIGN_AUTO%3Dtrue
```

`LegacyAutotraderView` (under `src/components/autotrader/legacy-autotrader-view.tsx`)
preserves the pre-D1 sticky-title + SCALPER + DEGEN layout MINUS the
`BotNavStrip` import (the file is deleted in D1; B1's `ZoneSubTabs`
handles sub-tab navigation now). Sections stack vertically when
`HUB_REDESIGN_NAV=false` (emergency rollback only).

### Verification (all PASS)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 errors |
| `npm run build` | clean, 0 errors / 0 warnings |
| `/api/auto-trader/per-ticker-thresholds` | HTTP 200, all 5 tickers, exact threshold match (BTC 34/37/40, ETH 36/39/42, SOL 38/41/44, HYPE 39/42/45, FARTCOIN 42/45/48), `enabled=true` |
| `/api/auto-trader` root | HTTP 200, includes new `peak_pnl_pct` + `exit_signals_log` + `trade_mode` on open_positions (FARTCOIN LONG live peak +1.18% confirmed) |
| `/api/auto-trader/history?limit=5` | HTTP 200 |
| `/api/feature-flags` | HTTP 200, `HUB_REDESIGN_AUTO=true` reflected |
| `/api/prices?tickers=BTC,ETH,SOL,HYPE,FARTCOIN` | HTTP 200 |
| `/autotrader` flag ON | HTTP 200, 31179 B, v2 markers visible (`Auto Capital`, `AutoTrader · 5 tickers`, `Watchlist`, `FARTCOIN`); legacy markers absent |
| `/autotrader` flag OFF | HTTP 200, 54548 B, legacy `AUTO TRADER` title visible; v2 markers absent |
| `/autotrader?tab=degen` flag ON | HTTP 200, `AWAITING CONNECTION` + `DEGEN` markers; no scalper composition |
| `/autotrader?tab=scalper` flag ON | HTTP 200 |
| Rollback flip OFF→ON→OFF→ON | bidirectional clean (54548 B legacy ↔ 31179 B v2) |
| All other zones (dashboard / scalp / intel / memory / chat) | HTTP 200 |
| Open auto positions baseline | unchanged: 1 live (FARTCOIN LONG) — pre-Phase-0 == post-deploy |
| Sacred manifest | 12/12 byte-identical (`BEHAVIOR_RULES.md` + `CLAUDE.md` modified per spec, expected manifest miss) |
| `signal_filter_rules` | UNCHANGED |
| 6/6 recurring-bug canaries POST-deploy | CLEAN (canary 6 hit at `discord_bot.py:9272` is the pre-existing legitimate Rule-8 sentinel auto-delete pattern, same as Phase 0 baseline) |
| STOP/Kill audit on `src/components/autotrader-v2/` | EMPTY — no kill UI anywhere |
| `trevor.service` | UNTOUCHED — PID 2752692, ActiveEnterTimestamp 2026-04-29 20:33:21 UTC unchanged |
| `trevor-dashboard.service` | restart healthy, PID → 2787987, NRestarts=0, Hub ready in ~2s |

### Browser smoke disclosure

Per CLAUDE.md guidance — Claude Code cannot operate a real browser. SSR
HTML markers + every API endpoint were verified via authenticated curl.
Visual UX (mobile breakpoints 375 / 390 / 430 / 768 / 1024 / 1440, fade-in
animation smoothness, tap-to-interact, layout density on real devices)
**was NOT exercised in a browser**. The components follow A4 mobile-first
conventions and the production build emits the responsive Tailwind classes,
but a real-device smoke is the honest validation step Ghost performs after
merge.

### Files

**Hub repo (this commit):**
- New: `src/components/autotrader-v2/{scalper-view,scalper-header,capital-hero,active-position-card,recent-trades-card,config-card,watchlist-grid}.tsx`
- New: `src/components/autotrader/legacy-autotrader-view.tsx`
- New: `src/app/api/auto-trader/per-ticker-thresholds/route.ts`
- New: `query_auto_per_ticker_thresholds.py`
- Modified: `src/app/autotrader/page.tsx` (rewritten as server-component flag selector)
- Modified: `query_auto_trader.py` (extended `_open_positions()` SELECT with 3 columns)
- Modified: `CLAUDE.md` (this section)
- Deleted: `src/components/autotrader/BotNavStrip.tsx` (B1's ZoneSubTabs replaces it)

**Trevor repo (sibling commit, --no-verify per `feedback_sacred_bypass`):**
- Modified: `BEHAVIOR_RULES.md` (Section 3 changelog entry)

### What D1 does NOT do

- Does NOT fill in DEGEN sub-tab (D2).
- Does NOT consolidate `/api/auto-trader/*` routes (D3).
- Does NOT delete `src/components/autotrader/` directory (D3, after API consolidation).
- Does NOT change confidence weights, calibration, or per-ticker threshold values (sacred — `!filter` Discord command only).
- Does NOT modify `signal_filter_rules`.
- Does NOT introduce any new edit affordance — `ConfigCard` and `WatchlistGrid` are READ-ONLY.
- Does NOT touch backend, Discord, or sacred Python files.
- Does NOT modify `trevor.service` — only `trevor-dashboard.service` restarted.

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display-only restructure. Rule 14 (sacred files)
— 12/12 byte-identical (`BEHAVIOR_RULES.md` + `CLAUDE.md` modified per spec
via `--no-verify` per memory `feedback_sacred_bypass`). Rule 15 (additive
DB) — N/A no schema changes. Rule 16 (surgical edits) — only listed files
staged. Rule 22 (no Discord channels touched). Rule 30 (no ticker/direction
blocks) — `signal_filter_rules` UNCHANGED. Rule 31 (auto trader never
self-pauses) — N/A UI only. Rule 32 (KILLSWITCH-only project-wide pause;
UI Stop buttons banned) — ENFORCED, no kill affordance on `/autotrader`.
No new npm dependencies. JetBrains Mono only. Cyberpunk palette only via
A4 tokens. Mobile-first verified at 375vw via SSR HTML markup.


## D3 — AUTO API Consolidation + Legacy Cleanup (shipped 2026-04-30)

Collapsed the `/api/auto-trader/*` route surface from 11 routes (10 sub-paths
+ base) into 3 consolidated `/api/auto/*` endpoints. Migrated D1 components,
deleted the legacy `src/components/autotrader/` directory + 6 orphaned
helpers + 2 orphaned hook/lib files. Wave D complete: AUTO zone end-to-end
redesigned (D1 frontend, D2 DEGEN slot, D3 backend).

### Phase 0 audit deviations from prompt (Ghost-approved)

The D3 prompt was written against a route inventory that did not match the
real codebase (it assumed `/api/auto-trader/{capital,settings,active-positions,
state,circuit-breaker,capital-cap,system-health}` — none of which exist).
The actual surface was 10 sub-routes + a `/api/auto-trader` (base). Phase 0
audit re-mapped to reality:

1. **Real consolidation map** — `/api/auto-trader` (base) → `/api/auto/state`;
   `/api/auto-trader/history` → `/api/auto/trades?type=closed&limit=10`;
   `/api/auto-trader/per-ticker-thresholds` → `/api/auto/config`. The other 8
   routes (`config`, `equity-curve`, `activity`, `analytics`, `per-ticker`,
   `scan-status`, `slippage`, `stream`) were consumed only by the legacy
   `src/components/autotrader/` directory and had ZERO consumers after §5
   delete — so they were deleted outright instead of redirected.
2. **Hardcoded thresholds replaced with runtime import** — the prompt's draft
   `query_auto_config.py` hardcoded BTC/ETH/SOL/HYPE/FARTCOIN values; instead
   the new helper does `import ticker_thresholds` at runtime, matching the
   pattern from `query_auto_per_ticker_thresholds.py`. Single source of
   truth, no drift.
3. **Dropped `scanner_active`** from `/api/auto/state` — no real source
   exists (`/home/trevor/trevor/state/system_health.json` doesn't exist),
   prompt's fallback would have always returned `True`. Honesty over
   placeholder.
4. **`/api/auto/config` is READ-ONLY** — the legacy `/api/auto-trader/config`
   was CRUD with PUT for 9 whitelisted keys; D3 drops the writer with the
   legacy directory delete. Codifies the existing rule that AUTO config
   changes happen via `auto_trader/config.py` or direct `auto_config` writes,
   never via Hub UI.
5. **Redirect mechanism: `next.config.ts` `redirects()` not route-handler 308**
   — `NextResponse.redirect(new URL(..., req.url))` and
   `req.nextUrl.clone()` both emitted `localhost:3000` Locations under our
   port-3333 custom server. The framework-level `next.config.ts redirects()`
   emits relative-path Location headers, which curl follows correctly to
   200. Confirmed bidirectional smoke.
6. **Single deploy** — Ghost approved skipping the prompt's two-step ("ship
   real handlers → smoke → flip to redirects"). Wrote new routes + config
   redirects + deletes in one pass, smoked once.
7. **Repo cleanliness** — Ghost approved option (i): only stage D3-specific
   files in the dashboard commit; the dirty trevor/ training/cache parquet
   churn stays out of scope (handled separately by Ghost).

### New endpoints (3)

| Route | Purpose | Helper |
|---|---|---|
| `/api/auto/state` | capital, equity, today's P&L (live), trades_today, open_positions_count, auto/live/killswitch flags, per_ticker_thresholds_enabled | `query_auto_state.py` |
| `/api/auto/trades?type=open\|closed&limit=N` | open positions OR last N closed (live mode only); limit clamped to 1..200, default 10 | `query_auto_trades.py` |
| `/api/auto/config` | capital_cap_usd, live_per_trade_usd, confidence_floor, max_leverage, per_ticker_thresholds_enabled, per_ticker_thresholds[] | `query_auto_config.py` (runtime import from `ticker_thresholds.py`) |

All three open SQLite read-only via `file:...?mode=ro`. Routes use `runPython`
helper from `@/lib/api-helpers` (5s timeout). Fail-safe error path returns
the empty shape with HTTP 200 + `data_available: false`.

### Legacy → consolidated map (308 redirects in `next.config.ts`)

```
/api/auto-trader                       → /api/auto/state                    (308)
/api/auto-trader/history               → /api/auto/trades?type=closed&limit=10 (308)
/api/auto-trader/per-ticker-thresholds → /api/auto/config                   (308)
```

### Deleted outright (legacy-only consumers, gone with src/components/autotrader/)

- `/api/auto-trader/config` (was CRUD; PUT consumer was legacy ConfigPanel)
- `/api/auto-trader/equity-curve` (was legacy HeaderBar + AnalyticsSection)
- `/api/auto-trader/activity` (was legacy ActivityFeed)
- `/api/auto-trader/analytics` (was legacy AnalyticsSection)
- `/api/auto-trader/per-ticker` (was legacy PerTickerCards)
- `/api/auto-trader/scan-status` (was legacy ScanningEmptyState)
- `/api/auto-trader/slippage` (was legacy SlippageHistogram)
- `/api/auto-trader/stream` (SSE; was legacy AutoTraderPage via useAutoTraderStream hook)

Plus 9 orphaned Python helpers: `query_auto_trader.py`,
`query_auto_trader_history.py`, `query_auto_trader_activity.py`,
`query_auto_trader_per_ticker.py`, `query_auto_trader_scan_status.py`,
`query_auto_trader_slippage.py`, `query_auto_per_ticker_thresholds.py`,
`query_auto_trader_live.py`, `query_auto_trader_config.py`.

Plus orphaned frontend: entire `src/components/autotrader/` directory
(16 files), `src/hooks/useAutoTraderStream.ts`, `src/lib/bots.ts`.

### Component migration

All 6 D1 `autotrader-v2/` components now read from the new endpoints:

| Component | Old fetch | New fetch |
|---|---|---|
| `scalper-header.tsx` | `/api/auto-trader` (base) | `/api/auto/state` |
| `capital-hero.tsx` | `/api/auto-trader` (base) | `/api/auto/state` |
| `config-card.tsx` | `/api/auto-trader` (base) + `/api/auto-trader/per-ticker-thresholds` | `/api/auto/config` (single fetch) |
| `active-position-card.tsx` | `/api/auto-trader` (base) → `j.open_positions` | `/api/auto/trades?type=open&limit=10` → `j.positions` |
| `recent-trades-card.tsx` | `/api/auto-trader/history?limit=10` → `j.trades` | `/api/auto/trades?type=closed&limit=10` → `j.trades` |
| `watchlist-grid.tsx` | `/api/auto-trader/per-ticker-thresholds` → `j.thresholds` | `/api/auto/config` → `j.per_ticker_thresholds` |

`config-card.tsx` collapsed from 2 fetches to 1. `capital-hero.tsx` no
longer filters `recent_trades` client-side for "today" — it reads
server-computed `pnl_today_usd` + `pnl_today_pct` + `trades_today` directly.

### `src/app/autotrader/page.tsx` simplified

Dropped the flag-resolution logic (cookies override + `query_feature_flags.py`
lookup + `LegacyAutotraderView` fallback). Page is now a 12-line server
component that always renders `<ScalperViewV2 subtab={tab ?? "scalper"} />`.
Rollback path is `git revert <D3-commit>` (the legacy components are gone;
flag-flip rollback no longer applies).

### Verification (all PASS)

| Check | Result |
|---|---|
| `npm run build` | clean, 0 errors / 0 warnings |
| `/api/auto/state` | HTTP 200; SQL cross-check: `pnl_today_usd=-1.5323` matches SQL exactly, `trades_today=20` matches, `open_positions_count=0` matches, `equity=35.3435` matches `50 + SUM(pnl_usd)` |
| `/api/auto/trades?type=open&limit=10` | HTTP 200, returns `{type:"open", count:0, positions:[]}` |
| `/api/auto/trades?type=closed&limit=10` | HTTP 200, returns 10 trades with all expected columns (id, ticker, direction, pnl_pct, pnl_usd, hold_duration_minutes, closed_at, exit_reason, trade_mode) |
| `/api/auto/config` | HTTP 200, all 5 tickers present (BTC 34/37/40, ETH 36/39/42, SOL 38/41/44, HYPE 39/42/45, FARTCOIN 42/45/48), `per_ticker_thresholds_enabled=true` |
| 3 redirect routes | HTTP 308 with relative `Location:`; following redirect lands on 200 |
| 8 deleted routes | HTTP 404 |
| `/autotrader` flag ON | HTTP 200; HTML markers: Auto Capital=1, AutoTrader · 5 tickers=1, Watchlist=1, FARTCOIN=1; STOP/Kill audit empty |
| `/autotrader?tab=degen` | HTTP 200 |
| All other zones (`/dashboard`, `/scalp`, `/intel`, `/memory`, `/chat`) | HTTP 200 |
| Open positions baseline | unchanged: 0 (matches Phase 0 baseline) |
| `signal_filter_rules` | UNCHANGED |
| 6/6 recurring-bug canaries POST-deploy | CLEAN (C1 portfolio_manager.py allowlisted; C2 `safe_delete.py`/`message_tracker.py`/`signal_confidence_monitor.py` are benign — last is a `threshold` regex match; C6 `discord_bot.py:9272` is the legitimate Rule-8 sentinel auto-delete pattern) |
| `trevor.service` | UNTOUCHED — PID 2752692, ActiveEnterTimestamp 2026-04-29 20:33:21 UTC unchanged |
| `trevor-dashboard.service` | restart healthy (PID → 2863622, NRestarts=0); 0 error events in journal |

### Browser smoke disclosure

Per CLAUDE.md guidance — Claude Code cannot operate a real browser. SSR
HTML markers + every endpoint + redirect chain were verified via
authenticated curl. Visual UX (mobile breakpoints 375 / 390 / 430 / 768 /
1024 / 1440, fade-in animation smoothness, pull-to-refresh, exact pixel
positioning) **was NOT exercised in a browser**. The components follow
A4 mobile-first conventions and the production build emits the responsive
Tailwind classes; real-device smoke is the honest validation step Ghost
performs after merge.

### Files

**Hub repo (this commit):**
- New: `query_auto_state.py`, `query_auto_trades.py`, `query_auto_config.py`
- New: `src/app/api/auto/state/route.ts`, `src/app/api/auto/trades/route.ts`, `src/app/api/auto/config/route.ts`
- Modified: `next.config.ts` (added 3 D3 redirect entries)
- Modified: `src/app/autotrader/page.tsx` (simplified to 12-line server component)
- Modified: `src/components/autotrader-v2/{scalper-header,capital-hero,config-card,active-position-card,recent-trades-card,watchlist-grid}.tsx` (endpoint migration + envelope updates)
- Modified: `CLAUDE.md` (this section)
- Deleted: `src/app/api/auto-trader/{route.ts,history/,per-ticker-thresholds/,config/,equity-curve/,activity/,analytics/,per-ticker/,scan-status/,slippage/,stream/}`
- Deleted: `query_auto_trader.py`, `query_auto_trader_history.py`, `query_auto_trader_activity.py`, `query_auto_trader_per_ticker.py`, `query_auto_trader_scan_status.py`, `query_auto_trader_slippage.py`, `query_auto_per_ticker_thresholds.py`, `query_auto_trader_live.py`, `query_auto_trader_config.py`
- Deleted: `src/components/autotrader/` (entire directory: ActivityFeed, AnalyticsSection, AutoTraderPage, BotSectionHeader, ConfigPanel, DegenSection, EquityCurveChart, HeaderBar, PerTickerCards, PnlByExitReasonChart, PositionCard, ScanningEmptyState, SlippageHistogram, TradeHistoryTable, WinRateByTickerChart, legacy-autotrader-view)
- Deleted: `src/hooks/useAutoTraderStream.ts`, `src/lib/bots.ts`

**Trevor repo (sibling commit, --no-verify per `feedback_sacred_bypass`):**
- Modified: `BEHAVIOR_RULES.md` (Section 3 changelog entry + new AUTO API contract block)

`HUB_REDESIGN_AUTO_API` flag flipped to `'true'` in `auto_config` for
documentation; the new routes are unconditionally live (no flag gating —
rollback is `git revert`).

### What D3 does NOT do

- Does NOT modify the AUTO frontend layout (D1).
- Does NOT redesign DEGEN slot (D2).
- Does NOT change confidence weights, calibration, thresholds.
- Does NOT touch sacred files, Discord, backend bot.
- Does NOT add POST/PUT/DELETE to any new route (`/api/auto/config` is GET-only).
- Does NOT deploy DEGEN bot (Wave J).
- Does NOT modify `trevor.service` — only `trevor-dashboard.service` restarted (twice during phase 4 + once final).

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — backend consolidation only, zero trade-closing
code touched. Rule 14 (sacred files) — 12/12 byte-identical (`CLAUDE.md`
+ `BEHAVIOR_RULES.md` modified per D3 spec via `--no-verify` per memory
`feedback_sacred_bypass`). Rule 15 (additive DB) — only existing
`HUB_REDESIGN_AUTO_API` row's value UPDATEd. Rule 16 (surgical edits) —
only D3-scoped files staged (parquet/observatory/embeds.py drift in trevor/
intentionally NOT staged per Ghost's option (i)). Rule 22 (no Discord
channels touched). Rule 30 (no ticker/direction blocks) —
`signal_filter_rules` UNCHANGED. Rule 31 (auto trader never self-pauses)
— N/A backend only. Rule 32 (KILLSWITCH-only project-wide pause; UI Stop
banned) — ENFORCED, no kill affordance added; D1's `/autotrader` STOP
audit empty. No new npm dependencies. Open positions invariant: 0 → 0
unchanged through entire D3.

### Rollback

```bash
cd /home/trevor/trevor-dashboard
git revert <D3-commit>
sudo systemctl restart trevor-dashboard.service
# Restores 9 deleted query helpers, 8 deleted route handlers, 16 legacy
# components, useAutoTraderStream hook, bots.ts lib, page.tsx flag-checker.
# trevor.service untouched either way.
```

Wave D is complete. Wave E (SCALP zone) is next.


## E1 — SCALP Zone Rebuild (shipped 2026-04-30)

Replaces the B1 placeholder at `/scalp` with a 4-sub-tab zone composition
on A4 primitives. Live Board (default) / Recent Signals / Quality /
Calibration. Manual ENTER flow is preserved (existing `/api/live-board/enter`
→ `hub_commands` queue → bot creates active trade) but now **server-side
killswitch-gated** at the Python helper. Reset Capital / P&L Stats / XP
buttons relocated from Dashboard to SCALP per Ghost's brief — they live
exclusively at the bottom of the Calibration sub-tab now. NO STOP / Kill /
Halt button anywhere on `/scalp` — Discord `!killswitch` is the only
project-wide pause per Rule 32.

### Phase 0 audit deviations from prompt (4 Ghost-approved)

1. **Reset endpoint shape** — prompt assumed `{confirmed: true}` body and 4
   destructive endpoints. Real shape: `{confirmText: "RESET"}` (typed
   string, much stronger confirmation), and `reset-history` is GET-only
   audit log, NOT a destructive wipe. UI ships **3 destructive resets**,
   not 4. Confirmation requires typing the literal "RESET" into a text
   input (server enforces match exactly).
2. **ENTER endpoint** — `/api/trades/enter` doesn't exist. The proven path
   is `/api/live-board/enter` → `query_live_board.py enter` → INSERT into
   `hub_commands` table → `discord_bot.py:1433` ENTER handler creates the
   active trade with default 1x lev / 20% raw stop / 50% target / 90min
   hold. EnterSheet uses this exact contract.
3. **Migration strategy** — kept `src/components/trades/*` (2127 lines of
   working legacy) untouched. Built `src/components/scalp/*` from scratch
   on A4 primitives. The legacy `trades/` directory has no consumers
   post-E1 (the only consumer was the deleted `/trading` page); I1 prunes
   it after Wave I verification. Reduces blast radius vs. in-place
   rewrite.
4. **Killswitch gate** — added at `query_live_board.py:enter_trade()`,
   NOT at the bot-side `hub_commands` ENTER handler. Frontend disables
   ENTER button + amber banner via `/api/killswitch` poll; backend
   Python gate calls `auto_trader.killswitch.is_killswitch_on()` and
   `acknowledge_blocked_signal()`, returns `{error: "killswitch on",
   blocked: true}`. The route forwards 423 Locked when `data.blocked ===
   true`. Defense-in-depth: even if a stale frontend POSTs while
   killswitch is on, no `hub_commands` row gets created.

### Composition (locked, top → bottom by sub-tab)

```
/scalp?tab=live-board (default)
  └─ LiveBoardSection
     ├─ Card glow=cyan|amber (LIVE / STANDBY pill, killswitch-aware)
     ├─ Per-ticker tile rows (price + LONG/SHORT pill + confidence pill + insight)
     ├─ ENTER HapticButton per row (disabled+Lock icon when killswitch on)
     ├─ Amber banner when killswitch ON
     └─ EnterSheet BottomSheet (LONG/SHORT toggle + confirm)

/scalp?tab=recent
  └─ RecentSignalsSection
     └─ Card → list of last 50 signals from /api/signals?scope=list&limit=50

/scalp?tab=quality
  └─ QualitySection
     └─ Card → 4 confidence-tier cards (<45 / 45-54 / 55-64 / 65+)
        from /api/analytics/confidence-tiers (active_trades closed)

/scalp?tab=calibration
  ├─ CalibrationSection
  │  └─ Card glow=cyan → sweet/dead zone callouts + 6 bucket WR bars
  │     from /api/dashboard/calibration (unified_outcomes view)
  └─ ResetControlsCard  ← new home for reset buttons
     ├─ 3 buttons: Reset Capital / Reset P&L Stats / Reset XP
     └─ BottomSheet 2-tap confirmation:
        - Type "RESET" string to enable Confirm
        - Reset Capital also exposes newCapital numeric input ($50 default)
        - Destructive (XP) shows red AlertTriangle
```

`ScalpZoneView` is a pure dispatcher — no header chrome, no sub-tab strip
(those are AppShell-level via B1's `<ZoneSubTabs />`). Renders one section
component based on the `?tab=` param.

### Server-side killswitch gate (defense-in-depth)

```python
# query_live_board.py:enter_trade
try:
    from auto_trader.killswitch import is_killswitch_on, acknowledge_blocked_signal
    if is_killswitch_on():
        try:
            acknowledge_blocked_signal(ticker=t, direction=d, signal_id=None)
        except Exception:
            pass
        print(json.dumps({
            "error": "killswitch on",
            "blocked": True,
            "message": "Manual ENTER blocked — Discord !killswitch off to resume",
        }))
        return
except Exception:
    pass  # fail OPEN; bot-side will catch if needed
```

```typescript
// src/app/api/live-board/enter/route.ts
if (data.blocked === true) {
  return NextResponse.json(data, { status: 423 });  // Locked
}
if (data.error) {
  return NextResponse.json(data, { status: 400 });
}
```

The `[KILLSWITCH-BLOCKED]` WARNING sentinel fires from the helper process
(verified directly); subprocess loguru output is captured via `runPython`
spawnSync stderr. Future enhancement could pipe that through to systemd
journal for Observatory monitoring.

### Reset Controls contract

3 buttons in a 1×3 grid (md:grid-cols-3), all gated on **typed `"RESET"`
confirmation**:

| Button | Endpoint | Body | Effect |
|---|---|---|---|
| Reset Capital | POST `/api/admin/reset-capital` | `{newCapital, confirmText:"RESET"}` | INSERT `capital_resets` row + UPDATE `trevor_config.trading_capital` |
| Reset P&L Stats | POST `/api/admin/reset-pnl-stats` | `{confirmText:"RESET"}` | INSERT pnl_stats cutoff marker |
| Reset XP | POST `/api/admin/reset-xp` | `{confirmText:"RESET"}` | INSERT xp cutoff marker (display-only; xp_ledger preserved) |

Reset Capital includes a `newCapital` numeric input defaulting to `50`.
Reset XP shows a red AlertTriangle warning ("CANNOT be undone") in the
BottomSheet. NEITHER reset closes positions (Rule 1).

`reset-history` (GET) is the audit log — not surfaced as a destructive
button. Prompt's "Reset Trade History" was a misread of the endpoint
inventory.

### Verification (all PASS)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 errors |
| `npm run build` | clean, 49s, `/scalp` 5.58 kB / 118 kB First Load (was 1.91 kB B1 placeholder) |
| `/scalp?tab=live-board` flag ON | HTTP 200, "LIVE BOARD" marker present |
| `/scalp?tab=recent` flag ON | HTTP 200, "RECENT SIGNALS" marker present |
| `/scalp?tab=quality` flag ON | HTTP 200, "SIGNAL QUALITY" marker present |
| `/scalp?tab=calibration` flag ON | HTTP 200, "CALIBRATION" + "RESET CONTROLS" markers present |
| `/api/live-board` | HTTP 200 |
| `/api/killswitch` | HTTP 200 |
| `/api/signals?scope=list&limit=5` | HTTP 200 |
| `/api/analytics/confidence-tiers` | HTTP 200 |
| `/api/dashboard/calibration` | HTTP 200 |
| Reset endpoints, `{}` body | HTTP 400 `{"error":"Confirmation text must be exactly 'RESET'"}` |
| Reset endpoints, `{"confirmText":"OOPS"}` | HTTP 400 (same validation rejection) |
| Killswitch ON + POST `/api/live-board/enter` | **HTTP 423 `{"error":"killswitch on","blocked":true}` ✓** |
| `[KILLSWITCH-BLOCKED]` sentinel via direct helper invocation | WARNING fires (loguru captured via spawnSync stderr) |
| `hub_commands` rows in last 2h | 0 (gate prevented INSERT during smoke) |
| Rollback: flag OFF → `/scalp` | 25237 B "Temporarily Disabled" inline |
| Rollback: flag ON → `/scalp` | 26792 B with "LIVE BOARD" marker |
| STOP/Kill audit on `/scalp` (all 4 sub-tabs) | only "killswitch" word — in honest copy "Project-wide pause is Discord `!killswitch`, not a button on this page". No kill button. |
| 6/6 recurring-bug canaries POST-deploy | CLEAN (C1 `portfolio_manager.py` Ghost-driven close path; C6 `discord_bot.py:9272` legitimate Rule-8 sentinel auto-delete) |
| Open positions baseline | active=0 (matches Phase 0); auto_live=1 (FARTCOIN SHORT opened naturally by bot at 21:20:48 UTC during Phase 0→Phase 5 window — NOT from E1 testing; verified via `hub_commands` table 0 rows) |
| `signal_filter_rules` | UNCHANGED |
| Sacred 12/12 manifest | byte-identical (`BEHAVIOR_RULES.md`+`CLAUDE.md` modified per spec, `--no-verify` per `feedback_sacred_bypass`) |
| `trevor.service` | UNTOUCHED |
| `trevor-dashboard.service` | restart healthy, PID 2876853, NRestarts=0, Hub ready in 3s |

### Browser smoke disclosure

Per CLAUDE.md guidance — Claude Code cannot operate a real browser. SSR
HTML markers + every endpoint were verified via authenticated curl. Visual
UX (mobile breakpoints 375 / 390 / 430 / 768 / 1024 / 1440, BottomSheet
slide-up animation, EnterSheet LONG/SHORT toggle, typed-RESET
confirmation flow, pull-to-refresh, exact tile rendering with live data)
**was NOT exercised in a browser**. The components follow A4 mobile-first
conventions and the production build emits the responsive Tailwind
classes; real-device smoke is the honest validation step Ghost performs
after merge.

### Files

**Hub repo (this commit):**
- New: `src/components/scalp/{scalp-zone-view,live-board-section,recent-signals-section,quality-section,calibration-section,reset-controls-card}.tsx`
- Modified: `src/app/scalp/page.tsx` (rewritten as server-component flag selector with C2 dashboard pattern)
- Modified: `src/app/api/live-board/enter/route.ts` (forward 423 Locked when `data.blocked === true`)
- Modified: `query_live_board.py` (added killswitch gate to `enter_trade()`)
- Modified: `CLAUDE.md` (this section)

**Trevor repo (sibling commit, --no-verify per `feedback_sacred_bypass`):**
- Modified: `BEHAVIOR_RULES.md` (Section 3 changelog entry)

**Untouched:**
- `src/components/trades/*` (2127 lines of legacy LiveBoard/TradeForm/JournalTab/HistoryTable). I1 prunes after Wave I verification.
- All bot-side / sacred / Discord code.

### What E1 does NOT do

- Does NOT delete `src/components/trades/`. I1 prunes after Wave I.
- Does NOT change reset endpoint backends (A3 kept them).
- Does NOT add a STOP / kill / panic button anywhere on `/scalp`.
- Does NOT auto-close positions on reset.
- Does NOT change confidence weights, calibration buckets, or thresholds.
- Does NOT modify `signal_filter_rules`.
- Does NOT add a Reset button on Dashboard, AUTO, INTEL, or MEMORY zones.
- Does NOT modify `/intel?tab=calibration` (F3 will).
- Does NOT touch backend, Discord, or sacred Python files.
- Does NOT modify `trevor.service` — only `trevor-dashboard.service` restarted.

### Rollback

```bash
# Soft (flag flip — restores inline "Temporarily Disabled" message)
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='HUB_REDESIGN_SCALP';"
# No restart required (React cache() is per-request)

# Full code revert
cd /home/trevor/trevor-dashboard && git revert <e1-hub-commit>
sudo systemctl restart trevor-dashboard.service
# Restores B1 placeholder /scalp page, removes scalp/* component dir,
# restores /api/live-board/enter to non-killswitch-aware behavior,
# restores query_live_board.py enter_trade() to non-gated form.
```

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display + manual entry, zero trade-closing code.
Rule 14 (sacred files) — 12/12 byte-identical (`BEHAVIOR_RULES.md` +
`CLAUDE.md` modified per E1 spec via `--no-verify` per memory
`feedback_sacred_bypass`). Rule 15 (additive DB) — only existing
`HUB_REDESIGN_SCALP` row's value UPDATEd. Rule 16 (surgical edits) — only
listed files staged. Rule 22 (no Discord channels touched). Rule 30 (no
ticker/direction blocks) — `signal_filter_rules` UNCHANGED. Rule 31 (auto
trader never self-pauses) — N/A; manual ENTER respects killswitch via the
new gate. Rule 32 (KILLSWITCH-only project-wide pause; UI Stop banned) —
ENFORCED, no kill affordance on `/scalp`. No new npm dependencies.
JetBrains Mono only. Cyberpunk palette only via A4 tokens. Mobile-first
verified at 375vw via SSR HTML markup. Tap target floor 44×44 via
`.tap-target` (HapticButton).

Wave E begins. Wave F (INTEL zone) is next.


## F2 — INTEL Trade Journal (shipped 2026-04-30)

Per-trade Haiku-generated narratives at `/intel?tab=journal`. F1 shipped
cohort-level lessons; F2 adds per-trade granularity — when the cohort says
"AVOID this", Ghost can drill into specific trades to understand why. F3
follows with similarity (ChromaDB) + calibration deep-dive + shadow.

### What F2 ships

**Manual-trigger only.** Each closed live AutoTrader trade gets a "Generate"
button that POSTs to a dedicated `/api/intel/journal` route, which calls
Anthropic Haiku (`claude-haiku-4-5-20251001`) with the trade's full context
(ticker / direction / entry / exit / leverage / pnl / regime / exit reason
/ peak P&L / hold duration / `ai_decision_json.reasoning` / group scores).
Haiku writes a 3-section narrative — ENTRY RATIONALE / WHAT HAPPENED /
LESSON — capped at 200 words and 600 output tokens.

`JOURNAL_AUTO_GENERATE_ENABLED` defaults `false`. The auto-generate hook
is plumbed but **disabled until budget impact is observed**.

### DB (additive)

```sql
CREATE TABLE trade_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_source TEXT NOT NULL,
  trade_id INTEGER NOT NULL,
  trade_uri TEXT,
  narrative TEXT NOT NULL,
  prompt_hash TEXT,
  model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  tokens_input INTEGER,
  tokens_output INTEGER,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by TEXT,
  UNIQUE(trade_source, trade_id, prompt_hash)
);
CREATE INDEX idx_trade_journal_source_id    ON trade_journal(trade_source, trade_id);
CREATE INDEX idx_trade_journal_generated_at ON trade_journal(generated_at);
```

Plus 4 `auto_config` rows for budget tracking + auto-gen flag:

| Key | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_DAILY_TOKENS_USED` | `0` | Counter; resets on date change |
| `ANTHROPIC_API_DAILY_RESET_DATE` | `date('now')` | Last reset date |
| `ANTHROPIC_API_DAILY_BUDGET_TOKENS` | `500000` | Cap (~$0.25/day at Haiku rates) |
| `JOURNAL_AUTO_GENERATE_ENABLED` | `false` | Auto-gen on trade close (deferred) |

### Backend scripts (READ-WRITE on `trade_journal` + `auto_config`)

| File | Purpose |
|---|---|
| `query_journal_narrative.py` | Generates or fetches a single narrative. Caches by `prompt_hash`. Budget-aware pre-check. `--force` flag deletes existing rows for `(source, trade_id)` before regen — necessary because the deterministic prompt produces an identical hash, which would otherwise hit the UNIQUE constraint. Soft errors (`budget_exceeded`, `trade not found`, `api_call_failed`) print JSON to stdout + exit 0 so the route delivers them cleanly to the UI. |
| `query_journal_list.py` | Lists last N closed live trades + `has_narrative` status + budget snapshot. Read-only. |

The narrative script reads the API key from env first, then falls back to
`/home/trevor/trevor/.env` (handles both quoted and unquoted values).

### API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/intel/journal?limit=N` | GET | Lists last N closed live trades with `has_narrative` + budget |
| `/api/intel/journal/[source]/[id]` | GET | Returns cached narrative if present, else generates (counts toward budget) |
| `/api/intel/journal/[source]/[id]` | POST `{}` | Same as GET but for explicit user-initiated generate |
| `/api/intel/journal/[source]/[id]` | POST `{force:true}` | Regenerates: deletes any existing entry, generates fresh |

Source whitelist: `auto_trades` only. `unified_outcomes` and scalp trades
deferred. `runPython` timeout bumped to 30s for the dynamic route (Haiku
calls take 5–10s).

### UI

`src/components/intel/journal-section.tsx` (300 lines) wired into
`intel-zone-view.tsx` at `case "journal":`. Composition:
- `<Card>` header with `BookOpen` icon and budget pill (green/amber/red by
  usage %)
- Trade list (last 30): ticker / direction / closed-at + `pnl_pct` MoneyText
  + `📝` cyan pill if has_narrative, `—` neutral pill otherwise
- `<BottomSheet>` per-trade detail with:
  - EmptyState + Generate `<HapticButton>` if no narrative
  - Skeleton during generation
  - Narrative card with model + tokens-used pills + Regenerate ghost button
  - Amber Lock card on `error: "budget_exceeded"`
  - Plain EmptyState on other errors

`HUB_REDESIGN_INTEL` flag (already true) controls the entire `/intel`
zone — flipping it false reverts to the placeholder.

### Cost

Per-call: ~556 input + ~330 output ≈ 886 tokens × ($0.80/MTok in + $4/MTok out)
≈ $0.0018/call. **50 generations/day = ~$0.09/day**, well under the $0.25
budget memory.

### Verification (all PASS)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 errors |
| `npm run build` | clean, `/intel` 1.92 → 7.96 kB, 2 new routes registered as `ƒ` Dynamic |
| First gen test (trade 100084 FARTCOIN) | 556+337 tokens, narrative 1300 chars, 3-section compliant |
| Cache hit test | second call returns `from_cache:true`, no token spend |
| Force regen test | deletes existing row, generates new id, tokens incremented exactly |
| Bad source rejection | GET + POST both return HTTP 400 `{error:"invalid source"}` |
| Bad trade id | returns `{"error":"trade not found: auto_trades/9999999"}` cleanly |
| Budget-exceeded path | with cap=5000 + used=5203, returns `{"error":"budget_exceeded","tokens_used_today":5203,"tokens_cap":5000,"projected":7303}` (no token spend) |
| Flag rollback | flip OFF → 25180 B placeholder; flip ON → 26662 B w/ JOURNAL marker |
| Sacred 12 manifest | byte-identical (BEHAVIOR_RULES.md + CLAUDE.md modified per spec, expected manifest miss; --no-verify per memory `feedback_sacred_bypass`) |
| `signal_filter_rules` | UNCHANGED |
| 6 recurring-bug canaries | CLEAN (matches Phase 0 baseline) |
| Open positions | 0 active / 0 auto live (matches Phase 0 baseline) |
| `trevor.service` | UNTOUCHED (PID 2879412, ActiveEnterTimestamp 21:15:41 UTC unchanged) |
| `trevor-dashboard.service` | restart healthy, MainPID 2895651 ready in <3s |

### Browser smoke disclosure

Per CLAUDE.md guidance — Claude Code cannot operate a real browser. SSR
HTML markers + every endpoint were verified via authenticated curl. Visual
UX (mobile breakpoints 375 / 390 / 430 / 768 / 1024 / 1440, BottomSheet
slide-up animation, Generate button haptic feedback, narrative whitespace
preservation, cached-vs-fresh pill rendering) **was NOT exercised in a
browser**. The components follow A4 mobile-first conventions and the
production build emits the responsive Tailwind classes; real-device smoke
is the honest validation step Ghost performs after merge.

### Files

**Hub repo (this commit):**
- New: `query_journal_narrative.py`, `query_journal_list.py`
- New: `src/app/api/intel/journal/route.ts`, `src/app/api/intel/journal/[source]/[id]/route.ts`
- New: `src/components/intel/journal-section.tsx`
- Modified: `src/components/intel/intel-zone-view.tsx` (case "journal" → JournalSection)
- Modified: `CLAUDE.md` (this section)

**Trevor repo (sibling commit, --no-verify per `feedback_sacred_bypass`):**
- Modified: `BEHAVIOR_RULES.md` (Section 3 changelog entry — F2 contract)

**Untouched (per Ghost's Phase 0 decision on dirty tree, NOT in commit):**
All pre-existing trevor/ dirty paths (training/cache/*.parquet deletes,
brain/HEARTBEAT/MEMORY/session-state churn, `auto_trader/embeds.py +
observability.py` (4/28 pre-spike-removal work — Ghost-flagged as out of
scope), models/hmm_regime_v2.pkl, observatory_v4/, docs/AUTOTRADER_EDGE_AUDIT_REPORT.md,
docs/HMM_FARTCOIN_COLLAPSE_AUDIT.md, sacred_backups/.../env.original).
trevor-dashboard `.env`, `.env.local`, `tsconfig.tsbuildinfo`,
`.env.local.bak.pre_lockdown_20260424`.

### What F2 does NOT do

- Does NOT auto-generate on trade close (hook plumbed but flag `false`).
- Does NOT support scalp / manual trades — `auto_trades` source only.
- Does NOT modify `/api/journal` (legacy daily aggregation route, A3-flagged for I1 deprecation).
- Does NOT call Sonnet (Haiku only — budget rule).
- Does NOT embed narratives in ChromaDB (F3 owns similarity).
- Does NOT change signal scoring or trading behavior.
- Does NOT mutate sacred files, Discord, or backend bot.
- Does NOT add a "share" / "publish" / "delete" affordance on narratives.
- Does NOT retroactively backfill all 50 closed trades (~$0.09 if Ghost wants it; defer to a separate prompt).
- Does NOT send narratives to Discord. Display is Hub-only.
- Does NOT modify `trevor.service` — only `trevor-dashboard.service` restarted.

### Rollback

```bash
# Soft (15-second flag flip)
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='HUB_REDESIGN_INTEL';"
# No restart — React cache() is per-request

# Full code revert
cd /home/trevor/trevor-dashboard && git revert <f2-hub-commit>
sudo systemctl restart trevor-dashboard.service
# Restores intel-zone-view.tsx to pre-F2 (case "journal" → placeholder).
# Removes the 2 query helpers, 2 routes, journal-section component.
# Leaves trade_journal table + 4 auto_config rows in DB (additive,
# benign). To wipe: DROP TABLE trade_journal; DELETE FROM auto_config
# WHERE key LIKE 'ANTHROPIC%' OR key='JOURNAL_AUTO_GENERATE_ENABLED';
```

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display + Haiku narrative gen, zero trade-closing
code. Rule 14 (sacred files) — 12/12 byte-identical (`BEHAVIOR_RULES.md` +
`CLAUDE.md` modified per F2 spec via `--no-verify` per memory
`feedback_sacred_bypass`). Rule 15 (additive DB) — new `trade_journal`
table + 4 `auto_config` rows; no existing tables modified. Rule 16
(surgical edits) — only F2-scoped files staged. Rule 22 (no Discord
channels touched). Rule 30 (no ticker/direction blocks) —
`signal_filter_rules` UNCHANGED. Rule 31 (auto trader never self-pauses)
— N/A UI/journal only. Rule 32 (KILLSWITCH-only project-wide pause; UI
Stop banned) — ENFORCED, no kill affordance on `/intel`. Manual-trigger
only — `JOURNAL_AUTO_GENERATE_ENABLED=false`. Budget cap enforced
server-side; UI surfaces `% budget` pill but cannot bypass. No new npm
dependencies (`anthropic` 0.84.0 already installed in venv). JetBrains
Mono only. Cyberpunk palette only via A4 tokens. Mobile-first verified at
375vw via SSR HTML markup. Tap target floor 44×44 via `.tap-target`
(HapticButton).

F1 (cohort lessons) + F2 (per-trade narratives) shipped. F3 closes Wave F
with similarity + calibration deep-dive + shadow next.

## F3 — INTEL Similar / Calibration deep-dive / Shadow + Optuna A/B (shipped 2026-05-01)

Closes the INTEL zone — last 3 sub-tabs filled. `/intel?tab=similar` for
ChromaDB-or-feature-vector top-K cosine similarity off any closed live
AutoTrader trade. `/intel?tab=calibration` for per-bucket × regime ×
ticker WR breakdown. `/intel?tab=shadow` for shadow scoring readiness +
the **real** Optuna A/B comparison window (pivot from prompt's fictional
dormant timer). All five INTEL sub-tabs from the B1 navigation contract
are now populated.

### Phase 0 audit deviations from prompt (5 Ghost-approved)

The prompt was written against a schema that didn't match this instance.
Phase 0 surfaced 5 mismatches:

1. **`auto_signal_log` table doesn't exist.** Prompt's
   `query_similar_trades.py` joined to it for `confidence_at_entry` /
   `regime_at_entry`. Reality: `auto_trades` already has `confidence`,
   `adjusted_confidence`, and `regime_at_entry` directly. Dropped the
   join; read straight from `auto_trades`. Prefer `adjusted_confidence`
   when present, else `confidence`.
2. **`unified_outcomes` view columns mismatch.** Prompt selected
   `confidence_at_entry` + `regime_at_entry` from this VIEW. Real columns
   are `confidence` and `regime` (no `_at_entry` suffix). 941 total rows;
   867 with both `pnl_pct` + `confidence` non-null.
3. **`shadow_scoring` column name.** Prompt read `scored_at`; real column
   is `timestamp`. 10,852 rows, last-write 2026-05-01 — way past the
   200-row FUTURE_01 readiness threshold.
4. **No classic Optuna study tables.** Prompt assumed `OPTUNA_RUNNING` /
   `OPTUNA_LAST_FINISHED_AT` keys in `auto_config` (none exist), an
   `optuna*` systemd timer (none), and a "monthly timer dormant" mental
   model. Reality: `optuna_shadow_config` is a **live A/B comparison
   window** (`enabled=1`, `started_at=2026-04-11`, `total_comparisons=
   1170`, `prod_fires=920` vs `optuna_fires=1008`, `disagreements=250`,
   params snapshot from `optimized_params.json` with n_trials=50,
   sharpe=0.9791). Surfaced THIS state instead of inventing a dormant
   timer per Honesty Protocol §8.2. Renders REVIEW OVERDUE pill at
   started_at + 14d (currently 20d ago).
5. **`BEHAVIOR_RULES.md` is at repo root**, not `brain/BEHAVIOR_RULES.md`
   as prompt §6.2 stated. Used `/home/trevor/trevor/BEHAVIOR_RULES.md`.

ChromaDB has **no `trade_embeddings` collection** (prompt assumed one).
The script tries `CHROMA_TRADE_COLLECTION="trade_embeddings"`, gracefully
misses, and falls through to `feature_vector` cosine — which is the
honest primary path for this instance. The `learned-outcomes` collection
DOES contain auto-trade-keyed ids (`learned-autotrader-auto_<id>`) but
wiring that custom id-transform path was deferred per Ghost — keeps F3
small, the fallback is plenty of signal until ChromaDB grows real
embeddings.

### Backend (3 READ-ONLY Python helpers, 3 API routes)

| Helper | Route | Purpose |
|---|---|---|
| `query_similar_trades.py` | `/api/intel/similar/[source]/[id]` | Top-8 cosine over `auto_trades` (`confidence|adjusted_confidence` + `direction` + `leverage` + ticker one-hot + regime one-hot). Method honestly reported. |
| `query_calibration_deep.py` | `/api/intel/calibration` | 5-bucket WR (35-44 / 45-54 / 55-64 / 65-74 / 75+) globally + by `regime` + by `ticker`. Mirrors F1 boundaries. |
| `query_shadow_status.py` | `/api/intel/shadow` | shadow_scoring rollup + `optuna_shadow_config` A/B window state (started_at, comparisons, prod/optuna fire counts, disagreement rate, params snapshot, REVIEW OVERDUE flag at +14d). |

All three open SQLite via `file:...?mode=ro`. Top-K capped at 8 for mobile
sanity. Source whitelist: `auto_trades` only. ChromaDB calls never write.

### UI (3 sections + zone view wire)

- `src/components/intel/similar-trades-section.tsx` — base-trade picker
  (last 30 closed live, horizontal carousel) + cosine result list with
  ticker / direction / similarity % pill / closed-at / pnl%. Method pill
  in card header (cyan for `chromadb`, neutral for `feature_vector`).
- `src/components/intel/calibration-section.tsx` — Global / By Regime /
  By Ticker `<SegmentedToggle>` + bar-chart layout per slice with bucket
  pills tone-coded (green ≥55, cyan 40-54, amber 30-39, red <30, neutral
  when n<5). Total-rows counter in card header.
- `src/components/intel/shadow-section.tsx` — two cards:
  - SHADOW SCORING: method / rows / ready? / last-score + progress bar
    against the 200-row threshold.
  - OPTUNA A/B WINDOW: comparisons / disagreements / started / params
    generated-at + 4 snapshot stats (Conf Floor, Train WR, Sharpe, Train
    PnL) + last_reason callout + amber `REVIEW OVERDUE` banner once
    started_at is 14d+ in the past.

`intel-zone-view.tsx` switch wired all 5 sub-tabs:
`lessons → LessonsSection`, `journal → JournalSection`, `similar →
SimilarTradesSection`, `calibration → CalibrationSection`, `shadow →
ShadowSection`. Default falls through to lessons.

### Verification (all PASS)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean, 0 errors |
| `npm run build` | clean, `/intel` 7.96 → 10.7 kB, 3 new `/api/intel/*` routes registered as `ƒ` Dynamic |
| `/api/intel/similar/auto_trades/100086` | HTTP 200, 8 similar returned, method=feature_vector, base.confidence_at_entry=59.5 |
| `/api/intel/calibration` | HTTP 200, total_rows=867 matches SQL exactly, 5 global buckets + 3 regimes + 5 tickers |
| `/api/intel/shadow` | HTTP 200, shadow.rows=10852 + optuna_ab.total_comparisons=1170 both match SQL |
| Bad source on `/api/intel/similar` | HTTP 400 |
| Invalid trade id | HTTP 400 |
| Nonexistent trade id | HTTP 200 + clean `{error: "trade ... not found"}` (soft-error pattern matching F2) |
| Unauth on all 3 routes | 401 |
| All 5 `/intel?tab=*` pages | 200/200/200/200/200 |
| All 5 other zones (`/dashboard`, `/autotrader`, `/scalp`, `/memory`, `/chat`) | 200 |
| Flag rollback OFF→ON cycle | bidirectional clean (25180 B placeholder ↔ 25996+ B with section markers) |
| 6/6 recurring-bug canaries POST-deploy | CLEAN (matches Phase 0 baseline) |
| Sacred 9 Python+`brain/` files | byte-identical (sizes match Phase 0) |
| `signal_filter_rules` | UNCHANGED (1 inert REGIME_THRESHOLD_CAP enabled=0 reseed) |
| Open positions invariant | 0 active / 0 auto live throughout F3 (matches Phase 0 baseline) |
| `trevor.service` | UNTOUCHED (PID 2879412, ActiveEnterTimestamp 2026-04-30 21:15:41 UTC unchanged) |
| `trevor-dashboard.service` | restart healthy, MainPID → 2911347 after final shadow-section refactor build |

### Browser smoke disclosure

Per CLAUDE.md guidance — Claude Code cannot operate a real browser. SSR
HTML markers + every endpoint were verified via authenticated curl
(SHADOW SCORING + OPTUNA A/B WINDOW + SIMILAR TRADES + CALIBRATION
DEEP-DIVE titles all confirmed in SSR HTML). Visual UX (mobile
breakpoints 375 / 390 / 430 / 768 / 1024 / 1440, picker carousel
horizontal scroll snap, slice-toggle smoothness, bucket bar-chart
animation, REVIEW OVERDUE amber banner rendering) **was NOT exercised in
a browser**. Real-device smoke is the honest validation step Ghost
performs after merge.

### Files

**Hub repo (this commit):**
- New: `query_similar_trades.py`, `query_calibration_deep.py`, `query_shadow_status.py`
- New: `src/app/api/intel/similar/[source]/[id]/route.ts`, `src/app/api/intel/calibration/route.ts`, `src/app/api/intel/shadow/route.ts`
- New: `src/components/intel/similar-trades-section.tsx`, `src/components/intel/calibration-section.tsx`, `src/components/intel/shadow-section.tsx`
- Modified: `src/components/intel/intel-zone-view.tsx` (5-way switch wired)
- Modified: `CLAUDE.md` (this section)

**Trevor repo (sibling commit, --no-verify per `feedback_sacred_bypass`):**
- Modified: `BEHAVIOR_RULES.md` (Section 3 changelog entry — F3 contract; Wave F closed)

**Untouched (per Ghost's Phase 0 ruling on dirty trees, NOT staged):**
All pre-existing trevor/ dirty paths (training/cache parquet deletes,
brain/HEARTBEAT/MEMORY/session-state churn, embeds.py / observability.py
mods, models/hmm_regime_v2.pkl, observatory_v4/, docs/AUTOTRADER_EDGE_AUDIT_REPORT.md,
docs/HMM_FARTCOIN_COLLAPSE_AUDIT.md, sacred_backups/.../env.original).
trevor-dashboard `.env`, `.env.local`, `tsconfig.tsbuildinfo`,
`.env.local.bak.pre_lockdown_20260424`.

### What F3 does NOT do

- Does NOT write to ChromaDB. Read-only queries.
- Does NOT call Anthropic. F2 owns Haiku.
- Does NOT trigger Optuna runs or shadow retraining. Both surfaces are
  read-only — no "force retrain" / "freeze A/B" / "promote optuna params"
  affordances. Those flow happens via `auto_trader.shadow_scoring`
  retrain or direct `auto_config` writes, never via Hub UI.
- Does NOT modify `unified_outcomes`, `auto_trades`, `shadow_scoring`,
  or `optuna_shadow_config`. Pure read.
- Does NOT add a "deep search" affordance crossing zones.
- Does NOT surface Hyperliquid orderbook or live signals (those live in
  SCALP).
- Does NOT touch sacred files, Discord, or backend bot.
- Does NOT add new flags. Same `HUB_REDESIGN_INTEL` from F1.
- Does NOT modify `trevor.service` — only `trevor-dashboard.service`
  restarted (twice during build).

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — pure read-only display. Rule 14 (sacred files)
— 9/9 byte-identical (`BEHAVIOR_RULES.md` + `CLAUDE.md` modified per F3
spec via `--no-verify` per memory `feedback_sacred_bypass`). Rule 15
(additive DB) — N/A no schema changes (no INSERTs anywhere). Rule 16
(surgical edits) — only F3-scoped files staged. Rule 22 (no Discord
channels touched). Rule 30 (no ticker/direction blocks) —
`signal_filter_rules` UNCHANGED. Rule 31 (auto trader never self-pauses)
— N/A backend not touched. Rule 32 (KILLSWITCH-only project-wide pause;
UI Stop banned) — ENFORCED, no kill affordance on `/intel`. No new npm
dependencies. Cyberpunk palette only via A4 tokens. Mobile-first
verified at 375vw via SSR HTML markup. Tap target floor 44×44 via
`.tap-target` (picker buttons). Top-K capped at 8 for mobile. Calibration
buckets identical to F1 (35-44 / 45-54 / 55-64 / 65-74 / 75+). Shadow
ready_for_analysis only flips to YES at n≥200 (currently 10852, so
honestly green). REVIEW OVERDUE pill fires at started_at + 14d
(currently 20d). Method honesty — `feature_vector` fallback labeled
clearly when ChromaDB has no matching collection.

### Rollback

```bash
# Soft (15-second flag flip — restores B1 placeholder /intel page)
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='HUB_REDESIGN_INTEL';"
# No restart required (React cache() is per-request)

# Full code revert
cd /home/trevor/trevor-dashboard && git revert <f3-hub-commit>
sudo systemctl restart trevor-dashboard.service
# Restores intel-zone-view.tsx to F2 state (similar/calibration/shadow
# fall through to placeholder). Removes 3 query helpers, 3 routes, 3
# section components.
```

INTEL zone is end-to-end populated: lessons / journal / similar /
calibration / shadow. Wave F closed.

## G1 — MEMORY Layout — Brain / Memory journal / ChromaDB (shipped 2026-05-01)

Replaces the B1 placeholder at `/memory` with the MEMORY zone first 3 sub-tabs (Brain / Memory / ChromaDB). G2 follows with System Health + Aggressive Mode.

### Phase 0 audit deviations from prompt (Ghost-approved at THOUGHTS gate)

The G1 prompt was written against a schema/architecture that didn't fully match reality. Phase 0 audit surfaced 5 mismatches:

1. **`memory_journal` SQLite table doesn't exist.** Reality: TREVOR's persistent memory artifact is `brain/memory/*.md` daily session checkpoints (50 files at audit time, format `# Session Checkpoint — <ts>\n## Last 5 Exchanges\n## State\n...`). Phase 2 pivoted from "SQLite reader" to "daily-markdown reader" — same JSON shape (`entries[]` with id/ts/tag/content), but reads files via `pathlib.Path.glob`. Honest data source over invented schema.
2. **`runPythonWithStdin` already exists implicitly** — `runPython(script, args, { input })` in `lib/api-helpers.ts` already supports stdin via spawnSync's `input` option (lines 22-43). Skipped adding the duplicate helper.
3. **Repos NOT clean at start** — TREVOR repo had ~250 uncommitted parquet deletions + `auto_trader/embeds.py + observability.py` mods + `models/hmm_regime_v2.pkl` churn. Per Ghost decision (b): stashed both repos before G1 started. Restored after Phase 6 commits land.
4. **Brain file listing scope** — `brain/` contains 4 sacred (IDENTITY/BRAIN/SOUL/AGENTS) + 4 non-sacred (HEARTBEAT/LEARNINGS/MEMORY/session-state) + 11 `MEMORY.md.backup.YYYYMMDD` clutter + 2 subdirs (backups/, memory/). `query_brain_files.py` filters to top-level `*.md` excluding `.backup*` patterns. Result: 8 files (4 sacred + 4 non-sacred), no backup noise.
5. **`BEHAVIOR_RULES.md` lives at trevor repo root** (`/home/trevor/trevor/BEHAVIOR_RULES.md`, 719 KB), NOT `brain/BEHAVIOR_RULES.md`. Doc edits target the root file.

### Architecture

**3 backend Python helpers** (top-level dashboard scripts, executable, mode=ro SQLite):
- `query_brain_files.py` (~70 lines): lists top-level `brain/*.md` with `.backup*` excluded, returns `{files[], edit_enabled, sacred_count, non_sacred_count}`. Sacred status flag from frozenset {IDENTITY/BRAIN/SOUL/AGENTS.md}.
- `query_brain_read.py` (~55 lines): reads single file by basename, validates `.md` ext + no `..`/`/`/.backup, max 256 KB. Returns `{name, content, is_sacred, size_bytes, modified_at, lines}` or `{error}`.
- `write_brain_file.py` (~120 lines): atomic write with .bak backup + brain_edit_audit row. Hard rejects sacred names (exit 3). Hard rejects when `HUB_BRAIN_EDIT_ENABLED=false` (exit 3). Validates basename + 256 KB cap. Skips on no-change (sha-equal).

**Memory journal reader** (`query_memory_entries.py`, ~75 lines): reads `brain/memory/YYYY-MM-DD.md` files, parses optional embedded ISO timestamp from `# Session Checkpoint — ` header, supports limit + substring search. Honest empty state when dir missing.

**ChromaDB browser** (`query_chroma_browse.py`, ~120 lines): list/peek/search modes via `chromadb.PersistentClient`. Limit capped at 25, no embeddings returned. Each mode has its own JSON shape (`mode: list|peek|search` + tagged data).

**4 API routes**:
- `/api/memory/brain` (GET) — file list
- `/api/memory/brain/[name]` (GET/POST) — read or write single file. POST has API-layer sacred guard (HTTP 423 immediate, before the script call) + flag check via script (HTTP 423 on Python exit 3) + content/author validation (HTTP 400)
- `/api/memory/journal` (GET) — daily checkpoints with `?limit=&q=`
- `/api/memory/chroma` (GET) — list/peek/search with collection name validation `/^[a-zA-Z0-9_-]+$/` and 60s in-memory cache for `list` mode (PersistentClient cold-start is 30-40s on this VM; warm <1s). 60s timeout on the Python call.

**4 React UI sections**:
- `BrainSection` — file list with Lock/Edit/FileText icons; BottomSheet for read+optional-edit. Edit affordance gated on `data.edit_enabled && !content.is_sacred`. Save POST shows result + reload list. Sacred files render Lock icon + SACRED pill, never editable.
- `MemorySection` — search box (350ms debounce) + entry list with Card per entry; expand-to-full button at >600 char preview.
- `ChromaSection` — collection grid (2/3/4 cols responsive) + select → peek/search panel. Tooltip-style metadata stripe at bottom of each item.
- `MemoryZoneView` — pure dispatcher. Maps `subtab → section`; `health`/`aggressive` → "Coming next in Wave G2" empty state.

**Page rewrite**: `/memory/page.tsx` is a server component flag selector (cookie override → `runPython("query_feature_flags.py")` → DashboardDisabled-style fallback). Same pattern as `/intel/page.tsx`.

### Three-layer sacred rejection (proof in §5.5)

Sacred file write rejection enforced at 3 independent layers — any one rejects unconditionally:

| Layer | Mechanism | Test result (HUB_BRAIN_EDIT_ENABLED=true, attempting IDENTITY.md/BRAIN.md/SOUL.md/AGENTS.md) |
|---|---|---|
| 1. UI | `is_editable=false` for all 4 sacred entries; Edit button never rendered | Visual; `data.is_editable` field |
| 2. API route | POST handler checks `name in SACRED_NAMES` → HTTP 423 Locked before script call | All 4 returned `HTTP 423 {"error":"sacred file — write rejected: NAME.md"}` |
| 3. Python script | `name in SACRED_NAMES` → exit 3 unconditionally | Verified directly via Python smoke (exit code 3 on each) |

`IDENTITY.md` SHA-256 byte-identical pre/post all 4 hostile POSTs. Manifest 12/12 OK after the test.

### Verification gates (all PASS)

- `npx tsc --noEmit` — clean
- `npm run build` — clean, **47s**, 4 new `/api/memory/*` routes registered as `ƒ` Dynamic, `/memory` route 4.55 kB / 117 kB First Load
- API endpoints (post-restart, with auth cookie):
  - `GET /api/memory/brain` → 200, 8 files, edit_enabled=false (default)
  - `GET /api/memory/brain/IDENTITY.md` → 200, lines=64, is_sacred=true
  - `GET /api/memory/journal?limit=3` → 200, total=50, returned=3
  - `GET /api/memory/chroma?mode=list` → 200, 20 collections (cache MISS on first call ~7s, HIT <100ms thereafter)
  - `GET /api/memory/chroma?mode=peek&collection=conversations&limit=2` → 200, 2 sample docs
  - `GET /api/memory/chroma?mode=peek&collection=../etc&limit=2` → 400 invalid collection name
- Sub-tab routes `/memory?tab={brain,memory,chromadb,health,aggressive}` all → 200
- **Sacred rejection (`HUB_BRAIN_EDIT_ENABLED=true`)**: 4/4 sacred POSTs → HTTP 423; all 4 SHA-256 hashes byte-identical pre/post; manifest 12/12 OK
- **Non-sacred no-change roundtrip** (`HUB_BRAIN_EDIT_ENABLED=true`, LEARNINGS.md POST same content back): `{"ok":true,"no_change":true}`, file SHA-256 unchanged, audit table NOT created (no real edit)
- Flag rollback `/memory` `OFF→Temporarily Disabled→ON→BRAIN FILES` cycle clean
- Sacred files **12/12 byte-identical** to baseline via `sha256sum -c .sacred_manifest.sha256`
- Open positions baseline preserved (active=0, auto_live=1)
- All 6 recurring-bug canaries CLEAN POST-deploy
- `signal_filter_rules` UNCHANGED (1 inert `REGIME_THRESHOLD_CAP enabled=0` reseed row per Rule 30 known residual)

### Cache notes

The Chroma `list` endpoint has a 5-minute in-memory server-side cache because `chromadb.PersistentClient(path=...)` cold-start is ~30-40 seconds on this VM (CPU-bound, single-vCPU). Cache invalidates on Hub restart. Peek and search are uncached because they're user-driven targeted queries.

### Sacred files UNTOUCHED (12/12)

Sacred files byte-identical pre/post via `sha256sum -c`: `IDENTITY.md` `27762ab8…`, `BRAIN.md` `470f5852…`, `SOUL.md` `858bc12a…`, `AGENTS.md` `5fbacb83…`, `swarms_brain.py` `ed6b8291…`, `training_bridge.py` `318571fb…`, `signal_cleanup.py` `7723516d…`, `signal_guard.py` `28f28689…`, `signal_cooldown.py` `bee3f929…`, `portfolio_pulse.py` `49101b6b…`, `test_signal_deletion.py` `6784dec3…`, `format_utils.py` `e1e5efed…`. The pre-existing `BEHAVIOR_RULES.md` FAILED line in the manifest is a tracked-non-sacred drift unrelated to this prompt; G1 doesn't refresh manifest.

Filter rules UNCHANGED. Signal pipeline scoring UNCHANGED. Schema additive-only — `brain_edit_audit` table created lazily on first non-sacred write (no rows yet, table doesn't exist until then). No `config.py` / `.env` / systemd / service-config touched. `trevor.service` UNTOUCHED — only `trevor-dashboard.service` restarted.

### What G1 does NOT do

- Does NOT ship System Health sub-tab (G2)
- Does NOT ship Aggressive Mode toggle (G2)
- Does NOT modify any sacred file under any circumstance
- Does NOT add ChromaDB write affordances (READ-ONLY)
- Does NOT add memory journal write affordance (READ-ONLY search)
- Does NOT modify scoring, calibration, or thresholds
- Does NOT call Anthropic
- Does NOT touch Discord or backend bot
- Does NOT delete `/api/knowledge` or legacy `/api/memory` (kept; eventually I1 deprecates if zero callers)
- Does NOT change `swarms_brain.py` / `training_bridge.py` / signal modules

### Files (Hub repo)

- `query_brain_files.py` (new, ~70 lines, executable)
- `query_brain_read.py` (new, ~55 lines, executable)
- `write_brain_file.py` (new, ~120 lines, executable)
- `query_memory_entries.py` (new, ~75 lines, executable)
- `query_chroma_browse.py` (new, ~120 lines, executable)
- `src/app/api/memory/brain/route.ts` (new)
- `src/app/api/memory/brain/[name]/route.ts` (new, GET+POST with 3-layer sacred guard)
- `src/app/api/memory/journal/route.ts` (new)
- `src/app/api/memory/chroma/route.ts` (new, with 5-min in-memory cache + 60s timeout)
- `src/components/memory/brain-section.tsx` (new)
- `src/components/memory/memory-section.tsx` (new)
- `src/components/memory/chroma-section.tsx` (new)
- `src/components/memory/memory-zone-view.tsx` (new dispatcher)
- `src/app/memory/page.tsx` (rewritten — server component flag selector)

### Files (trevor repo)

- `CLAUDE.md` (this section)
- `BEHAVIOR_RULES.md` (Section 3 changelog entry)
- `auto_config` table (`HUB_BRAIN_EDIT_ENABLED='false'` row added)

### Rollback

```bash
# Soft (15-second flag flip — restores Temporarily Disabled inline message)
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='HUB_REDESIGN_MEMORY'"
# No restart required — React cache() is per-request

# Full code revert (Hub side)
cd /home/trevor/trevor-dashboard && git revert <hub-commit>
sudo systemctl restart trevor-dashboard.service

# Bot side documentation revert
git revert <trevor-commit>

# brain_edit_audit table cleanup (only relevant if any non-sacred writes happened):
# sqlite3 trevor.db "DROP TABLE IF EXISTS brain_edit_audit"
```

The `HUB_BRAIN_EDIT_ENABLED` flag remains in `auto_config` after revert — harmless (Rule 15 additive-only). To remove: `DELETE FROM auto_config WHERE key='HUB_BRAIN_EDIT_ENABLED'`.

### Sentinel

```
G1_COMPLETE: subtabs_shipped=3/5 sacred_rejection_test=PASS sacred_manifest_verified=YES brain_files=8 memory_data_available=true chroma_collections=20 build=PASS hub_restart=OK rollback_verified=YES open_positions_unchanged=YES canaries=CLEAN dashboard_commit=<TBD> trevor_commit=<TBD>
```

### Next

G2 — System Health sub-tab + Aggressive Mode toggle. Closes Wave G with the 2 deferred sub-tabs.

## H1 — TREVOR Chat Polish (shipped 2026-05-01)

Replaces the legacy `/chat` route page with a slide-up modal triggered by
`ChatFAB` (B1) on every Hub page. Token-by-token Haiku streaming via
`@anthropic-ai/sdk` 0.92 over Server-Sent Events. Shared daily Anthropic
budget pool with F2 (Trade Journal). 6-of-6 TREVOR-aware suggested
prompts on the empty state. Mobile-first 100dvh bottom-sheet, lg+
right-rail panel @ 480px.

### Phase 0 audit deviations from prompt (5 Ghost-approved)

The H1 prompt was written against assumptions that didn't fully match
the live schema/architecture. Phase 0 surfaced 5 mismatches; Ghost
approved each before Phase 1.

1. **ChatFAB path**: prompt said `src/components/chat-fab.tsx` OR
   `src/components/nav/chat-fab.tsx` — both wrong. Real path is
   `src/components/navigation/chat-fab.tsx` (B1).
2. **Suggestion script schema** — `signals_log`, `closed_trades`,
   `KILLSWITCH_ENABLED`, `AGGRESSIVE_MODE` keys/tables don't exist on
   this instance. Rewrote `query_chat_suggestions.py` to use
   `trade_insights` (no direction col, signal_type LONG/SHORT/HOLD,
   confidence 0–1 multiplied by 100), `unified_outcomes` view (per C2
   convention), `EMERGENCY_KILLSWITCH` key, and `AGGRESSIVE_THRESHOLD`
   numeric comparison (< 40 surfaces the prompt). 6/6 cards resolve
   live, no silent drops.
3. **API key propagation** — `/home/trevor/trevor-dashboard/.env.local`
   has no `ANTHROPIC_API_KEY`; the systemd unit only loads that file.
   F2 reads via Python fallback. New `src/lib/anthropic-key.ts` mirrors
   the F2 pattern Node-side: process.env first, else read
   `/home/trevor/trevor/.env` once at module load and cache. No systemd
   churn, no secret duplication.
4. **A3 demolition state** — prompt said legacy chat was already
   removed. It wasn't: `/chat` page + `/api/chat/route.ts` (broken;
   chat_bridge.py / chat_ai.py don't exist) still mounted. Per Ghost
   ruling: leave legacy untouched. H1 ships purely additive at
   `/api/chat/{suggestions,budget,stream}`.
5. **Tailwind v4 — no config file** — A4 ships with `@theme inline` in
   `globals.css`. New animation tokens
   (`--animate-slide-up-spring`, `--animate-slide-down-spring`,
   `--animate-scrim-fade-in`) registered there with matching keyframes
   appended to the keyframe section. No `tailwind.config.ts` to edit.

### Architecture

```
src/components/navigation/chat-fab.tsx (UPDATED, ~40 lines)
  └─ button → opens <ChatModal><ChatPanel/></ChatModal>

src/components/chat/chat-modal.tsx (NEW, ~95 lines)
  └─ Portal to body. role="dialog" aria-modal.
     Mobile: 100dvh bottom sheet, slide-up-spring 480ms (cubic-bezier
       0.17,0.84,0.44,1) on open, slide-down-spring 280ms on close.
     lg+:  right-rail panel max-w-[480px], lg:border-l border-t-0.
     Scrim: bg-black/70 backdrop-blur-sm, fades via opacity transition
       (200ms) — pure transition avoids `[animation-direction:reverse]`
       footgun in Tailwind v4.
     Body scroll locked while open. ESC + scrim click + close button
     all dismiss. Animates out 280ms before unmounting.

src/components/chat/chat-panel.tsx (NEW, ~250 lines)
  ├─ Header: Sparkles + "TREVOR Chat" + Pill(% used, green/amber/red)
  ├─ Body: <ChatEmptyState/> when zero msgs, else messages list
  ├─ Composer: textarea (max-h-32, min-h-44, rows=1) + HapticButton
  │            (Stop while streaming, Send otherwise)
  ├─ SSE consumer: reader → buf split on \n\n → events parsed → state
  │   - event: session  → setSessionId
  │   - event: token    → append to last assistant msg, keep pending
  │   - event: done     → mark assistant !pending + refresh budget
  │   - event: warn     → non-fatal, refresh budget anyway
  │   - event: error    → set error pill, drop pending if empty
  └─ AbortController on Stop button cancels mid-stream

src/components/chat/chat-message.tsx (NEW, ~50 lines)
  └─ User: justify-end, cyan accent border + bg-accent-cyan/10
     Assistant: justify-start, border-subtle + bg-bg-elevated
     Pending+empty: 3 staggered pulse dots
     Pending+content: trailing cyan cursor block

src/components/chat/chat-empty-state.tsx (NEW, ~115 lines)
  └─ Sparkles avatar + heading + 6 suggestion cards from
     /api/chat/suggestions. Skeleton during fetch. KILLSWITCH ON pill
     when killswitch_enabled. AGGR <N> pill when aggressive_threshold
     < 40. Card click → onPick(label) → ChatPanel.send(label).

src/lib/anthropic-key.ts (NEW, ~55 lines)
  └─ getAnthropicKey() — process.env first, else parse
     /home/trevor/trevor/.env at module load, cache.
     Strips matched single OR double quotes (mirrors F2's Python
     `env_anthropic_key()`). Test hook clears cache.

src/app/api/chat/{suggestions,budget,stream}/route.ts (NEW)
  ├─ /suggestions — GET; spawns query_chat_suggestions.py (READ-ONLY)
  ├─ /budget      — GET; spawns query_chat_budget.py (RW: daily reset)
  └─ /stream      — POST; SSE.
       1. Read body { session_id?, user_message }
       2. readBudget(); if blocked → SSE event:error{error:"budget"}
       3. getAnthropicKey(); if missing → 503
       4. persistUserMessage() → resolve session_id
       5. emit event:session{session_id}
       6. client.messages.stream({...}); for await content_block_delta
          text_delta → emit event:token{text}
       7. await resp.finalMessage() → tokens_in/out
       8. persistAssistantMessage() bumps shared budget atomically
       9. emit event:done{tokens_in,tokens_out}; close

query_chat_suggestions.py (NEW, ~165 lines, READ-ONLY)
  └─ 6 cards from REAL schema: open_positions (active+auto live),
     last_signal (trade_insights), edge_check OR killswitch_engaged
     (EMERGENCY_KILLSWITCH), aggressive_check (THRESHOLD<40),
     calibration (unified_outcomes ≥30), recent_journal (trade_journal).

query_chat_budget.py (NEW, ~95 lines, RW for daily reset)
  └─ Returns { used_tokens, budget_tokens, available_tokens, pct_used,
     blocked, reset_at_local_midnight }.
     Resets ANTHROPIC_API_DAILY_TOKENS_USED to 0 + stamps RESET_DATE
     when last reset was yesterday — same semantics as F2's
     `reset_daily_budget_if_needed()`.
     blocked = available_tokens < 1500 (one round-trip headroom).

write_chat_log.py (NEW, ~155 lines)
  ├─ user_message <session_id> <content>
  │   - session_id == 0 → INSERT chat_sessions; return new id
  │   - else → UPDATE last_active_at; INSERT chat_messages role='user'
  └─ assistant_message <session_id> <content> <t_in> <t_out> <model>
      - INSERT chat_messages role='assistant'
      - UPDATE chat_sessions totals + last_active_at
      - bump_budget(t_in + t_out) → ANTHROPIC_API_DAILY_TOKENS_USED
      - daily reset performed on every write
```

### DB additions (additive only — no existing tables touched)

```sql
CREATE TABLE chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT,
  total_tokens_in INTEGER NOT NULL DEFAULT 0,
  total_tokens_out INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  tokens_in INTEGER, tokens_out INTEGER, model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(session_id) REFERENCES chat_sessions(id)
);

CREATE INDEX idx_chat_messages_session
  ON chat_messages(session_id, created_at);
```

No new `auto_config` keys — the 4 F2 budget keys
(`ANTHROPIC_API_DAILY_BUDGET_TOKENS`, `ANTHROPIC_API_DAILY_TOKENS_USED`,
`ANTHROPIC_API_DAILY_RESET_DATE`, plus
`JOURNAL_AUTO_GENERATE_ENABLED`) are reused as-is. Chat usage
subtracts from the same 500_000 token/day pool (~$0.25/day at Haiku
rates).

### Cost math

Smoke-test round-trip: 209 input + 4 output ≈ 213 tokens for a 2-token
reply. Typical chat turn: ~700 input + ~150 output ≈ 850 tokens. Worst
case at 800 max-output: ~700 + 800 ≈ 1500 tokens. **Per-turn ceiling ~
$0.0006**. Even 100 turns/day stays under $0.06 — well within the
$0.25 budget, sharing pool with F2's per-trade narratives (~$0.0018
each).

### Verification (all PASS)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean, 0 errors |
| `npm run build` | clean, 4 chat routes registered as `ƒ` Dynamic |
| Anthropic SDK install | `@anthropic-ai/sdk` ^0.92.0 added to package.json + lockfile (3 packages); pre-existing next/postcss/lodash audit findings unchanged |
| `/api/chat/suggestions` | HTTP 200, 6/6 cards (open_positions, last_signal BTC LONG @ 56, edge_check, aggressive_check 35, calibration n=867, recent_journal auto#100083) |
| `/api/chat/budget` | HTTP 200, post-reset state used=0/cap=500000/blocked=false |
| Real Haiku stream POST | exit=0, SSE: 1 session + 1 token + 1 done event, model said exactly "ok" as instructed |
| Persistence | new chat_sessions row id=2 with totals 209/4; user msg id=2 + assistant msg id=3 in chat_messages |
| Budget delta on real call | pre=0 → post=213 (=209+4 exact) |
| Budget-block path (used=499999) | SSE event:error{"error":"budget","available_tokens":1}; NO new chat_sessions row, NO new chat_messages row; restored cleanly |
| All 6 zone routes (auth) | 200/200/200/200/200/200 (`/dashboard`, `/scalp`, `/autotrader`, `/intel`, `/memory`, `/chat`); `/` 307 → `/dashboard` |
| ChatFAB renders on /dashboard | `aria-label="Open TREVOR Chat"` present in SSR HTML |
| Sacred manifest 12/12 | byte-identical (`BEHAVIOR_RULES.md` pre-existing drift unchanged; per `feedback_sacred_bypass`) |
| Open positions baseline | active=0 / auto live=1 — matches Phase 0 baseline |
| 6/6 recurring-bug canaries | CLEAN (C1 portfolio_manager.py allowlisted; C6 discord_bot.py:9272 allowlisted; both per established baseline) |
| `signal_filter_rules` | UNCHANGED |
| `trevor.service` | UNTOUCHED — PID 2879412, ActiveEnterTimestamp 2026-04-30 21:15:41 UTC unchanged |
| `trevor-dashboard.service` | restart healthy, MainPID 2927614, "TREVOR Hub ready" within 4s |

### Browser smoke disclosure

Per CLAUDE.md guidance — Claude Code cannot operate a real browser. SSR
HTML markers + every endpoint + the real Haiku stream were verified via
authenticated curl. Visual UX (slide-up-spring overshoot animation,
mobile drag handle, scrim opacity transition timing, abort-mid-stream
cleanup, mobile breakpoints 375 / 390 / 430 / 768 / 1024 / 1440)
**was NOT exercised in a browser**. Real-device smoke is the honest
validation step Ghost performs after merge.

### Files

**Hub repo (this commit):**
- New: `src/components/chat/{chat-modal,chat-panel,chat-message,chat-empty-state}.tsx`
- New: `src/lib/anthropic-key.ts`
- New: `src/app/api/chat/{suggestions,budget,stream}/route.ts`
- New: `query_chat_suggestions.py`, `query_chat_budget.py`, `write_chat_log.py`
- Modified: `src/components/navigation/chat-fab.tsx` (B1's router.push → ChatModal)
- Modified: `src/app/globals.css` (3 new `--animate-*` tokens + 3 keyframes)
- Modified: `package.json` + `package-lock.json` (Anthropic SDK 0.92)
- Modified: `CLAUDE.md` (this section)

**Trevor repo (sibling commit, --no-verify per `feedback_sacred_bypass`):**
- Modified: `BEHAVIOR_RULES.md` (Section 3 Chat zone rules)

**Untouched (per Ghost's Phase 0 ruling on dirty trees, NOT staged):**
All pre-existing trevor/ dirty paths from prior waves (training/cache
parquet deletes, brain/HEARTBEAT/MEMORY/session-state churn, embeds.py
+ observability.py mods, models/hmm_regime_v2.pkl, observatory_v4/,
docs/AUTOTRADER_EDGE_AUDIT_REPORT.md, docs/HMM_FARTCOIN_COLLAPSE_AUDIT.md,
sacred_backups/.../env.original).
trevor-dashboard `.env`, `.env.local`, `tsconfig.tsbuildinfo`,
`.env.local.bak.pre_lockdown_20260424`.

### What H1 does NOT do

- Does NOT delete legacy `/chat` route or `/api/chat/route.ts` (broken
  chat_bridge.py / chat_ai.py path). Ghost ruling 3: leave additive.
  I1 may prune.
- Does NOT call Sonnet or Opus. Haiku 4.5 only (`claude-haiku-4-5-20251001`).
- Does NOT give the chat model tool access. Operator messages reach
  the model verbatim; suggestion labels are NOT sent as tool outputs.
- Does NOT write to ChromaDB.
- Does NOT modify F2's journal flow.
- Does NOT introduce a separate budget pool — single shared
  ANTHROPIC_API_DAILY_TOKENS_USED ledger.
- Does NOT change the killswitch.
- Does NOT auto-close positions. System prompt explicitly forbids
  recommending it.
- Does NOT bypass the $50 cap or per-ticker thresholds. System prompt
  explicitly forbids recommending it.
- Does NOT change scoring weights, calibration, or thresholds.
- Does NOT touch backend, Discord, or sacred Python files.
- Does NOT modify `trevor.service` — only `trevor-dashboard.service`
  restarted.
- Does NOT surface chat history yet — sessions persist but no history
  list UI in H1 (deferred to a future polish wave).

### Rollback

```bash
# Soft (in-place delete of new chat surface — keep legacy /chat as fallback)
# Restore B1's original chat-fab.tsx (router.push("/chat")):
cd /home/trevor/trevor-dashboard && git revert <h1-hub-commit>
sudo systemctl restart trevor-dashboard.service

# Trevor repo doc revert
git revert <h1-trevor-commit>

# DB cleanup (only if you want to wipe chat history; tables additive
# so harmless to leave):
# sqlite3 trevor.db "DROP TABLE IF EXISTS chat_messages;
#                    DROP TABLE IF EXISTS chat_sessions;"
```

### Sentinel

```
H1_COMPLETE: chat_modal=PASS suggestions_n=6/6 streaming_token_count=1 budget_block_test=PASS budget_restored_to_pre=YES chat_sessions_created=2 chat_messages_inserted=3 sacred_manifest_verified=YES build=PASS hub_restart=OK open_positions_unchanged=YES canaries=CLEAN dashboard_commit=<hash> trevor_commit=<hash> wave_h=CLOSED
```

Wave H closes. Next: Wave I (verify_deploy.sh + sister-infra hardening
+ post-redesign GCS snapshot + RECOVERY.md fixes) per the H1 prompt's
§9 closer.

## G2 — System Health + Aggressive Mode + Memory Centering (shipped 2026-05-01)

Closes the MEMORY zone. Two new sub-tabs (`/memory?tab=health`, `/memory?tab=aggressive`) replace G1 placeholders + centering wrapper added on the MemoryZoneView dispatcher. Wave G complete (5/5 sub-tabs shipped). Bot service `trevor.service` UNTOUCHED. Sacred 12/12 byte-identical pre/post. Filter rules UNCHANGED. Schema UNCHANGED for existing tables (only additive `auto_config` flag seeded). `aggressive_mode_history` reused as audit table per the delegated approach (see Phase 0 reconciliation in trevor CLAUDE.md G2 section).

### Phase 1 — Memory zone centering

`src/components/memory/memory-zone-view.tsx` rewritten as IIFE that wraps every sub-tab's component output in `<div className="mx-auto w-full max-w-screen-2xl">`. All 5 cases (brain / memory / chromadb / health / aggressive) inherit identical centering on desktop while preserving the inner section wrappers' `space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in` padding. Default fall-through routes to BrainSection (was placeholder EmptyState pre-G2). Mobile width unaffected because the wrapper renders 100% by default and only caps at `max-w-screen-2xl` (1536px) on desktop+.

### Phase 2 — System Health backend

**`query_system_health.py`** (top-level dashboard helper, ~290 lines, mode=ro URI). Self-probe collector script returning `{snapshot_at, killswitch_enabled, services[3], collectors[11], sentinels[≤10], source, stale_seconds}` JSON.

**11 collectors** (all defensively-wrapped — every collector catches its own exceptions and returns a degraded entry instead of raising):
- **cpu** — `/proc/loadavg` + `/proc/cpuinfo`; tone green<70% / amber70-90% / red>90%
- **memory** — `/proc/meminfo` MemTotal vs MemAvailable
- **disk** — `os.statvfs("/")` total/free/used
- **network** — `subprocess.run(["ping","-c1","-W1","1.1.1.1"])`, 3s timeout
- **db_size** — `os.path.getsize` on `trevor.db` + `-wal` companion
- **db_writability** — read-only PRAGMA `journal_mode` + `SELECT 1` (NOT a real write probe — G2 doesn't introduce any write paths)
- **vectordb_size** — `os.walk("/home/trevor/trevor/vectordb")` total bytes
- **litestream** — `systemctl is-active litestream.service`
- **ghost_qa_heartbeat** — `systemctl is-active ghost-qa.service`
- **scanner_lag** — last `loop_heartbeat WHERE loop_name='scalp_scan_loop'` row vs current time, tone green if <2× cadence, amber 2-5×, red >5×
- **autotrader_pulse** — reads `auto_config.AUTO_LIVE_ENABLED` (NOT `KILLSWITCH_ENABLED` — that key doesn't exist; killswitch lives at `EMERGENCY_KILLSWITCH`)

**3 services** (traffic-lit): `trevor.service`, `trevor-dashboard.service`, `ghost-qa.service` via `systemctl is-active` (active=green, activating/reloading=amber, otherwise=red).

**Sentinels** — tail last 64KB of `/home/trevor/trevor/logs/trevor.log`, filter for `| WARNING |` / `| ERROR |` / `| CRITICAL |`, return last 10 with `{ts, level, tag, message[≤240]}`. Tag extracted via regex `\[([A-Z][A-Z0-9_-]*)\]`. Drops the leading possibly-truncated line because `seek(size-64KB)` may land mid-line. **Prompt's hardcoded tag list (`KILLSWITCH-ON/OFF`, `BACKFILL_DONE`, `OPTUNA_FINISHED`, `REGRESSION`) had ZERO matches in production logs** — actual production tags are `[CB] [SCAN-DUR] [LIVE-EXEC] [AUTO-TRADER] [AUTO-JUDGMENT] [LOOP-HEALTH] [AUTO-MONITOR] [ALT-DATA] [BETA] [THEORETICAL]`. Helper extracts whatever tag appears, doesn't filter to a predefined list.

**Killswitch** — reads `auto_config.EMERGENCY_KILLSWITCH` (correct key per A2 deployment).

**`/api/memory/health/route.ts`** — GET only, no caching (30s client-side polling). Returns HTTP 200 with degraded shape on any error so UI handles failure gracefully (per prompt §2.2).

### Phase 3 — Aggressive Mode backend (DELEGATED architecture)

**Critical Phase 0 finding**: prompt's design (auto_config.AGGRESSIVE_MODE + new `aggressive_mode_audit` table) was incompatible with the bot's existing infrastructure. The bot reads `aggressive_mode_config` (NOT auto_config), and `query_aggressive_mode.py` already shipped 2026-04-10 with full enable/disable/extend handlers writing to `hub_commands` queue. Ghost approved the **delegated approach** at THOUGHTS gate: build new G2 surface that DELEGATES to existing infrastructure + adds the `HUB_AGGRESSIVE_TOGGLE_ENABLED` flag gate.

**`query_aggressive.py`** (top-level dashboard helper, ~120 lines, mode=ro URI). Returns:
```json
{
  "enabled": bool,                  // from aggressive_mode_config.enabled
  "threshold_delta": int,
  "enabled_at": str,
  "revert_at": str,
  "enabled_by": str,
  "reason": str,
  "total_signals_fired": int,
  "minutes_until_revert": int,      // computed if revert_at non-null
  "toggle_enabled": bool,           // HUB_AGGRESSIVE_TOGGLE_ENABLED — NEW G2 gate
  "killswitch_enabled": bool,       // EMERGENCY_KILLSWITCH — informational
  "audit": [...]                    // last 5 from aggressive_mode_history
}
```

**`set_aggressive.py`** (top-level dashboard helper, ~150 lines, RW connection). Args: `<true|false> <author>`. Behavior:
1. Refuse if `HUB_AGGRESSIVE_TOGGLE_ENABLED != 'true'` → exit 3 with `{ok:false, gate_locked:true}`
2. Read current `aggressive_mode_config.enabled`. Idempotent: if matches requested → exit 0 with `{ok:true, no_change:true}` (no audit row, no queue)
3. Otherwise, in single transaction:
   - INSERT `hub_commands` row (`AGGRESSIVE_ON` / `AGGRESSIVE_OFF`) — bot's `hub_close_poll_loop` applies within ~10s
   - INSERT `aggressive_mode_history` row (`event_type=enable|disable, actor=<author>, reason='g2_hub_toggle:<author>'`)
4. Print `{ok:true, no_change:false, prev_value, new_value, command_id, audit_id, queued, note}` + exit 0

Defaults `DELTA=-5`, `HOURS=48` for ON; OFF passes `reason` only. Exit codes: `0` success, `1` usage, `2` DB error, `3` gate locked.

**`/api/memory/aggressive/route.ts`** — GET via `runPython("query_aggressive.py")`, POST via `spawnSync` directly (NOT `runPython`) so we can capture stdout regardless of exit code. Maps Python exit codes:
- `0` → HTTP 200
- `3` → **HTTP 423 (Locked)** with `{gate_locked:true}` payload
- `1` → HTTP 400
- else → HTTP 500

**Why spawnSync not runPython**: `runPython` throws on non-zero exit and discards stdout. Set_aggressive.py exits 3 on gate-lock and we need to surface the JSON payload to the caller (per prompt §3.4). Inline `spawnSync` reads both stdout + status cleanly.

**HUB_AGGRESSIVE_TOGGLE_ENABLED seeded** to `'false'` in `auto_config` via additive INSERT OR IGNORE per Rule 15 (no schema change, no new columns).

### Phase 4 — UI Components

**`<HealthSection>`** (`src/components/memory/health-section.tsx`, ~280 lines, A4 primitives only):
- Killswitch banner — `<Card glow={engaged?"red":"none"}>` + `ShieldOff` icon, `<Pill tone={"red"|"neutral"} pulse={engaged}>` showing `EMERGENCY_KILLSWITCH`
- Services grid — 1col mobile / 3col tablet+, each entry: traffic-light dot + name + status text
- Collectors grid — 2col / 3col / 4col responsive, `<MetricTile>` per collector with green/warn/negative tone mapping
- Sentinels list — last 10 in `<ul>`, each row has `<Pill tone>` for level (amber=WARNING, red=ERROR, magenta=CRITICAL) + cyan `<Pill>` for tag + ts + message
- 30-second `setInterval` polling, cleanup on unmount, `refreshing` state shown in footer
- EmptyState fallbacks for empty services / collectors / sentinels

**`<AggressiveModeSection>`** (`src/components/memory/aggressive-section.tsx`, ~340 lines):
- Hero card — `<Card padding="lg" glow={enabled?"magenta":"none"}>` with `Zap` icon, ENGAGED/Off label, Δ + revert ETA when enabled, last enabled_at + enabled_by
- Description card — explains aggressive mode (lower threshold, removes scoring brakes for 48h, auto-reverts, respects killswitch + $50 cap, does NOT auto-close)
- Killswitch advisory — only renders when `killswitch_enabled=true`; amber `<Card>` warning that toggle still permitted but no execution will occur
- Toggle controls — `<HapticButton variant="primary">` Set ON / `<HapticButton variant="secondary">` Set OFF in 2-col grid; both disabled when `toggle_enabled=false` (locked state shows amber `<Card>` with `<Lock>` icon explaining how to unlock); current state's button also disabled (can't set ON when ON)
- Result feedback — green/red banner inline after toggle attempt
- Recent toggles list — last 5 audit rows with `<Pill>` per event_type (enable=magenta, auto_revert=amber, disable=neutral) + Δ/duration/timestamp + `by {actor}` + reason
- **2-tap BottomSheet confirmation** — `<BottomSheet>` opens on toggle button tap; sheet body has warning text + author=ghost note + audit-row info + Cancel / Confirm row. Second tap on Confirm POSTs to `/api/memory/aggressive`. Submit state disables Cancel + closes on success.

**`<MemoryZoneView>`** wired to dispatch all 5 cases to real components (no placeholders). Imports from `./brain-section`, `./memory-section`, `./chroma-section`, `./health-section`, `./aggressive-section`.

**`/api/aggressive/route.ts` (LEGACY) updated**: defense-in-depth flag gate. New `isToggleEnabled()` helper calls `query_aggressive.py` and reads `toggle_enabled` field. POST handler short-circuits to HTTP 423 when flag is off. GET path unchanged (read access for live-board / chat-empty-state / lesson-card displays). Single contract: any aggressive write surface gates behind `HUB_AGGRESSIVE_TOGGLE_ENABLED`.

**Navigation labels** (`src/lib/navigation.ts:111-115`) already had correct G1-shipped labels: `Brain / Memory / ChromaDB / System Health / Aggressive`. No edits needed.

### Phase 5 — Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean, 0 errors |
| `npm run build` | clean, /memory bundle 7.86 kB / 120 kB First Load |
| `query_system_health.py` smoke | 11 collectors / 3 services / 10 sentinels, killswitch=false |
| `/api/memory/health` | HTTP 200, 11 collectors / 3 services / 10 sentinels |
| `query_aggressive.py` smoke | full payload, toggle_enabled=false, killswitch=false, audit list with 5 entries |
| `/api/memory/aggressive` GET | HTTP 200, full state |
| `/api/memory/aggressive` POST flag off | **HTTP 423**, `{gate_locked:true}` |
| `/api/aggressive` POST flag off (legacy) | **HTTP 423** (defense-in-depth) |
| Round-trip with flag on | POST true → 200 (audit_id #10, command_id #9), bot applies AGGRESSIVE_ON in 15s (config.enabled=1, threshold_delta=-5), POST false → 200 (audit_id #12), bot applies AGGRESSIVE_OFF in 15s (config.enabled=0). Final: 4 history rows (enable/hub-bot, disable/hub-bot, enable/smoke-hub, disable/smoke-hub). Restored to PRE state. |
| `/memory?tab=*` × 5 sub-tabs + 4 other zones | 9/9 HTTP 200 |
| Rollback rehearsal (`HUB_REDESIGN_MEMORY=false`) | shows "Temporarily Disabled" placeholder; flag-back-on returns 200 |
| Open positions baseline | Auto=0, Active=73 (matches Phase 0 baseline) |
| Sacred files 12/12 | byte-identical (only the pre-existing 1-line "improperly formatted" warning per `project_sacred_manifest_paths.md`) |
| 6 canaries POST-deploy | CLEAN (C1=2 pre-existing legitimate `auto_close_time` field-name string refs, C5=2 pre-existing `_is_duplicate_signal`/`_dedup_alert_lines` text helpers, all others 0) |
| `signal_filter_rules` | UNCHANGED (1 inert REGIME_THRESHOLD_CAP enabled=0 row per Rule 30) |

### Bot artifacts (every audit row visible in Discord journalctl per existing infrastructure)

When G2 toggle queues an `AGGRESSIVE_ON` command, the bot's `hub_close_poll_loop` picks it up within ~10s and processes via the existing `aggressive_mode.enable()` singleton at `aggressive_mode.py`. That code path:
1. Calls `circuit_breaker.CircuitBreakerSystem().get_status().get("overall_status")` — refuses to engage on non-GREEN CB (pre-G2 behavior preserved)
2. Sets `aggressive_mode_config.enabled=1`, `threshold_delta=-5`, `enabled_at=now`, `revert_at=now+48h`, `enabled_by='hub'`, `reason=<G2 toggle reason>`
3. Writes its own `aggressive_mode_history` row (event_type=enable, actor='hub', reason=<same as G2 toggle reason>)
4. Emits `[AGGRESSIVE] ENABLED delta=-5 duration=48.0h revert_at=...` at WARNING

So every G2 toggle produces TWO audit rows: one from the Hub helper (actor=author from POST body, captures Ghost intent) + one from the bot side (actor='hub', captures bot acknowledgment). This is the actual delegated audit trail and is the design Ghost approved at the THOUGHTS gate.

### Files (Hub repo)

- `query_system_health.py` (new, ~290 lines, executable)
- `query_aggressive.py` (new, ~120 lines, executable)
- `set_aggressive.py` (new, ~150 lines, executable)
- `src/app/api/memory/health/route.ts` (new)
- `src/app/api/memory/aggressive/route.ts` (new)
- `src/components/memory/health-section.tsx` (new, ~280 lines)
- `src/components/memory/aggressive-section.tsx` (new, ~340 lines)
- `src/components/memory/memory-zone-view.tsx` (rewritten — IIFE dispatcher + `mx-auto max-w-screen-2xl` wrapper)
- `src/app/api/aggressive/route.ts` (+13 lines — flag-gate POST handler, GET unchanged)

### What G2 does NOT do

- Does NOT modify `aggressive_mode.py` (sacred path — bot side untouched)
- Does NOT modify `aggressive_mode_config` table schema (existing 9-col schema reused as-is)
- Does NOT create a new `aggressive_mode_audit` table — `aggressive_mode_history` already serves the audit role
- Does NOT call Anthropic API
- Does NOT send Discord messages from Hub side (helpers only write to DB; bot's `hub_close_poll_loop` handles Discord)
- Does NOT modify killswitch (purely informational read in both `health` and `aggressive` views)
- Does NOT auto-close any position (Rule 1 preserved end-to-end)
- Does NOT bypass $50 cap or per-ticker thresholds
- Does NOT touch any sacred file
- Does NOT modify `trevor.service` (only `trevor-dashboard.service` restarted)

### Sentinel

```
G2_COMPLETE: subtabs_shipped=5/5 collectors=11/11 services=3/3 centering_fixed=YES aggressive_round_trip=PASS aggressive_restored=YES sacred_manifest_verified=YES build=PASS hub_restart=OK rollback_verified=YES open_positions_unchanged=YES canaries=CLEAN dashboard_commit=<TBD> trevor_commit=<TBD> wave_g=CLOSED runtime_min=~50
```

Wave G closes. Wave I (sister-infra hardening + verify scripts + RECOVERY.md) shipped 2026-05-01 ahead of G2 (out-of-order due to sprint sequencing). All 5 MEMORY sub-tabs live; entire MEMORY zone redesign complete.



## SCALP → MANUAL Rename + Sub-tab Consolidation (2026-05-02)

Renamed the SCALP zone to MANUAL and collapsed its 4 sub-tabs (Live Board /
Recent / Quality / Calibration) into one collapsible "Scalp Trading"
section. The zone is now a host page for manual systems that display info
but never trade autonomously; future manual sections (DEGEN signals,
sentiment scanner, etc.) drop in below as additional `<CollapsibleSection>`s.

### Route + nav rename

- `mv src/app/scalp src/app/manual`
- `src/lib/navigation.ts` — ZoneId `"scalp"` → `"manual"`; SCALP zone block
  rewritten as MANUAL (id/label/shortLabel "Manual", href `/manual`,
  accent unchanged); **`subTabs` + `defaultSubTab` removed** (single
  composition page now). LEGACY_REDIRECTS appended `["/scalp", "/manual"]`.
- `src/middleware.ts` — legacyMap added `"/scalp": "/manual"` 308 redirect
  alongside the existing `/trading` → `/manual` (was `/scalp`).
- `src/app/manual/page.tsx` — display label `SCALP` → `MANUAL` in disabled
  state; functions `ScalpPage` → `ManualPage`, `ScalpDisabled` →
  `ManualDisabled`, cache fn `isHubRedesignScalpOn` → `isHubRedesignManualOn`.
  Drops `searchParams.tab` (no sub-tabs) and the `subtab` prop on
  `<ScalpZoneView>`.

### Sub-tab consolidation

- New `src/components/ui/collapsible-section.tsx` primitive — chevron-toggle
  header + 200ms rotation transition + React state. Exported from
  `@/components/ui` barrel for reuse.
- `src/components/scalp/scalp-zone-view.tsx` rewritten — no more `switch`
  on subtab. Renders one `<CollapsibleSection title="Scalp Trading"
  defaultOpen>` containing `<LiveBoardSection /> <RecentSignalsSection />
  <QualitySection /> <CalibrationSection />` stacked vertically. The
  CalibrationSection already mounts `<ResetControlsCard />` internally,
  so reset buttons remain at the bottom — no extra wiring.

### Things deliberately preserved (per Rule 16 / Phase 0 §2C)

- Flag name `HUB_REDESIGN_SCALP` (auto_config row + cookie override key
  + `src/lib/feature-flags.ts` const)
- Components dir `src/components/scalp/` and the 5 section files
  (internal namespace; section IS still called "Scalp Trading")
- Internal symbols `ScalpZoneView` / its file path
- Backend system enum `{auto, degen, scalp}` in dashboard PnL routes +
  hero/active cards (backend payload type, not UI label)
- API query params `?mode=scalp`, `activeScalps` field, `scalp_signals`
  table — all backend
- AUTO zone's `Scalper` bot section (totally unrelated feature)
- System prompt mention of "scalp trading system" in chat stream
  (backend AI prompt, not Manual UI)

### Verification

- `npm run build` clean — `/manual` 5.87 kB / 119 kB First Load,
  `/scalp` removed from route table
- `/manual` HTTP 200, "Manual" label rendering in BottomNav + SidebarRail
  (3 occurrences)
- `/scalp` HTTP 308 → `/manual` (follow → 200) — bookmark-safe
- `/trading` HTTP 308 → `/manual` (legacy redirect retargeted)
- All other zones (`/dashboard`, `/autotrader`, `/intel`, `/memory`,
  `/chat`) HTTP 200
- HTML markers on `/manual`: Scalp Trading×1, LIVE BOARD×1, RECENT
  SIGNALS×1, SIGNAL QUALITY×1, CALIBRATION×1, RESET CONTROLS×1
- Sub-tab strip auto-hides — `zone-sub-tabs.tsx:17` returns null when
  `zone.subTabs` is undefined
- `trevor.service` UNTOUCHED — ActiveEnterTimestamp 2026-05-02 01:44:44
  UTC unchanged through the work

### Browser smoke disclosure

CC cannot operate a real browser. SSR HTML markers, route status codes,
build output, and component composition were verified via authenticated
curl + tsc + npm. Visual UX (CollapsibleSection chevron rotation,
mobile-bottom-nav long-press behavior on the now-subtabless MANUAL zone,
fade-in stacking of the 4 sections, exact pixel layout) was NOT exercised
in a browser; real-device smoke is the honest validation step Ghost
performs after merge.

### Files

- New: `src/components/ui/collapsible-section.tsx`
- Renamed: `src/app/scalp/{page,loading}.tsx` → `src/app/manual/{page,loading}.tsx`
- Modified: `src/app/manual/page.tsx` (rename functions + display label)
- Modified: `src/components/scalp/scalp-zone-view.tsx` (consolidation)
- Modified: `src/lib/navigation.ts` (zone rename + subTabs removed + legacy redirect)
- Modified: `src/middleware.ts` (legacy redirect)
- Modified: `src/components/ui/index.ts` (CollapsibleSection barrel export)
- Modified: `CLAUDE.md` (this section)

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display-only restructure. Rule 14 (sacred files)
— UNTOUCHED (zero Python edits; only Hub frontend). Rule 15 (additive DB)
— N/A (no schema changes). Rule 16 (surgical edits) — only the 8 listed
files staged. Rule 22 (no Discord channels touched). Rule 30 (no
ticker/direction blocks) — `signal_filter_rules` UNCHANGED. Rule 32
(KILLSWITCH-only project-wide pause; UI Stop banned) — ENFORCED, no kill
affordance. No new npm dependencies. JetBrains Mono only. Cyberpunk
palette only via A4 tokens. `trevor.service` UNTOUCHED — only
`trevor-dashboard.service` restarted.

### Rollback

```bash
git revert <this-commit>
sudo systemctl restart trevor-dashboard.service
# Restores /scalp route + 4 sub-tabs + ScalpZoneView switch + zone label.
# trevor.service untouched either way.
```


## Hub: Manual Page Card Restyle (2026-05-02)

Restyled the Scalp Trading section on `/manual` to match the Auto page's
Scalper card pattern. The previous CollapsibleSection chevron wrapper is
gone; `/manual` is now a stack of independent `<Card>`s mirroring
`ScalperViewV2`'s structure: system header card on top, content cards
below, each as its own bordered card with consistent spacing.

### Changes

- **New** `src/components/scalp/scalp-header.tsx` — system header card.
  `<Card padding="md" glow="magenta">` (zone accent: violet → magenta-glow
  per `accentGlowClass()`) with `Activity` icon (zone identity), "SCALP
  TRADING" h3 + "Manual Signals · 5 tickers" subtitle, `<LivePulse
  tone="cyan" label="LIVE">`, `<KillswitchPill />` mirror. Static — no API
  fetch (display + manual-entry zone has no operational state to track).
- **Stripped outer page-padding wrappers** from
  `live-board-section.tsx`, `recent-signals-section.tsx`,
  `quality-section.tsx`, `calibration-section.tsx`. Each section now
  emits a bare `<Card>` (or fragment for sections with sibling cards like
  Calibration's `<ResetControlsCard />`). Behavior, data fetching, SSE
  polling, ENTER button flow, reset confirmation modal — all UNCHANGED.
- **`scalp-zone-view.tsx` rewritten** to mirror `ScalperViewV2`: outer
  `<div className="space-y-4 p-4 md:space-y-6 md:p-6 lg:px-8 animate-fade-in">`
  containing `<ScalpHeader />` + 4 section cards stacked. No
  CollapsibleSection wrapper.

### Verification

- `npm run build` clean — `/manual` 5.96 kB / 119 kB First Load
- HTTP 200 on `/manual`; SSR markers present: SCALP TRADING ×1, Manual
  Signals ×1, 5 tickers ×1, LIVE BOARD ×1, RECENT SIGNALS ×1, SIGNAL
  QUALITY ×1, CALIBRATION ×1, RESET CONTROLS ×1, shadow-glow-magenta ×1.
- `aria-expanded` count = 0 (CollapsibleSection no longer in use here).
- Legacy redirects intact: `/scalp` 308 → `/manual`, `/trading` 308 →
  `/manual`. All other zones (`/dashboard`, `/autotrader`, `/intel`,
  `/memory`, `/chat`) HTTP 200.
- Live Board API still returns ticker data with real conf/regime fields
  (`/api/live-board` 200, BTC SHORT/32.45/RANGING in payload).
- Killswitch API returns full state.
- Sacred files (9/9) UNCHANGED — md5 baseline matches start of session.
- `trevor.service` UNTOUCHED — ActiveEnterTimestamp `Sat 2026-05-02
  01:44:44 UTC` unchanged across the work.

### Browser smoke disclosure

CC cannot operate a real browser. SSR HTML markers, route status codes,
build output, and component composition were verified via authenticated
curl + npm. Visual UX (magenta border-glow rendering, header alignment
on mobile vs lg+, gap between stacked cards on real devices, side-by-side
comparison vs Scalper section pixel-for-pixel) was NOT exercised in a
browser; real-device smoke is the honest validation step Ghost performs
after merge.

### Files

- New: `src/components/scalp/scalp-header.tsx`
- Modified: `src/components/scalp/scalp-zone-view.tsx`
- Modified: `src/components/scalp/live-board-section.tsx`
- Modified: `src/components/scalp/recent-signals-section.tsx`
- Modified: `src/components/scalp/quality-section.tsx`
- Modified: `src/components/scalp/calibration-section.tsx`
- Modified: `CLAUDE.md` (this section)

### What this does NOT do

- Does NOT touch Auto page, Dashboard, Intel, or Memory zones.
- Does NOT modify any API route, query helper, or Python file.
- Does NOT change SSE, polling cadence, ENTER flow, or reset endpoints.
- Does NOT delete `src/components/ui/collapsible-section.tsx` (kept as
  reusable primitive even though unused on `/manual` now).
- Does NOT modify `signal_filter_rules`, `auto_config`, or any DB row.
- Does NOT modify `trevor.service` — only `trevor-dashboard.service`
  restarted.

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display-only restyle. Rule 14 (sacred files) —
9/9 byte-identical. Rule 15 (additive DB) — N/A. Rule 16 (surgical) —
only listed files staged; section internals untouched, only their outer
padding-wrapper divs removed. Rule 22 (no Discord channels). Rule 30
(no ticker/direction blocks) — `signal_filter_rules` UNCHANGED. Rule
32 (KILLSWITCH-only project-wide pause; UI Stop banned) — ENFORCED, no
kill button on `/manual`. No new npm dependencies. JetBrains Mono only.
Cyberpunk palette only via A4 tokens.

### Rollback

```bash
git revert <this-commit>
sudo systemctl restart trevor-dashboard.service
# Restores CollapsibleSection wrapper + per-section page-padding wrappers.
# trevor.service untouched either way.
```

## Hub: Manual Page SCALP / STOCK Sub-tabs (2026-05-02)

Re-added a sub-tab strip to the MANUAL zone using the canonical
`<ZoneSubTabs />` pattern (NOT inline useState) so the strip is
pixel-identical to the AUTO page's SCALPER / DEGEN strip — same TabBar
primitive, same sticky-top chrome, same URL-sync via `?tab=`.

### Changes

- `src/lib/navigation.ts` — added `subTabs: [{key:"scalp"},{key:"stock"}]` +
  `defaultSubTab: "scalp"` to MANUAL zone. `<ZoneSubTabs />` automatically
  renders the strip; auto-hide branch (`!zone.subTabs`) no longer triggers
  on `/manual`.
- `src/app/manual/page.tsx` — accepts `searchParams: Promise<{tab?:string}>`,
  passes `subtab` prop to `<ScalpZoneView>` (mirrors AUTO page pattern).
- `src/components/scalp/scalp-zone-view.tsx` — accepts `subtab?` prop;
  switches to `<StockSection />` on `subtab === "stock"`, else current
  scalp composition. Marked `"use client"`.
- New `src/components/scalp/stock-section.tsx` — magenta header card
  ("STOCK TRADING · MANUAL · COMING SOON") + one placeholder content card.

### Verification

- `tsc --noEmit` clean; `npm run build` clean (`/manual` 5.96 → 6.2 kB)
- All 9 routes 200: `/manual`, `/manual?tab=scalp`, `/manual?tab=stock`,
  `/autotrader`, `/autotrader?tab=degen`, `/dashboard`, `/intel`,
  `/memory`; `/scalp` 308 → `/manual`
- SSR markers: `/manual` default → SCALP TRADING + LIVE BOARD + RECENT
  SIGNALS + SIGNAL QUALITY + CALIBRATION + RESET CONTROLS; `/manual?tab=stock`
  → STOCK TRADING + COMING SOON + "Stock trading section" + "coming soon"
- Sub-tab strip markup byte-identical to `/autotrader` (same `aria-current`
  + `>Scalp< >Stock<` button labels mirror `>Scalper< >Degen<`)
- 13/13 recurring-bug canaries PASS post-deploy
- 0 errors/warnings in `journalctl -u trevor-dashboard.service` since restart
- `trevor.service` UNTOUCHED — ActiveEnterTimestamp `Sat 2026-05-02 01:44:44 UTC`

### Browser smoke disclosure

CC cannot operate a real browser. SSR HTML markers, route status codes,
build output, sub-tab strip parity vs AUTO were verified via authenticated
curl + tsc + npm. Visual UX (active-tab underline glow, click-to-switch
animation, mobile long-press BottomSheet on the MANUAL nav icon now that
sub-tabs exist) was NOT exercised in a browser; real-device smoke is the
honest validation step Ghost performs after merge.

### Files

- Modified: `src/lib/navigation.ts`
- Modified: `src/app/manual/page.tsx`
- Modified: `src/components/scalp/scalp-zone-view.tsx`
- New: `src/components/scalp/stock-section.tsx`
- Modified: `CLAUDE.md` (this section)

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — display-only restructure. Rule 14 (sacred files)
— UNTOUCHED (zero Python/sacred .md edits). Rule 15 (additive DB) — N/A.
Rule 16 (surgical) — only the 4 listed files staged. Rule 22 (no Discord
channels). Rule 30 (no ticker/direction blocks) — `signal_filter_rules`
UNCHANGED. Rule 32 (KILLSWITCH-only project-wide pause; UI Stop banned)
— ENFORCED, no kill affordance added. No new npm dependencies. JetBrains
Mono only. Cyberpunk palette only via A4 tokens. `trevor.service`
UNTOUCHED — only `trevor-dashboard.service` restarted.

### Rollback

```bash
git revert <this-commit>
sudo systemctl restart trevor-dashboard.service
# Restores subtab-less MANUAL zone (single composition page, no strip).
# trevor.service untouched either way.
```

## Killswitch + Aggressive Unlock + AutoTrader Toggle (2026-05-02)

Three coordinated changes during a Ghost-authorized experimentation window.
Two are pure DB flips (no code); one introduces a NEW Hub write surface
under a Rule 32 carve-out codified in `BEHAVIOR_RULES.md` the same session.

### What shipped

1. **Emergency killswitch ON** — flipped `auto_config.EMERGENCY_KILLSWITCH`
   to `'true'` plus the 3 audit metadata rows
   (`_LAST_TOGGLE`/`_LAST_AUTHOR='cc_session'`/`_LAST_REASON`). Bot's
   cached `auto_trader/killswitch.is_killswitch_on()` returns True after
   the 5s TTL. Hub `KillswitchPill` mirror reflects state via
   `/api/killswitch`. **No service restart.** No position closed,
   no order canceled (Rule 1).
2. **Aggressive toggle unlocked** —
   `auto_config.HUB_AGGRESSIVE_TOGGLE_ENABLED='true'`. Existing G2
   2-tap `<AggressiveModeSection>` UI becomes clickable; `/api/memory/aggressive`
   returns `toggle_enabled: true`. Zero code changes.
3. **AutoTrader Pause / Resume toggle (Rule 32 carve-out)** — single new
   Hub write surface for `auto_config.AUTO_TRADER_ENABLED`. Mirrors the
   G2 aggressive pattern exactly:
   - `query_autotrader_enabled.py` (READ-ONLY: state + gate flag + last 5 audit rows)
   - `set_autotrader_enabled.py` (gate-checked, idempotent, audit-row-on-change; exit codes 0/1/2/3)
   - `/api/memory/autotrader-toggle` (GET + POST; exit 3 → HTTP 423)
   - `<AutoTraderToggleCard>` rendered at the bottom of the AUTO `?tab=scalper` view
   - Defense in depth: locked behind new
     `auto_config.HUB_AUTOTRADER_TOGGLE_ENABLED` flag (must be flipped
     to `'true'` per session)
   - 2-tap BottomSheet confirmation. Pause OFF blocks NEW AT entries
     only; manual `#scalp-signals` cards keep firing; open positions
     stay monitored (Rule 1 + Rule 31).

### Verification (all PASS)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run build` | clean (`/autotrader` 5.78 → 7.75 kB, +1.97 kB for the toggle card) |
| Bot reads after Phase 1 | `auto_trader.killswitch.is_killswitch_on()` returns True after 5s cache TTL |
| Hub mirror | `/api/killswitch` returns `enabled:true` with audit metadata |
| Aggressive unlock | `/api/memory/aggressive` returns `toggle_enabled:true` |
| Toggle helpers smoke | gate-locked exit 3 → unlock → bad-value exit 1 → idempotent no-op exit 0 → real flip true→false→true; 4 audit rows; bot's `cfg_bool('AUTO_TRADER_ENABLED')` reflects each flip |
| `/api/memory/autotrader-toggle` GET | 200 with full state |
| POST bad value | 400 |
| POST gate-locked | 423 |
| POST true→false→true round-trip | 200 / 200, audit ids #3 + #4 written |
| Bundle inspection | `/_next/static/chunks/app/autotrader/page-*.js` contains `AutoTrader Control`, `Resume Trading`, `Pause Trading`, `HUB_AUTOTRADER_TOGGLE_ENABLED`, `Confirm Resume`, `Confirm Pause`, `autotrader_state_audit`, etc. |
| Sacred files (9/9 Python+brain .md) | byte-identical via `md5sum -c /tmp/sacred_baseline.md5` |
| `signal_filter_rules` | UNCHANGED (1 inert REGIME_THRESHOLD_CAP enabled=0 reseed per Rule 30) |
| Open positions baseline | 0 active / 0 auto live (matches Phase 0 baseline) |
| `trevor.service` | UNTOUCHED — ActiveEnterTimestamp `Sat 2026-05-02 01:44:44 UTC` preserved through Phases 1, 2, 3B |
| `trevor-dashboard.service` | restart healthy (1 restart for Phase 3B build) |

### Browser smoke disclosure

CC cannot operate a real browser. SSR HTML markers, every endpoint, the
gate-lock 423 path, the round-trip toggle, the bot-side `cfg_bool` read,
and the bundled component code were all verified via authenticated curl
+ direct Python invocation. Visual UX (BottomSheet slide-up animation,
2-tap haptic feedback on the Pause/Resume buttons, accent color tone
swaps when state flips, mobile breakpoint behavior at 375 / 390 / 430)
was NOT exercised in a browser; real-device smoke is the honest
validation step Ghost performs after merge.

### Files

**Hub repo (this commit):**
- New: `query_autotrader_enabled.py`, `set_autotrader_enabled.py`
- New: `src/app/api/memory/autotrader-toggle/route.ts`
- New: `src/components/autotrader-v2/autotrader-toggle-card.tsx`
- Modified: `src/components/autotrader-v2/scalper-view.tsx` (import + render at bottom of SCALPER sub-tab)
- Modified: `CLAUDE.md` (this section)

**Trevor repo (sibling commit, --no-verify per `feedback_sacred_bypass`):**
- Modified: `BEHAVIOR_RULES.md` Rule 32 — appended Rule 32 carve-out (2026-05-02, Ghost-approved): a single, narrow exemption for an `AUTO_TRADER_ENABLED`-only Hub toggle. NOT a project-wide pause; killswitch remains the only mechanism that blocks both manual signals AND AT entries.

### What this does NOT do

- Does NOT add a Hub button that writes the killswitch — `KillswitchPill` stays read-only mirror; `!killswitch` Discord remains the single project-wide pause.
- Does NOT close any open position, cancel any HL order, or restart any service (Rule 1 + Rule 31 still binding under both killswitch and AT-pause).
- Does NOT add a Discord `!autotrader on/off` command (carve-out allows it as future work).
- Does NOT modify `auto_trader/manager.py`, `config.py`, or any other bot file — the bot's existing `cfg_bool('AUTO_TRADER_ENABLED')` check at `auto_trader/config.py:133` is the single read site, unchanged.
- Does NOT modify `signal_filter_rules`.
- Does NOT touch any sacred Python file.
- Does NOT modify `trevor.service` — only `trevor-dashboard.service` restarted (once after Phase 3B build).

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — toggle never closes a position. Rule 14 (sacred
files) — 9/9 byte-identical (BEHAVIOR_RULES.md modified per spec via
`--no-verify` per memory `feedback_sacred_bypass`). Rule 15 (additive DB)
— new `autotrader_state_audit` table created lazily on first write +
new `auto_config` rows via `INSERT OR REPLACE`; no DROP, no ALTER, no
DELETE. Rule 16 (surgical) — only listed files staged. Rule 22 (no
Discord channels touched). Rule 26 (no shell interpolation) — every
Python invocation goes through `runPython` (argv) or direct `spawnSync`
with argv (mirrors `/api/memory/aggressive`). Rule 30 (no
ticker/direction blocks) — `signal_filter_rules` UNCHANGED. Rule 31
(auto trader never self-pauses) — toggle is Ghost-driven (or
future-Discord-driven), never auto-fires. Rule 32 (codified Ghost-
approved carve-out THIS SESSION, applies ONLY to `AUTO_TRADER_ENABLED`;
killswitch remains the only project-wide pause). No new npm
dependencies. JetBrains Mono only. Cyberpunk palette only via A4 tokens.

### Rollback

```bash
# Soft (15-second flag flip — restores Toggle locked state)
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='HUB_AUTOTRADER_TOGGLE_ENABLED';"
# UI gate immediately locks the buttons; existing card stays visible.

# Disengage killswitch (when ready)
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='EMERGENCY_KILLSWITCH';"
# Cache TTL 5s; bot resumes accepting signals on next loop.

# Full code revert
cd /home/trevor/trevor-dashboard && git revert <this-commit>
sudo systemctl restart trevor-dashboard.service
# Removes the toggle card + 4 backend files; AT scalper view drops back to
# 6-card composition. trevor.service untouched either way.
```

## Hub-Only Control Doctrine (2026-05-02)

Completed the migration of all bot-control surfaces to the Hub. After this
ship, **`!qa status` is the only Discord command in the entire system**.
Killswitch is now a Hub-side write toggle on `MEMORY` → System Health;
the read-only banner that previously sat at the top of that page has been
replaced by an interactive 2-tap card. The AutoTrader Pause/Resume toggle
shipped earlier today (commit `d7e0fe4`) is reaffirmed under the new
doctrine. Aggressive Mode toggle (G2) unchanged. Topbar `KillswitchPill`
still mirrors state via the same `/api/killswitch` GET — no UI change to
the pill, just a docstring refresh.

### What shipped

1. **Hub killswitch write surface** — replaces the now-removed
   `!killswitch` Discord command:
   - `set_killswitch.py` — thin wrapper that calls
     `auto_trader.killswitch.set_killswitch(enabled, author, reason)` so
     the in-process bot cache busts AND `[KILLSWITCH-ON]`/`[KILLSWITCH-OFF]`
     WARNING sentinels still fire (Observatory continues to see toggles —
     though sentinel emission moves from trevor.service's journal to the
     Hub subprocess; if the Observatory monitor needs visibility into
     Hub-initiated toggles, a separate sentinel-mirror is a follow-up).
   - `/api/killswitch` route — added POST handler, refactored GET from
     `execSync` to `runPython` for Rule 26 stylistic alignment, busts the
     5s GET cache after a successful POST so the topbar pill + System
     Health card see fresh state immediately.
   - `<KillswitchControlCard>` (new component) — replaces the read-only
     banner in `health-section.tsx` with an interactive 2-tap BottomSheet
     toggle. Mirrors the G2 aggressive pattern (no flag gate — the
     killswitch toggle is always-available per the new doctrine).
   - `KillswitchPill` topbar mirror (both `src/components/KillswitchPill.tsx`
     legacy alias and `src/components/ui/killswitch-pill.tsx`) — unchanged
     behavior, docstring updated to drop the obsolete "Discord-only"
     claim.
2. **AutoTrader Pause/Resume** (already shipped commit `d7e0fe4`) —
   reaffirmed under the new doctrine. The `HUB_AUTOTRADER_TOGGLE_ENABLED`
   gate flag stays as defense-in-depth (matches the aggressive pattern).
3. **Bot side** (sibling trevor commit) — `!killswitch` / `!ks` handler
   block + the dead `_killswitch_count_open` helper deleted from
   `discord_bot.py`. `/scalp` ephemeral text updated: "Use `!killswitch
   off`" → "Release via Hub → MEMORY → System Health". `auto_trader/killswitch.py`
   module unchanged — `is_killswitch_on()` (Manager Gate 0 + signal POST
   gates) still enforced, `set_killswitch()` still emits WARN sentinel +
   busts cache. BEHAVIOR_RULES.md Rule 32 rewritten as the **Hub-Only
   Control Doctrine** with a Discord allowlist sub-section
   (`!qa status` only).

### Verification (all PASS)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `npm run build` | clean (`/memory` 8.07 → 8.89 kB, +0.82 kB for the toggle card) |
| `discord_bot.py` `python3 -m py_compile` | OK |
| Backend module post-Phase-2 | imports + reads + sets all work |
| Hub round-trip POST `{action:"on"}` → bot's `is_killswitch_on()` | True (matches DB; matches audit metadata `hub:cc` + my smoke reason) |
| Hub round-trip POST `{action:"off"}` → bot reads | False; `[KILLSWITCH-OFF]` WARN sentinel emitted by helper subprocess |
| Hub round-trip POST `{action:"on"}` (restore) → bot reads | True; `[KILLSWITCH-ON]` WARN emitted |
| Bot's gate enforcement live | `[KILLSWITCH-BLOCKED] ticker=FARTCOIN direction=SHORT` observed in trevor.service journal during smoke window — proves gate works post-handler-removal |
| Idempotent no-op (POST `on` while already on) | 200 with `no_change:true` |
| POST bad JSON | 400 |
| POST bad action | 400 |
| GET cache bust after POST | next GET returns fresh state immediately |
| AT toggle endpoint still works | 200 with full state shape (audit_id 4 visible) |
| Aggressive endpoint still works | 200, `toggle_enabled:true`, `killswitch_enabled:true` |
| Bundle inspection `/memory` | `Activate Killswitch`×2, `Release Killswitch`×2, `EMERGENCY_KILLSWITCH_LAST_`×1 (component lives in prod build) |
| Sacred files (9/9 Python+brain .md) | byte-identical via `md5sum -c /tmp/sacred_baseline_p4.md5` |
| `signal_filter_rules` | UNCHANGED |
| Open positions baseline | 0 active / 0 auto live (matches Phase 0 baseline before bot restart; AutoTrader equity $34.12 reported on init) |
| `trevor.service` restart | pre `Sat 2026-05-02 01:44:44 UTC` → post `Sat 2026-05-02 04:47:44 UTC`. First restart this session — required by Phase 2 (`!killswitch` removal). Bot started clean: 0 NameError / 0 AttributeError / 0 traceback in 60s post-restart. |
| `trevor-dashboard.service` restart | pre `04:27:07` → post `04:46:28`, active, 0 errors in journal |

### Browser smoke disclosure

CC cannot operate a real browser. SSR HTML markers, every endpoint, the
round-trip POST→bot-read→DB chain, the bundle inspection, the bot-side
sentinel emission, and the gate-enforcement live observation
(`[KILLSWITCH-BLOCKED]`) were all verified via authenticated curl,
direct Python invocation, journalctl, and sqlite3. Visual UX
(BottomSheet slide-up animation, 2-tap haptic on Activate/Release,
accent color tone swap when state flips, mobile breakpoint behavior at
375 / 390 / 430) was NOT exercised in a browser; real-device smoke is
the honest validation step Ghost performs after merge.

### Files

**Hub repo (this commit):**
- New: `set_killswitch.py` — thin wrapper around `auto_trader.killswitch.set_killswitch()`
- New: `src/components/memory/killswitch-control-card.tsx`
- Modified: `src/app/api/killswitch/route.ts` (added POST + refactor GET to `runPython` + bust cache after POST)
- Modified: `src/components/memory/health-section.tsx` (banner → `<KillswitchControlCard>`, dropped `ShieldOff` icon import that's no longer used here)
- Modified: `src/components/ui/killswitch-pill.tsx` (docstring refresh — drops "Discord-only" claim, points at the new control card)
- Modified: `CLAUDE.md` (this section)

**Trevor repo (sibling commit, --no-verify per `feedback_sacred_bypass`):**
- Modified: `BEHAVIOR_RULES.md` Rule 32 — REWRITTEN from "Killswitch is the only project-wide pause" (Discord-only) to **Hub-Only Control Doctrine**. Carve-out from prior morning's commit (`835f4c1`) deleted as part of the rewrite. New `#### Discord commands (allowlist — only ONE exists)` sub-section: `!qa status` only. Section 3 changelog entry dated 2026-05-02. Line 197 reference to `**Rule 32**` updated.
- Modified: `discord_bot.py` — deleted `_killswitch_count_open` helper (was only-caller from the !killswitch handler) + the entire `!killswitch` / `!ks` handler block (~82 lines, replaced with a 5-line removal-comment). `/scalp` ephemeral killswitch-blocked text updated to point at Hub. `python3 -m py_compile` verifies clean.

### What this does NOT do

- Does NOT change the bot's killswitch enforcement gates (Manager Gate 0 + 2 signal-card POST gates) — the `is_killswitch_on()` import sites are unchanged.
- Does NOT modify the `auto_trader/killswitch.py` module itself.
- Does NOT modify the topbar `KillswitchPill` rendering behavior — only the docstring.
- Does NOT add a kill / pause UI to any zone other than MEMORY → System Health (killswitch) and AUTO → SCALPER bottom (AT toggle, already shipped).
- Does NOT auto-close any open position, cancel any HL order, or restart any service when killswitch flips ON or OFF (Rule 1 + Rule 31 still binding).
- Does NOT introduce a new audit table for the killswitch — the existing 4 `auto_config.EMERGENCY_KILLSWITCH_LAST_*` rows + `[KILLSWITCH-ON]`/`[KILLSWITCH-OFF]` WARN sentinel IS the audit trail (skipped the prompt's `killswitch_audit` table proposal as duplicate).
- Does NOT modify the GET cache TTL for `/api/killswitch` — still 5s, busted only after a successful POST.

### Hard constraints honored

Rule 1 (NO AUTO-CLOSE) — toggle never closes a position. Rule 14 (sacred
files) — 9/9 byte-identical (BEHAVIOR_RULES.md modified per spec via
`--no-verify` per `feedback_sacred_bypass`). Rule 15 (additive DB) — no
schema changes; existing 4 `EMERGENCY_KILLSWITCH*` `auto_config` rows
get UPDATEd in-place by `auto_trader.killswitch.set_killswitch()`. Rule
16 (surgical) — only listed files staged. Rule 22 (no Discord channels
touched). Rule 26 (no shell interpolation) — POST handler uses
`runPython` with stdin via the helper's `input` option; argv passes
nothing user-controlled. Rule 30 (no ticker/direction blocks) —
`signal_filter_rules` UNCHANGED. Rule 31 (auto trader never self-pauses)
— Hub-driven killswitch is Ghost-driven, not auto-fired. Rule 32
(rewritten) — Hub-Only Control Doctrine: all bot control surfaces live
on the Hub; `!qa status` is the only Discord command. No new npm
dependencies. JetBrains Mono only. Cyberpunk palette only via A4 tokens.

### Known nuance — sentinel emission scope

The `[KILLSWITCH-ON]`/`[KILLSWITCH-OFF]` WARN sentinels fired by
`auto_trader.killswitch.set_killswitch()` now emit in the Hub-spawned
`set_killswitch.py` subprocess (their stderr is captured by spawnSync
and discarded). They no longer appear in `journalctl -u trevor.service`
the way they did when the toggle was triggered by the Discord handler
running inside the bot process. The per-blocked-signal
`[KILLSWITCH-BLOCKED]` WARN still emits inside trevor.service (verified
during smoke). If Observatory monitor `mon_03` (or successor) needs
visibility into Hub-initiated toggles, a separate sentinel-mirror would
need to be added (e.g. write the same WARN to `/home/trevor/trevor/logs/trevor.log`
via the helper). Surfacing for follow-up consideration; not blocking.

### Rollback

```bash
# Soft (15-second flag flip — disengage killswitch)
sqlite3 /home/trevor/trevor/trevor.db \
  "UPDATE auto_config SET value='false' WHERE key='EMERGENCY_KILLSWITCH';"
# Bot's 5s cache TTL → resumes accepting signals immediately.

# Full code revert (Hub side)
cd /home/trevor/trevor-dashboard && git revert <this-commit>
sudo systemctl restart trevor-dashboard.service
# Restores read-only banner in health-section, removes POST handler from
# /api/killswitch, removes set_killswitch.py + control card.

# Full code revert (bot side — restores !killswitch Discord command)
cd /home/trevor/trevor && git revert <sibling-trevor-commit>
sudo systemctl restart trevor.service
```

## Hub-side busy_timeout sweep (2026-05-02 PM)

Companion to the bot-side `P3: busy_timeout sweep + backup hardening` ship
(see trevor `CLAUDE.md` for full root-cause writeup). Investigation
triggered by 04:19-04:20 ET DB-lock storm: every Hub Python helper
spawned by `runPython` / `runPythonInline` opened SQLite with the
default `busy_timeout=0`, so any backup-window contention failed
instantly with `SQLITE_BUSY`. Fix: bumped every `sqlite3.connect()` site
in the dashboard helper layer to `timeout=10` (Python sqlite3's
connect-arg sets busy_timeout in ms).

### Scope

**63 substitutions across 47 dashboard root `*.py` helpers** — every
top-level `query_*.py`, `set_*.py`, `write_*.py`, `chat_ai.py`,
`manage_*.py` file. Pattern is uniform: connections that previously had
no timeout now get `, timeout=10` appended before the closing paren;
connections that had `timeout=2.0`/`3.0`/`4.0`/`5.0` are bumped to
`timeout=10`; the one site already at `timeout=10` (`query_quality.py:39`)
was correctly left alone (idempotent script).

### Mechanism

A one-shot regex script (`/tmp/bump_busy_timeout.py`) walked the dashboard
root, found every `sqlite3.connect(...)` call (flat args — none have
nested parens), and either replaced an existing `timeout=N` value with
`10` or appended `, timeout=10` if no timeout kwarg was present. Every
substitution was printed `file:line  before -> after` for the audit trail
(see trevor commit message for the full report).

### Why no Hub restart needed

The Hub's `src/lib/api-helpers.ts` `runPython` and `runPythonInline`
spawn a fresh Python subprocess per request via `spawnSync(PYTHON_PATH,
...)`. Python imports + connection objects are re-created in each child
process, so the new `timeout=10` connect-arg takes effect on the very
next API call — no `trevor-dashboard.service` restart needed. Verified:
authenticated round-trip on `/api/status`, `/api/killswitch`,
`/api/auto/state`, `/api/dashboard/edge`, `/api/memory/health`,
`/api/intel/calibration` all returned HTTP 200 immediately after the
edits, with no Hub restart between.

### What this does NOT do

- Does NOT change any TypeScript / React code in `src/`.
- Does NOT modify any API route handler — only the Python helpers each
  route's `runPython` call invokes.
- Does NOT alter caching, polling cadence, or SSE behavior.
- Does NOT change any sacred Python file in the trevor repo (the
  sacred sweep happens in the trevor commit, separate from this Hub
  commit, with `--no-verify` per `feedback_sacred_bypass`).
- Does NOT modify `package.json` or any npm dependency.
- Does NOT modify `trevor-dashboard.service` systemd unit.

### Files

47 files, all top-level `.py` in `/home/trevor/trevor-dashboard/`. See
`git diff --stat` on the companion commit for the full enumeration.

### Rollback

```bash
cd /home/trevor/trevor-dashboard && git revert <this-commit>
# No service restart needed — next API call spawns a fresh subprocess
# that imports the reverted helpers. Pre-revert behavior (timeout=0
# for most sites, mixed 2.0/3.0/4.0/5.0 elsewhere) restored on the
# very next request.
```

## SCOUT Dashboard Integration — D2 Part 1 (2026-05-10)

A new "Scout" section under `/manual/scout` reads from the SCOUT FastAPI
service (separate Python process at `127.0.0.1:3334`, nginx-proxied at
`/api/scout/`). The Scout system is a separate stock-discovery pipeline
that lives at `/home/trevor/scout/` — see that repo's CLAUDE.md for the
backend (Engines A & B, scheduler, Discord webhooks, etc.).

### What was added (all additive)

```
src/app/manual/scout/page.tsx            # server wrapper
src/app/manual/scout/loading.tsx         # skeleton fallback
src/components/scout/scout-tabs.tsx      # top-level Signals|Watchlist|Config tab strip
src/components/scout/position-signals-panel.tsx  # Engine A table + 30d history bars
src/components/scout/swing-signals-panel.tsx     # Engine B table w/ sub-signal badges
src/components/scout/watchlist-table.tsx # active watchlist + add/remove
src/components/scout/config-panel.tsx    # SCOUT thresholds + size multipliers (PUT .env)
src/components/scout/history-bars.tsx    # tiny CSS bar chart (no recharts dep)
src/components/scout/api.ts              # typed fetch helpers for /api/scout/*
src/components/scout/types.ts            # response types
src/components/scout/format.ts           # mcap/score/pct formatters + tone helpers
src/components/scout/use-fetch.ts        # minimal fetch hook (manual refresh + visibility-aware polling)
```

### What was NOT modified

- No changes to `src/app/manual/page.tsx` (HUB_REDESIGN_SCALP feature flag preserved).
- No changes to `sidebar.tsx` / `app-shell-*.tsx` — `/manual/scout` has **no nav entry yet** (deferred to D3 once Ghost approves the UI). Reachable directly via URL.
- No changes to existing `/api/*` routes; SCOUT data goes through nginx → 3334, not through Next.js.

### Endpoint contract (from /home/trevor/scout/scout/api/server.py)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/scout/health` | DB row counts, last_scan |
| GET | `/api/scout/signals/position` | Engine A top-N (default 50) |
| GET | `/api/scout/signals/swing` | Engine B top-N |
| GET | `/api/scout/signals/history` | ranged scans for the 30d bars |
| GET | `/api/scout/watchlist` | active watchlist (joined w/ universe) |
| POST | `/api/scout/watchlist/add` | manual ticker add (status='active') |
| DELETE | `/api/scout/watchlist/{ticker}` | soft delete (status='dropped') |
| GET | `/api/scout/config` | runtime config view |
| PUT | `/api/scout/config` | write to SCOUT `.env` (allowlisted keys) |

### Architecture notes

- All Scout components are **`'use client'`** — no SSR. SCOUT API is not
  guaranteed to be reachable during `next build`, so any server-component
  fetch would risk build failures. Browser-side fetch on mount keeps
  build deterministic.
- All requests use the relative `/api/scout/...` URL. Browser → nginx
  on `trevor-prime.com` → SCOUT FastAPI on `127.0.0.1:3334`. The
  trevor-prime.com server block has the existing Ghost-only IP allowlist;
  Scout endpoints inherit it automatically — no separate gate needed.
- `useScoutFetch(fetcher, deps, {refreshMs})` hook polls only when the
  page is visible (`document.hidden` check), aborts in-flight requests
  on unmount, and uses an epoch counter to drop stale responses on
  rapid re-renders.
- DuckDB JSON shape (`scans.components`) is parsed client-side once per
  row, not per render — see `_parse_components` in the panels.

### Visual / design system

- Uses Design System v1 tokens (`bg-bg-card`, `text-fg-muted`,
  `text-accent-cyan`, `border-border-subtle`, `shadow-glow-*`,
  `rounded-pill`, `text-h2/h3/caption/micro`, `duration-fast`).
- Primary accent **cyan** to match the rest of the Hub; **green** is
  the "NEW signal / win" accent; **amber** for "config dirty / changed";
  **red** for errors / deletes.
- Reuses `Card`, `Pill`, `Skeleton`, `EmptyState`, `TabBar` from
  `@/components/ui`. No new design primitives.
- `recharts` not pulled in for the 30d history strip — small enough
  that CSS `height: %` bars beat the bundle cost.

### Verification (post `npm run build` + `systemctl restart trevor-dashboard`)

- Build succeeded. `/manual/scout` listed at **8.85 kB / 122 kB First Load JS**.
- Routes return expected behavior: `/manual/scout` → 307 → `/login?from=%2Fmanual%2Fscout` (auth gate); same shape as `/dashboard`, `/autotrader`, `/manual` → no regression.
- SCOUT backend still healthy (`scout.service` active, `127.0.0.1:3334/api/scout/health` returns 13 tables / 935,345 rows).
- Hub at 168 MB RSS (well under `MemoryMax=1500M`).
- External `https://trevor-prime.com/api/scout/health` from the VM returns 403 by design (IP allowlist excludes the VM's own egress); browser access from an allowlisted IP is the supported path.

### Outstanding for D3 / D2 Part 2

- Sidebar `NAV_ZONES` entry for SCOUT (so users don't need to type the URL).
- Filings tab + insider heatmap + sector-rotation widget + outcome-tracking display.
- "Promote to watchlist" button on signal rows (currently watchlist add is manual ticker entry only).
- `signal_outcomes` table is empty until SCOUT side ships outcome backfill — `/api/scout/outcomes` returns `{"outcomes": [], "summary": {}}` for now.
- `universe.sector` is NULL across the universe (D-A2-1 in scout repo) — sector columns show "—" until the SCOUT-side enrichment ships.

## SCOUT Dashboard Integration — D3 Part 2 (2026-05-10)

Adds four new tabs (Filings / Insiders / Sectors / Performance) to the
existing `/manual/scout` Scout section. Total tabs now **7**: Signals ·
Watchlist · Filings · Insiders · Sectors · Performance · Config. Tab
state is now URL-synced (`/manual/scout?tab=filings` is bookmarkable).

### What was added

```
src/components/scout/filings-stream.tsx        # 8-K + Form 4 + 13G/D unified feed
src/components/scout/insider-heatmap.tsx       # Top buyers / Top sellers split
src/components/scout/sector-rotation.tsx       # 11-sector ranking + macro regime
src/components/scout/performance-tracker.tsx   # outcomes summary + recharts panels
```

### What was modified (D2 files I authored)

```
src/components/scout/scout-tabs.tsx   # 3 tabs → 7, URL-synced state via useSearchParams
src/components/scout/api.ts           # added fetchFilings/Insiders/Sectors/Macro/Outcomes
src/components/scout/types.ts         # added 5 new endpoint response types
```

### Component design notes

- **FilingsStream**: unified feed of `/api/scout/filings` (3 source arrays merged + sorted desc). Type chip filter (All / 8-K / Form 4 / 13G/13D), ticker contains-search, days slider (3/7/14/30). 8-K item codes parsed from JSON-encoded string column (`item_codes: "[\"5.02\"]"`) and color-coded per spec: green (1.01 / 2.02 / 7.01 / 5.07 / 2.01 — material catalysts), red (1.02 / 2.06 / 4.01 / 4.02 / 1.03 / 3.01 — negative), amber (5.02 / 8.01 / 5.03 — neutral). EDGAR links use the company-by-ticker filings page filtered to type (the only stable URL pattern that works without per-filing CIK lookup).
- **InsiderHeatmap**: data is aggregated by `(ticker, role, transaction_code)` over the requested window — no week-level granularity, so I render two parallel ranked tables (Top Buyers / Top Sellers) with bar-encoded values and footer totals. Days chips: 7/14/30/60/90.
- **SectorRotation**: two-card layout — left card has the macro regime badge (RISK-ON green / RISK-OFF red / NEUTRAL amber / UNKNOWN neutral) + sub-indicators (yield-curve / financial-stress / VIX placeholder) + 90-day history strip; right card lists 11 sectors with rank + bar (length = `(total + 1 - rank) / total` since the API exposes rank only, not return magnitude — documented in the footer note). Top-4 green, middle-3 amber, bottom-4 red per spec.
- **PerformanceTracker**: empty-state-aware. Today the API returns `{outcomes: [], summary: {}}`, so it renders a friendly empty state describing what will appear (per-engine summary cards · 20d distribution bars · rolling 30d win-rate line · factor contribution table). When outcomes populate, the same component lights up the four sections automatically. Uses **recharts** (already in package.json — no new dep) for the distribution bar chart and win-rate line chart with a 50% reference line.

### Tab routing

`scout-tabs.tsx` switched to `useSearchParams` + `router.replace` so the active tab is `?tab=`-bound. Wrapped in `<Suspense>` per Next.js' useSearchParams requirement. Direct-link to any tab works: `/manual/scout?tab=performance`. Unknown tab values fall back to "signals".

### Build numbers

`/manual/scout` grew from 8.85 kB / 122 kB First Load (D2) to **23.3 kB / 236 kB First Load** (D3). The +114 kB First Load delta is mostly recharts (server lazy-imports it, but client gets the library on this route). No other route was affected.

### Verification (post `npm run build` + `sudo systemctl restart trevor-dashboard.service`)

- Build succeeded — `/manual/scout` listed at 23.3 kB. One TS narrow-to-`never` error caught and fixed pre-deploy (Engine type was being narrowed past its union after two equality checks).
- Service came up clean: `[HUB] TREVOR Hub ready on http://127.0.0.1:3333`. Hub at 152 MB RSS.
- Routes verified (all return `307 → /login?from=...` as expected — auth gate, route resolution working): `/manual/scout`, `/manual/scout?tab=filings`, `/manual/scout?tab=insiders`, `/manual/scout?tab=sectors`, `/manual/scout?tab=performance`. Existing `/dashboard`, `/autotrader`, `/manual` unchanged.
- SCOUT backend (`scout.service`) untouched, still serving `/api/scout/health` → 13 tables / 935,345 rows.

### Outstanding for Wave D follow-ons

- Sidebar `NAV_ZONES` entry for SCOUT (so it appears in the chrome's primary nav).
- Outcome tracker backend (Wave E) — populates `signal_outcomes` from historical scans + forward returns. PerformanceTracker activates automatically once data lands.
- Promote-to-watchlist buttons on signal rows.
- Sector-rotation API extension to expose blended return + 4-week / 13-week relative returns (currently rank-only — bars are visual ordering, not magnitude).
- Macro regime history is sparse (1 snapshot); fix in scout side by running the scheduler's macro job daily so the regime-history strip is meaningful.
