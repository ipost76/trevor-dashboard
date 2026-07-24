# Display-Tier Data Laws — Materiality Record

> **Status: CLOSED QUESTION with two named reopening conditions.**
> Authored by **RF3T2-B5** (2026-07-24), the build prompt that closed gap **T2-g**.
> Evidence: `recon_archive` row **`RECON-DATALAW-001`** (report:
> `docs/reports/recon/2026-07-24_RF3T2-TRIAGE/A1_Display_Tier_Materiality_Triage.md`).
> Written to be read by someone with **no campaign context**.

---

## 0. Why this document exists

An audit found roughly **90 sites** in the TREVOR codebase that compute realized P&L with a
bare `SUM(pnl_usd)`, omitting `partial_pnl_realized`. That form is **wrong**. It was decided
that **only one of them would be fixed**.

A decision to not-fix 87 things evaporates the moment the next audit runs. Without this
document, the next auditor re-discovers the same ~90 sites, re-opens the same gap, and the
triage gets paid for twice. **This file is the reason they stay closed.**

It is not a summary of work done. It is the **reasoning** that makes the question closed.

---

## 1. The measured population

`RECON-DATALAW-001` did not estimate. It grepped both boxes and de-duplicated the hits.

| Law | VM (`/home/trevor/trevor`) | WSL Hub (`/home/ghost/projects/trevor-dashboard`) |
|---|---|---|
| **L2** canonical P&L — bare `SUM(pnl_usd)` | 91 raw → **88 executable** (3 were comment/docstring text) | **0** |
| **L4** clock truth — decision-path subset | **4 executable sites** | 1 site, and it is **correct** |
| **L7** frozen `active_trades` reads | 67 reads | 24 reads / 10 files |
| **L3** notional trap | 0 read-side | 3 sites (naming only, value correct) |

**How the count was taken:** grep for the literal aggregate form across all `*.py` / `*.ts` /
`*.tsx`, then discard matches inside comments and docstrings (91 → 88), then resolve each
surviving `file:line` live rather than trusting a prior report's hinted line numbers.

**The WSL zero was re-verified independently by RF3T2-B5 on 2026-07-24.** A repo-wide grep for
`SUM(pnl_usd)` in the Hub returns 6 hits — **all six are prose inside `.md` files**
(`docs/*.md`, `CLAUDE.md`, `docs/SESSION_HISTORY.md`). **Zero in `.py`, `.ts`, or `.tsx`.**
The Hub read path already carries the canonical `pnl_usd + COALESCE(partial_pnl_realized, 0)`
form; the fix recorded as `fw11-headline-pnl-noop` held.

---

## 2. Where the 88 actually live — the 71 that never run

Of the 88 executable L2 sites, **71 (81%) sit inside two services that are `masked` and
`inactive`**:

| Service tree | L2 sites | systemd state (measured 2026-07-24) |
|---|---|---|
| **`monitor_center/`** | **69** | `trevor-monitor-center.service` → **`masked` + `inactive`** |
| **`observatory/`** | **2** | `trevor-observatory.service` → **`masked` + `inactive`** |

A `masked` unit cannot be started — the unit file is symlinked to `/dev/null`. Neither service
appears in any active timer, and **no active timer's `ExecStart` runs any file in either tree**
(re-verified: the three live units whose names contain "monitor" — `trevor-wedge-monitor`,
`trevor-backup-monitor`, `trevor-hub-monitor` — all `ExecStart` scripts under `scripts/`, none
inside `monitor_center/` or `observatory/`).

The `monitor_center` breakdown (69): `12_financial_analytics` 18 · `02_trade_execution` 10 ·
`26_strategy_attribution` 6 · `pattern_miner` 5 · `03_exit_engine` 5 · `25_capital_scaling` 4 ·
`causal_analyzer` 3 · `14_anomaly_detection` 3 · `24_backtest_divergence` 3 ·
`predictive_monitor` 2 · `attribution_engine` 2 · `13_deployment_tracking` 2 · 7 singletons.

**These 71 sites execute zero times per day.**

The remaining 17 break down as: **14** in one-shot `scripts/` and `tools/` files that sit on no
active timer (a human runs them knowingly, in an investigative context); **2** orphan files with
zero callers (§5); and **1** that a live process actually runs — and that one is a decision
path, not a display, so it was routed to its own money-path-aware prompt rather than swept here.

---

## 3. The magnitude — these numbers ARE wrong

