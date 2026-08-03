# C3 — False-Success Sweep + Alert-Spine Fault Injection

**PROMPT_ID:** `C3-FALSE-SUCCESS-SWEEP` · **Roadmap:** RM-VERIFY v3 Wave C · **Box:** WSL `ghost@Ghost`
**HEAD at start:** `2f51fe6` · **Date:** 2026-08-03 · **money_path:** no

Gaps addressed: **V-16** (false success as a class) · **D-W-06** (recovery hysteresis) · **V-14** (four incomparable residue counts).

---

## 0. The acceptance bar

`query_trainer_pause.py:74` carries the rule this sweep measures everything against:

> 🚨 **The unknown default. Nothing below may set these to a not-paused reading unless it has actually READ a pause record saying so.**

The mechanism is three parts, and a surface needs all three to pass:
1. a **pessimistic initialisation** (`pause_state:"unknown"`, `paused:None`),
2. **only a successfully-read row** may move it off unknown,
3. a **fail-soft `except`** that may write `error` but may never write a reading.

`paused` is `True | False | **None**` — and **None is the unknown value, never False**.

---

## 1. D1 — The sweep

**41 surfaces swept.** Enumeration pattern (stated): files emitting
`"(status|state|health|healthy|ok|active|enabled|alert_state|verdict)"\s*:`, plus `🟢|🔴|🟡|✅|❌`,
plus `UNKNOWN|DEGRADED|RECOVERED` renderers, plus the alert spine, the shell watchdogs and the
gateway health endpoints. **Excluded and stated:** pure data readers carrying an incidental
`status` column (e.g. trade status) — they report a fact, not a health verdict.

**Result: ✅ 10 honest · 🚨 11 false-success capable · ⚠️ 20 untested.**

### 🚨 False-success capable — each with the EXACT condition

| # | Surface | Exact condition producing the false green | State |
|---|---|---|---|
| 1 | `query_killswitch_state.py:43` | `.get("EMERGENCY_KILLSWITCH","false")` → **an absent row is emitted as `enabled:false`** = "emergency stop disengaged" | ✅ **FIXED** |
| 2 | `query_killswitch_state.py:49` | `except Exception: print({"enabled": False})` → **any DB error** is emitted as disengaged | ✅ **FIXED** |
| 3 | `src/app/api/killswitch/route.ts` GET catch | helper crash / spawn timeout / unparseable stdout → route mints its own `{enabled:false}` | ✅ **FIXED** |
| 4 | `killswitch-control-card.tsx:120` | `const enabled = !!state?.enabled` → `null` (no data yet, or non-2xx) collapses to `false` → renders **"Off · New trades allowed"** | ✅ **FIXED** |
| 5 | `query_watcher_integrity.py:118,237` | DB connect failure **and** reader crash both return `dict(_EMPTY)`, which carries **`"status":"ok"` with empty `findings`** — an unreadable oversight store is indistinguishable from a clean bill of health | 🚨 **OPEN** |
| 6 | `dashboard_health_watchdog.sh:iterate()` | recovery clears `consecutive_fails` + `was_unhealthy` on **ONE** good probe while failure needs `FAIL_THRESHOLD=2` → 🟢 posted mid-outage, then flap-suppressed | 🚨 **OPEN — out of scope by ruling** |
| 7 | `hub_health_monitor.run_cycle` (VM) | same asymmetry: `counts[name]=0` + `eff_status="ok"` on the first good cycle vs `THRESH=3` to fail | 🚨 **OPEN — VM-owned, report-only** |
| 8 | `hub_health_monitor.check_cert` (VM) | returns `"warning"` on **ANY** exception; reaching the cert requires a completed TCP+TLS handshake, so it is a **second liveness probe wearing a cert-check label**. All 9 WARNINGs 07-30→08-02 were `TimeoutError`; reported validity never moved off 71d | 🚨 **OPEN — VM-owned** |
| 9 | `hub_health_monitor._surface_peers_down` (VM) | reads the **effective** (flap-suppressed) status, so a genuinely-down peer inside its flap window reads as not-down and **disarms the PARTIAL guard** | 🚨 **OPEN — VM-owned** |
| 10 | `gateway/server.js:307` | `writes_enabled: vmConfigured()` reports whether the forward target is **configured**, not whether a write can land | 🚨 **OPEN** |
| 11 | `src/components/ui/killswitch-pill.tsx:47` | `if (!state.enabled) return null` — on UNKNOWN the pill renders **nothing**; under-warning by omission, not a false claim | 🚨 **OPEN** |

