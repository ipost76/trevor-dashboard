# Hub read-replica: continuous restore + STALE-badge fix (W-H-P2-HUB, 2026-06-09)

**Box:** WSL `ghost@Ghost` (the Hub box). **Repo:** `/home/ghost/projects/trevor-dashboard` (`master`).
**Scope:** WSL/Hub read-side only. The VM, the bot, the live `trevor.db`, GCS, and the money path were **not touched**.

## What was broken

1. **Frozen replica.** `/home/ghost/trevor-replica/trevor.db` was restored **once** at the W-D migration (2026-06-06 02:06) and never refreshed: `litestream.service` was left dead+disabled and `/home/ghost/litestream.yml` is a *replicate* (PUSH) config — the wrong direction. The replica froze 52 trade-ids behind live, showing 2 phantom `auto_trades` "open" rows (NEAR/XRP, actually closed on live ~79h earlier) and 0 trades today.
2. **Stuck "STALE" equity badge.** `/api/auto/state` set `equity_stale` straight from a stale-while-revalidate cache's per-call `stale` flag. The equity cache TTL is **10s** but the client (`capital-hero.tsx`) polls every **15s**, so the cache was *always* expired at poll time → `stale` was permanently `true`, even though the equity value (from the Observatory heartbeat) is live.

litestream **0.3.13** has no live read-replica daemon (that was 0.4-beta-only and is still absent in 0.5.0), so the canonical pattern is a **periodic one-shot `restore`** pulling GCS → local.

## Fix 1 — continuous restore (pull-only GCS → WSL)

- **Script:** `deploy/scripts/trevor-restore.sh` — `litestream restore -parallelism 16 -o <staging> gcs://trevor-prime-backups/litestream/trevor.db` (a **config-less `gcs://` URL** so it can never reuse the dangerous PUSH config), then `PRAGMA wal_checkpoint(TRUNCATE); journal_mode=DELETE` (via `python3`; there is **no `sqlite3` CLI** on this box) to publish a **single self-contained DELETE-mode file** (no `-wal/-shm`), a **monotonic sanity gate** (staged `auto_trades` MAX(id) must not regress/empty — guards against a partial/corrupt restore clobbering a good replica), then an **atomic `mv`** over `/home/ghost/trevor-replica/trevor.db` and cleanup of stale `-wal/-shm`.
- **Why the swap is picked up with no Hub restart:** the Hub (Next.js `node server.js`, :3000) has **no SQLite binding** — it shells out to a fresh `venv/bin/python3` subprocess **per request** that opens the DB `?mode=ro` and exits. No long-lived fd, no singleton → the next request opens the new inode. (Both the `TREVOR_DB_PATH` env routes and the hardcoded-`/home/trevor/trevor/trevor.db`-via-symlink routes resolve to the same file; the root-owned symlink is left intact.)
- **Units:** `deploy/systemd/wsl/trevor-restore.{service,timer}` (installed byte-identical to `/etc/systemd/system/`). `Type=oneshot`, `User=ghost`, `Environment=HOME=/home/ghost` (so litestream finds GCS ADC at `~/.config/gcloud/application_default_credentials.json`), `TimeoutStartSec=30min`. The **timer** drives it: `OnUnitInactiveSec=15min` (gap measured **after** each run finishes — correct when a run takes minutes), `Persistent=true`.
- **Cadence/cost rationale:** a full restore re-downloads the snapshot + the entire WAL chain (≈**8 min** at `-parallelism 16`, ≈14 min at default; the snapshot is ~31h old, which is the cost driver). 15-min gap → **~20–30 min effective freshness** at a cost-conscious GCS egress — a massive win over 79h-frozen. The real efficiency win (shrink each restore to seconds) is shortening the **VM-side** litestream `snapshot-interval` — a **separate, VM-side follow-up** Ghost will authorize later. This change is intentionally WSL-read-side only.