**Say this plainly: the arithmetic is genuinely, measurably incorrect.** The hypothesis that
these sites might be numerically identical (because trades never scaled out) was tested against
the live book and **REFUTED**.

| Quantity | Measured value |
|---|---|
| Closed trades | **1,748** |
| Closed trades carrying a non-zero `partial_pnl_realized` | **426 (24.4%)** |
| Book `SUM(pnl_usd)` alone — what the wrong form computes | **−$195.5041** |
| Book `SUM(pnl_usd + COALESCE(partial_pnl_realized,0))` — canonical | **−$135.4045** |
| **Absolute error** | **$60.0996** |
| **Relative error** | the loss is **overstated by 44.4%** |
| Trades reading as LOSS that are canonically ≥ 0 (**sign flip**) | **21** |
| Trades reading as WIN that are canonically < 0 (**sign flip**) | **2** |
| **Total sign flips** | **23** |

A bare `SUM(pnl_usd)` is off by **$60.10** on this book, in **24.4%** of rows, and **flips the
win/loss sign on 23 trades**. **No site can be dismissed as magnitude-zero on the arithmetic.**

---

## 4. The reachability argument — why "wrong" is not the same as "worth fixing"

This is the load-bearing distinction. Read it before reopening anything.

> **The correct reason to skip these 87 sites is "this code does not run."**
> It is **NOT** "this error is small." The error is not small — it is $60.10 and 23 sign flips.

A defect has two independent properties: **is it wrong?** and **does anything compute it?**
Conflating them produces two opposite failure modes, and this codebase is exposed to both:

- Treating *wrong* as sufficient to fix → 71 edits inside a dead service. Seventy-one chances to
  break something, zero chances to fix anything a human or a machine will ever read. Every edit
  to unrunnable code is pure downside risk.
- Treating *unreachable* as *harmless* → the belief that the code is fine. **It is not fine.**
  It is wrong and dormant. The moment it stops being dormant it is wrong and live.

The 71 sites are low-value **only** because they are masked and inactive. That is a **conditional
verdict about the deployment**, not a verdict about the code. The code is defective. The
deployment is what makes the defect unreachable.

**This is why the conditions in §5 are preconditions, not footnotes.**

---

## 5. 🚨 REOPENING CONDITIONS — preconditions, not trivia

Two conditions reopen this question. Each one is a **gate on an action**, and the action must
not be taken until the gate is cleared.

### 🚨 CONDITION 1 — Unmasking `monitor_center` makes 69 sites wrong AT ONCE

`trevor-monitor-center.service` is currently `masked` + `inactive`. It contains **69 executable
bare-`SUM(pnl_usd)` sites**.

> **PRECONDITION ON ANY FUTURE UNMASK:**
> Do **not** unmask, enable, or start `trevor-monitor-center.service` until the 69 L2 sites in
> `monitor_center/` have been converted to `SUM(pnl_usd + COALESCE(partial_pnl_realized, 0))`.
> Unmasking first makes **all 69 wrong simultaneously**, each off by $60.10 with 23 sign flips,
> across financial analytics, trade execution, strategy attribution, exit-engine, and capital-
> scaling monitors — i.e. exactly the surfaces a human would consult to decide whether the book
> is profitable.

The same precondition applies to `trevor-observatory.service` (2 L2 sites), and to the L4/L7
sites those trees carry (`18_sentinel_live_scoring.py:455` +4h age error;
`12_financial_analytics.py:746,782,809` frozen-table reads;
`observatory/heartbeat/collector.py:294` clock skew).

⚠️ **A note on scope if this condition ever fires:** `RECON-DATALAW-001` verified the
*decision-path* clock subset exhaustively but did **not** produce a line-by-line enumeration of
the parent recon's ~118 L4 "window filter" class. It spot-confirmed that the residual class is
rolling `datetime('now','-N days')` filters inside these same masked trees, where a 4-hour
offset is immaterial by construction. **If `monitor_center` is unmasked, that enumeration
becomes necessary work.**

### 🚨 CONDITION 2 — Restoring the Observatory heartbeat re-routes a live field to an unverified source

The Hub's `open_margin_usd` field (§7) is served by `src/app/api/auto/state/route.ts` as:

```ts
open_margin_usd: equity.openMargin ?? value.open_margin_usd,
```

The **primary** source is the Observatory heartbeat
(`https://trevor-prime-2.tail2bf7a3.ts.net:8443/api/heartbeat`,
`Σ categories.autotrader.open_positions[].notional_usd`). The litestream-replica value computed
by `query_auto_state.py` is only the **fallback**.