**Reported, deliberately NOT fixed (Ghost's ruling):** `src/app/api/health/route.ts:83`
`status: highLag ? "degraded" : "healthy"` — a **whole-Hub word for an event-loop-only
measurement**. Not touched because the watchdog reads the HTTP code only, and relabelling
risks a live restart path for a wording gain.

### ✅ Honest — the ones that already meet the bar

`query_trainer_pause.py` (the bar) · `query_level_state.py` (*"NEVER a guessed or proxied
level"*) · `query_wedge_metrics.py` (explicit `ok`/`no_data`/`error`) · `query_system_health.py`
(**QUAL-01**: `{"active": null, "status": "unknown"}` — the in-repo precedent this fix conforms
to) · `query_memory_liveness.py` (`no_data_yet` ≠ `ok`) · `query_digest.py` (NULL → UNKNOWN,
never CLEAN) · `/api/heartbeat` (absent `overall_status` → neutral UNKNOWN, never a false green)
· `query_profit_risk._breaker_gauge` (`None`, never `0`) · `/api/auto/state` `equity_stale`
(age-based) · `capital-hero.tsx` (`?? true` defaults to STALE).

⚠️ **20 untested is a correct classification, not a gap I hid.** These are surfaces I could not
drive to a failure state within this prompt (mostly `/api/*` routes whose Python helper would
need a fault injected into the live replica). They are **not** assumed honest.

---

## 2. D2 — The hysteresis, PROVEN BY INJECTION

### The asymmetry, in code

```bash
# deploy/scripts/dashboard_health_watchdog.sh — iterate()
if check_health; then
    if [ "$wu" = "1" ]; then ... alert_qa "✅ Hub RECOVERED ..." ; fi
    write_int "$CF_FILE" 0        # ← counter CLEARED on ONE good probe
    write_int "$WU_FILE" 0
    return 0
fi
cf=$((cf + 1)); write_int "$CF_FILE" "$cf"
[ "$cf" -ge "$FAIL_THRESHOLD" ] || return 0   # ← but TWO to fail
```

**Recovery needs 1; failure needs 2 (VM twin: 3).** The re-failure then restarts from zero, so
it is flap-suppressed — leaving green as Discord's last word.

### The captured sequence

Driven with the script's own seams: `--once --dry-run`, `WATCHDOG_TEST_HEALTH=fail|healthy`,
`WATCHDOG_NOW` clock override, scratch `WATCHDOG_STATE_DIR`, empty `ENV_FILE`.

| Cycle | t | Probe | What would have been posted |
|---|---|---|---|
| 1 | +0s | fail | *(silent — 1/2)* |
| 2 | +15s | fail | ⚠️ `failed 2×+ — restarting` · ↻ `restart issued` |
| 3 | +30s | **healthy (one lucky probe)** | 🟢 **`✅ Hub RECOVERED — /api/health responding again`** |
| 4 | +45s | fail | **SILENT** — counter was cleared, 1/2 |
| 5 | +60s | fail | **SILENT** — within 300s restart cooldown |
| 6 | +75s | fail | **SILENT** — within cooldown |
| 7 | +300s | fail | **SILENT** — within cooldown (285s ago) |
| 8 | +320s | fail | ⚠️ restarting (cooldown finally expired) |

**Final scratch state after cycle 6: `consecutive_fails = 3`, `was_unhealthy = 1`** — the surface
is continuously DOWN, and the last thing the channel heard was **🟢 RECOVERED**.

🚨 **Silence window ≈ 255 seconds of unbroken outage with green as the last word** — and it is
*worse* than the pure-hysteresis case, because two mechanisms compound: the **cleared counter**
silences cycle 4, and the **300s restart cooldown** silences cycles 5–7.

**Positive control (cycle 9, healthy at +340s):** 🟢 `✅ Hub RECOVERED` fires and state clears to
`consecutive_fails=0 was_unhealthy=0`. **A real recovery still reads as recovered** — the
mechanism is not broken; the defect is purely the asymmetry.

### The VM twin

`hub_health_monitor.run_cycle` has the identical shape at `THRESH=3`. **Confirmed by code read
only** — it is VM-owned (`/home/trevor/trevor/scripts/`), out of scope, and was not run or
edited. Same defect, independently implemented, on both boxes.

⚠️ **NOT FIXED, by ruling.** Hysteresis is adjacent to the deliberately out-of-scope
edge-trigger; changing both in one prompt makes neither measurable.

**The fix, when it is scoped:** make recovery symmetric — require `RECOVER_THRESHOLD`
consecutive good probes (≥ the fail threshold) before clearing `was_unhealthy` and emitting the
recovery alert. One-line-ish in both monitors. Do **not** simply lengthen the cooldown; that
widens the silence rather than closing it.

---

## 3. D3 — ONE frozen residue pattern set

**`scripts/residue_census.sh` — pattern set v1.0, git-tracked, one command.**

```
bash scripts/residue_census.sh              # the declared over-count
bash scripts/residue_census.sh --code-only  # the declared lower bound
bash scripts/residue_census.sh --files      # + per-pattern file lists
```

**Count at `2f51fe6`:** **TS 96 occurrences / 84 files** (corpus 245) · **PY 363 occurrences /
92 files** (corpus 116) · **gateway/*.js 0** (corpus 2).
`--code-only` lower bound: **TS 89 · PY 361**.

**Corpus:** git-tracked `*.ts *.tsx *.py`.
**Exclusions, stated:** `*.d.ts` · `docs/` · `tests/` (a test's raw exception is diagnostic
output, not a user surface) · `node_modules/ .next/ venv/`.
**Counted separately and NEVER folded in:** `gateway/*.js` — the third language layer, invisible
to a TSX sweep, a PY sweep *and* a whole-`src/` sweep.
🚨 **Deliberately NOT excluded:** comment and docstring bodies. Stripping them needs a parser,
and a regex strip is exactly the defect RD-C4 measured in the VM guard suite. **An over-count you
declare is honest; an under-count you don't is not.**

### The four historical numbers are INCOMPARABLE

| Measurement | TS | Python |
|---|---|---|
| `B13` estimate | ~12 | ~10 |
| `A2` (RM-CLOSEOUT) | 62 occ / 57 files | 51 occ / 24 files |
| `B3` (RM-CLOSEOUT) | 80 occ / 72 files | 60 occ / 28 files |
| `A2` (RM-VERIFY) | 85 | 85 |
| **C3 v1.0 (this)** | **96 occ / 84 files** | **363 occ / 92 files** |

**Reason they cannot be compared:** none froze a corpus, an exclusion list, or a regex set, and
none stated whether it counted occurrences or files. **The repeated undercount is the finding,
not the numbers.** Compare only v1.0 to v1.0.

⚠️ **The census caught a defect in itself.** The first draft defined a `strip()` helper for
`--code-only` and never wired it in — the flag printed identical totals while claiming to have
filtered. **A flag that announces work while doing nothing is this prompt's own defect class.**
Recorded rather than quietly fixed.

---

## 4. Causes found: 7

1. **No unknown state in the type.** `enabled: boolean` has no third value to carry "I could not tell".
2. **A fallback returning a default.** `.get("EMERGENCY_KILLSWITCH", "false")` — absent key resolves to the healthy literal.
3. **A catch swallowing and returning healthy.** `except → {"enabled": False}`; `check_cert → "warning"`; `dict(_EMPTY)` carrying `status:"ok"`.
4. **A check measuring a proxy rather than the thing.** `cert_hub` is a liveness probe mislabelled a cert check; `writes_enabled = vmConfigured()` is config-presence, not capability; `/api/health`'s `"healthy"` measures only the event loop.
5. **A counter cleared on the first good cycle.** Both monitors, independently.
6. 🚨 **NEW — a cross-check guard fed suppressed data.** `_surface_peers_down` reads the **effective** status, so a genuinely-down peer inside its flap window reads as not-down and disarms the PARTIAL guard. **The suppression feeds the thing meant to catch the suppression.**
7. 🚨 **NEW — a renderer coercing absent→healthy.** `!!state?.enabled` would have flattened `enabled: null` straight back to `false`. **This is why the fix had to land end-to-end and not just in Python: a producer-side fix alone would have changed nothing on screen.**

---

## 5. What landed

| File | Change |
|---|---|
| `query_killswitch_state.py` | Three states: `killswitch_state: engaged\|disengaged\|unknown`, `enabled: true\|false\|**null**`. Pessimistic default; only a read row moves it off unknown; `except` writes `error`, never a reading. Fail-soft exit 0 (was exit 1, which drove the route into its own false-green catch). |
| `src/app/api/killswitch/route.ts` | GET catch returns `{killswitch_state:"unknown", enabled:null}` instead of `{enabled:false}`. **HTTP 500 deliberately unchanged** — the machine contract is unmoved; only the body stops claiming a state. |
| `src/components/memory/killswitch-control-card.tsx` | Three-way render. Non-2xx and network failure now set an explicit unknown state instead of leaving `state` null. Renders **UNKNOWN / "State unreadable"** + an explicit "this is NOT an all-clear" line. |

🚨 **`enabled` keeps its name and stays populated.** It is not renamed and not removed — only its
unknown value changes from `false` to `null`. B3-HUB measured that renaming `error`→`error_code`
would have stopped a `!data || data.error` branch firing and produced an empty-but-healthy false
green; the same trap was live here.

**Toggle-button posture under UNKNOWN (deliberate, unchanged):** `enabled === false` leaves
ENGAGE available and RELEASE disabled. Engaging the emergency stop is the safe direction and must
never be blocked by a read failure; releasing it on an unknown reading must not be offered.

### Evidence — all three states through the REAL `main()`

| Input | `killswitch_state` | `enabled` |
|---|---|---|
| row says `true` (**positive control**) | `engaged` | `True` |
| row says `false` (**positive control**) | `disengaged` | `False` |
| row ABSENT | `unknown` | `None` |
| DB unreadable | `unknown` | `None` |

### Evidence — the render, evaluated from the actual source lines

| Input | Heading | Pill |
|---|---|---|
| engaged | **ENGAGED** | New trades blocked |
| disengaged | **Off** | New trades allowed |
| row absent | **UNKNOWN** | State unreadable |
| route 500 | **UNKNOWN** | State unreadable |
| no data yet (`state == null`) | **UNKNOWN** | State unreadable |

The first two are the mandatory positive control: **the card can still say ENGAGED, and a real
disengaged reading still reads as "Off".** The last three all previously rendered
**"Off · New trades allowed"**.

---

## 6. Containment — ZERO live Discord posts

Four independent layers, all proven **before** anything ran:

1. `alert_qa():123` returns at `if [ "$DRY_RUN" = "1" ]` — **before** `discord_token()` and before `curl`.
2. `restart_service():150` returns before `systemctl` — no service was restarted.
3. `ENV_FILE` pointed at an empty scratch file → `discord_token()` returns `""` → *"alert skipped"* even if DRY_RUN were bypassed.
4. `WATCHDOG_TEST_HEALTH` bypasses `curl` entirely → no real endpoint probed.

**Proof:** the real `trevor-gateway-watchdog.service` logged **0** alert lines in the 24h before
the run and **0** since the baseline mark; every alert line in the scratch run reads
`DRY-RUN alert #qa-agent:`; the string `qa-agent alert HTTP` (emitted **only** by a real `curl`)
appears **zero** times. **No throwaway systemd unit was created** — the script's own seams drive
the state machine, so a unit would have added risk without adding evidence.

`systemctl --failed` shows only the pre-existing `getty@tty1` / `console-getty` failures.
⚠️ Minor doc drift: `CLAUDE.md` records the degraded state's *"sole cause `getty@tty1.service`"*;
there are **two** getty units failed today. Pre-existing and unrelated — recorded, not chased.
