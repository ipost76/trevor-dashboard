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
6. **`.env.local` does not exist** — credentials are in `.env` which Next.js loads automatically.
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
  -d '{"action":"login","username":"trevor","password":"123456"}'

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