**That heartbeat is DEAD.** Measured 2026-07-24: `curl` → **HTTP 000, exit 7 (connection
refused)**; VM `ss -lntp` shows **no listener on :8443** (only :3940, the vm-gateway);
`trevor-observatory.service` is `masked` + `inactive`. So `resolveRealHlEquity()` always throws,
the `??` always falls through, and the live path is the replica.

> **PRECONDITION ON ANY FUTURE OBSERVATORY RESTORE:**
> If the Observatory heartbeat is ever restored, this field is fed by heartbeat
> `open_positions[].notional_usd` instead — **the SAME column name, produced by a service that
> was masked and could not be verified**. The RF3T2-B5 rename does **NOT** resolve that path.
> **Re-verify this field's source before restoring the heartbeat.**

**This is a RECORDED RISK, not a fix.** Nothing in this campaign verified what the Observatory's
`notional_usd` per-position value actually means. A cross-reference is left in the route source
at the heartbeat compute site.

---

## 6. Corrections to prior recons

### 6a. What `RECON-DATALAW-001` refuted in its parent (`RV-C1` / `RECON-GIGANTIC-001`)

| Parent claim | Status | Evidence |
|---|---|---|
| `observatory/heartbeat/collector.py:294,322` *"feeds the live Hub/Discord 'today' numbers"* — rated 🔴 | ⚠️ **REFUTED** | `trevor-observatory.service` is masked; it feeds nothing. |
| `refit_calibrator.py` calibrates on frozen `active_trades` — rated 🟠 | ⚠️ **REFUTED — ORPHAN** | Exactly one file at repo root. No import, no service, no timer, no caller anywhere in the repo or `/etc/systemd/system`. It calibrates nothing because nothing invokes it. |
| `chat_ai.py:102-154` reads frozen `active_trades` — rated 🟠 | ⚠️ **REFUTED — ORPHAN** | No Hub API route, no subprocess spawn. Last modified 2026-06-05. |
| *"every DECISION path obeys the data laws"* | ⚠️ **REFUTED** | The parent audited `circuit_breaker.py`, which is L4-correct — but that is **not the armed breaker**. The breaker that gates entries is `auto_trader/risk_breakers.py`, which the parent never audited. |

**All four of the parent's named L7 violations are inert.** That negative is the useful result:
it moved four 🟠-rated findings out of scope entirely.

### 6b. Corrections to `RECON-DATALAW-001` itself, found by RF3T2-B5

The recon is the spec for this build, and it was right about the conclusion. Three of its
supporting details were not.

1. **Site count is 3 files, not 2.** `RECON-DATALAW-001` §11 handed off "2 files, ~4 edits",
   listing `route.ts` sites `:12, :61, :99, :155`. It **missed `:255`, `:357`, and — critically —
   `:363`, the GET-handler coalesce that actually emits the wire key.** The missed site was the
   one that matters most: a rename that skipped it would have left the producer and the client
   renamed while the route still emitted the old key, i.e. a silently blank card. The real
   footprint is **3 files** (`query_auto_state.py`, `route.ts`, `capital-hero.tsx`), plus a
   camelCase `openExposure` cluster the recon did not enumerate at all.

2. **The primary source is the Observatory heartbeat, not the replica.** The recon traced the
   field as `query_auto_state.py:609 → route.ts → capital-hero.tsx`. That is the **fallback**
   chain. The primary is the heartbeat (§5, Condition 2). **A1's conclusion holds — the replica
   value is what renders today — but its mechanism did not.** A right answer for a wrong reason
   is a correction, not a refutation: the conclusion survives *because* the heartbeat is dead,
   which A1 did not establish.

3. **The `chat_ai.py` orphan finding is STRENGTHENED.** Independently confirmed:
   `src/app/api/chat/route.ts` **does not exist**. ⚠️ A stale recon report
   (`docs/reports/recon/2026-06-28_hub-readonly/A1_hub_write_paths.md:100`) still documents a
   `chat/route.ts:39 → chat_ai.py` `runPython` spawn for a route that has since been deleted.
   **That historical report was deliberately NOT edited** — it is an accurate record of what was
   true when written. But it is the **fourth instance in this campaign of a document asserting a
   wire that does not exist** (alongside the `run_guards.sh:4` and "Never overwrites" docstring
   cases). Treat a documented wire as a hypothesis to verify, never as evidence.

