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