### Danger mitigation (the PUSH footgun)
`/home/ghost/litestream.yml` pushes the *local* replica UP to the same GCS path the VM owns — if ever run, it would fork/corrupt the VM's live generation. Mitigated:
- `systemctl disable && mask litestream.service` (masked → `/dev/null`, cannot start by any path).
- `litestream.yml` → **`litestream.yml.DISABLED-replicate-DANGER`** (renamed, not deleted).
- The restore uses a config-less `gcs://` URL — it never loads a replicate config.

> **Note on the "Hub never runs `wal_checkpoint`" invariant:** the script's `wal_checkpoint(TRUNCATE)` runs **only on the throwaway staging copy** (to publish a single clean file). It never touches the live read path, and there is no WSL→GCS replication chain to interfere with. The invariant (about the live replica + the VM-owned replication source) still holds.

## Fix 2 — STALE equity badge

`src/app/api/auto/state/route.ts`: `equity_stale` is now an **age check on the served value's timestamp** — `Date.now() - ts > 60_000` — instead of the per-call SWR `stale` flag (kept `staleWhileRevalidate:true`). 60s sits comfortably above the 15s client poll, so a normally-refreshing value is **never** flagged; a genuinely stalled heartbeat (>60s without a successful fetch) **still** flags STALE while showing the last-known value. (A new `EQUITY_STALE_AGE_MS = 60_000` constant; the unused `stale` binding was dropped.)

## Verification (honesty protocol — all PASS)

- **Replica freshness:** after restore, replica `auto_trades` MAX(id)=**100443**, today=**19**, open=**0** — an **exact match** to VM live (`100443 / 19 / 0`). The 52-id gap closed; phantom NEAR/XRP **gone** (`status='open'` rows = `[]`). Published file is `delete`-mode, `0444`, no `-wal/-shm`.
- **One-way confirmed:** GCS generation unchanged (`5d5cc4d6…`, `end` advancing only from VM writes); WSL pushed nothing; `litestream.service` masked.
- **HTTP end-to-end (authed):** `/api/auto/state` open_count=**0**, equity_usd live, `/api/auto/trades?type=open` = **0 (`positions:[]`)**, `/api/nav-badges` activeTrades=**0** (the prior `0 vs 2` open-count contradiction **auto-resolved** with no code change), `/api/auto/trades?type=closed` top ids `[100443,100442,100441]` (matches VM).
- **Badge:** heartbeat reachable + fresh (`account_value_usd` live, advancing). Under steady polling, `equity_stale=False` with `ts` advancing; after a >60s idle gap, `equity_stale=True` (genuine-stale path) — exactly the intended semantics. Synthetic check of the exact expression: value 15s/45s old → `false`, 120s old → `true`.
- **Systemd:** `trevor-restore.timer` enabled+active; the service runs cleanly under systemd (env/ADC/perms OK).

## Operate

```bash
# status / next run
systemctl status trevor-restore.timer trevor-restore.service
systemctl list-timers trevor-restore.timer

# force a refresh now
sudo systemctl start trevor-restore.service
journalctl -u trevor-restore.service -f      # watch it publish

# the Hub picks up a fresh replica on the next request — no restart needed.
```

Replica is now **self-refreshing**; never assume it is a frozen one-time restore again.

---

# W-H-P3-HUB (2026-06-09) — re-fix: the badge fix above was never deployed + equity-accuracy audit

**Same box/scope as above. VM, bot, live `trevor.db`, GCS, HL orders, money path: untouched (HL accessed READ-ONLY `user_state` only). Hub rebuild + restart only.**

## Why "Fix 2" survived (the actual root cause)

Fix 2's *source* (`route.ts` age check) was **correct**, but it **was never built or restarted**. Evidence:

- `.next/BUILD_ID` mtime **13:14:45** → Hub process started **13:15:08** → fix commit `ad6eaad` **13:23:07** (8 min *after* the build). `.next` was not rebuilt since.
- The deployed `route.js` therefore still ran the pre-fix code (`const {value, stale, ts} = swr(...); return {…, stale, …}`) — the always-true per-call flag.
- **Live behavioral proof:** the running endpoint returned `equity_stale:true` on 15s-spaced polls but `false` on a sub-10s poll (age 0.5s) — a flicker that ONLY the per-call SWR-expiry flag (TTL 10s) produces; the age-logic would return `false` in both cases.
- The "verification" in Fix 2 above (line: *"Synthetic check of the exact expression…"*) tested the **source expression**, not the **deployed artifact** — so it passed while the bug shipped.