---

## 7. The one site that WAS fixed

**`open_exposure_usd` → `open_margin_usd`** — the only live display-tier defect in the population.

**What was wrong: the NAME, not the VALUE.**

The field is computed at `query_auto_state.py` as:

```sql
SELECT COUNT(*) AS n, COALESCE(SUM(notional_usd), 0) AS notional
FROM auto_trades WHERE status='open'
```

🚨 **`auto_trades.notional_usd` IS THE POSTED MARGIN**, not the position notional. The repo
states this itself in the landmine block in `query_leverage_regime.py`, which also supplies the
correct vocabulary:

- `margin_used  = Σ notional_usd` → **sum DIRECTLY**
- `position_ntl = Σ (notional_usd × leverage)` → this is *display exposure*

So the field summed **margin** and called it **exposure**. Measured on the replica across the
754 closed rows carrying both columns:

| Quantity | Value |
|---|---|
| Σ `notional_usd` (posted margin) | **$4,392.61** |
| Σ `original_notional_usd` (true notional) | **$58,589.58** |
| Ratio on sums | **13.3×** |
| Mean per-row ratio | **15.87×** |
| Mean leverage | **11.54** |

A reader taking "exposure" at face value would be low by roughly an order of magnitude.

**There is no `÷ leverage` trap at this site.** The sum is arithmetically correct **as a margin
sum** — the code never divides. Only the key name lied.

> **That distinction is the whole finding: this was a RENAME, never an arithmetic fix.**
> The value was always right for what it measured; the name described something else.

**Why the fix was a field rename and not a label change.** There is **no human-visible "exposure"
string anywhere in the Hub**. The rendered line in `capital-hero.tsx` is:

```
{openCount} open · ${openMargin.toFixed(2)} deployed
```

The visible word is **"deployed"**, which is honest for posted margin, and it is **byte-identical
before and after this change**. The misnomer lived entirely in the JSON/API key and internal
identifiers. A label-only fix would have been a no-op; the field rename was the only substantive
option. It was applied atomically across the closed consumer set (producer → route → client) —
zero VM readers, zero test references — with no deprecated alias, because two names for one field
with nothing forcing convergence is how the original misnomer survived.

**Why this was the ONLY live one.** Of the 88, this is the sole site that (a) executes, (b) is
rendered on a page a user loads (`/autotrader` → `AutoZoneView` → `DashboardTab` → `CapitalHero`),
and (c) is a display rather than a decision path. The three decision-path sites the recon
surfaced were deliberately routed to their own money-path-aware prompts — putting a behaviour
change inside a diff framed as cosmetic is the failure mode this triage exists to prevent.

---

## 8. Full evidence

**`recon_archive` ID: `RECON-DATALAW-001`**

Report: `docs/reports/recon/2026-07-24_RF3T2-TRIAGE/A1_Display_Tier_Materiality_Triage.md`
(VM-relative; also present on the WSL Hub at `/home/ghost/docs/reports/recon/…`).

It carries the per-site tables, the full LOW-VALUE list with per-population reasoning, and a
**CORRECT-AS-IS list of 10 sites that pattern-match as violations and are not** — read that list
before "fixing" anything found by grep. Its §10 states its own UNKNOWNs.

---

## 9. Verdict

> **This is a CLOSED question, not an open backlog item.**
>
> 87 of the 88 executable L2 sites are **deliberately not fixed**. The numbers they compute are
> genuinely wrong — $60.10, 44.4%, 23 sign flips — and **nothing computes them**. 71 sit in
> `masked` + `inactive` services that execute zero times per day; 14 are unscheduled one-shot
> tools; 2 are orphans with zero callers. The one live display-tier site was fixed (§7).
>
> **Reachability, not arithmetic, is why the rest are low-value — and reachability is a property
> of the deployment, which can change.** Two conditions reopen this question, and each is a
> precondition on an action, not a footnote:
>
> 1. 🚨 **Unmasking `monitor_center` makes 69 sites wrong at once.** Fix them first.
> 2. 🚨 **Restoring the Observatory heartbeat re-routes `open_margin_usd` to an unverified
>    source.** Re-verify that source first.
>
> Absent those two actions, do not re-open this sweep. If you are here because a grep found ~90
> bare `SUM(pnl_usd)` sites: that count is correct, those sites are wrong, and they were counted,
> measured, and closed on 2026-07-24 for the reasons above.
