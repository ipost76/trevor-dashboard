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
6. **Credentials live in `.env.local`** — `DASHBOARD_USER=trevor`, `DASHBOARD_PASS=trevor2026`. The `/api/auth` route reads this file directly at `process.cwd()`. `.env` contains only `DISCORD_BOT_TOKEN` (separate concern).
7. **Auth requires `username` AND `password`** fields in login POST body.

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
  -d '{"action":"login","username":"trevor","password":"trevor2026"}'

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