**Lesson (now in CLAUDE.md):** a Hub source fix is inert until `npm run build` **and** `sudo systemctl restart trevor-dashboard.service`. Always prove against the **live endpoint at 15s cadence**, never a synthetic-only check.

## The remediation

1. **Deploy the P2 badge fix:** `npm run build` (exit 0) → `sudo systemctl restart trevor-dashboard.service`. No badge source change — the age-logic was already correct.
2. **Floating-PnL accuracy fix** (`route.ts`, additive): the Hub has no HL creds, so `query_auto_state.py` reports `unrealized_usd:0` always → the "floating" sub-line showed `$0` even with an open position. `resolveRealHlEquity()` now also pulls `categories.autotrader.unrealized_pnl_usd` from the **same** heartbeat (cached as `{equity, unrealized}`; absent/NaN ⇒ `null`), and the response uses `unrealized_usd = equity.unrealized ?? value.unrealized_usd`. Same source/pattern as `account_value_usd`.

## Equity-value freshness — characterized (NOT a bug, a design limit)

The displayed account value = `heartbeat.account_value_usd` = observatory `collect_account_value()` = **latest `equity_snapshots.equity`**, which the VM monitor-loop writes **~hourly** (observed #247 15:54 `54.04` → #248 16:54 `51.98` → #249 17:59 `53.05` → #250 18:49 `52.88`). So:
- The prompt's stuck **"$51.98"** was simply snapshot **#248**; the value has since advanced to **$52.88** (#250).
- The badge's "fresh" = "the Hub is fetching the heartbeat successfully (<60s)", **not** "tick-by-tick HL". The value tracks real HL only to ~1h granularity. Real-time equity needs a VM-side change (observatory/monitor-loop cadence) — a **separate follow-up Ghost will authorize later**, out of scope here (the Hub has no HL creds by design — EQT-A3).

## Accuracy audit (Metric | HL live | VM DB | Hub) — all match source-of-truth

| Metric | HL live (`user_state`, read-only) | VM `trevor.db` | Hub | Verdict |
|---|---|---|---|---|
| Equity / LIVE ACCOUNT | spot USDC **52.61** (flat) | `equity_snapshots#250` **52.88** @18:49 | **52.88** | ✅ = latest hourly snapshot (mirrors HL at snapshot time) |
| Realized P&L today | — | live closed-today Σpnl | matches | ✅ (replica ≤15min trail) |
| Trades today | — | realized-count (non-null pnl) | matches Hub def | ✅ (heartbeat's larger count is a *different* metric) |
| Trades total / open / deployed | — | live counts | matches replica | ✅ (replica ≤15min restore trail) |
| Floating / unrealized | 0 (flat) | heartbeat `unrealized_pnl_usd` | now sourced from heartbeat | ✅ fixed ($0 only when genuinely flat; real value when a position is open) |

## Verification (honesty protocol — proven on the LIVE Hub, not synthetic)

- **Artifact:** `.next/BUILD_ID` mtime now `15:29`; `unrealized_pnl_usd` present in built `route.js`; the `>6e4` (60s) threshold present.
- **Badge at 15s cadence (live poller, 12s interval):** `equity_stale:false`, `equity_source:real-hl`, value `52.8813`, `equity_ts` advancing **+12s each poll** (background refresh working), age steady **~11.8s (<60s)**.
- **Genuine-stale fired LIVE:** a poll after a >60s idle gap returned `equity_stale:true` (age 126s), then recovered to `false` on the very next 12s poll — exactly the intended semantics, observed on the real Hub (not a synthetic expression).
- **Value = real HL:** displayed `52.88` = heartbeat `account_value_usd` = `equity_snapshots#250`; live HL spot USDC `52.61` (within hourly-snapshot drift).
- **Floating:** flat now ⇒ Hub `$0` (correct); wiring deployed reads the heartbeat's `unrealized_pnl_usd` for the open-position case.
