# B7-LEDGER — RM-ALERTS rulings recovered, S5 settled, WSL state recorded

**Prompt:** `B7-LEDGER` · **Roadmap:** RM-LEDGER · Wave B slice 7 of 7 · **money-path:** no
**Box:** `ghost@Ghost` (WSL, distro TrevorHub) · **Repo:** `trevor-dashboard`, branch `master`
**Measured:** 2026-08-09, 21:39–21:55 **EDT (UTC−4)** unless a line says otherwise.

> **Clock convention for this document.** Git commit times are **ET**. The funnel probe's own log
> lines and its state file are **UTC** (the script prints `utcnow()`). systemd timestamps are **ET**.
> Every timestamp below is labelled. Nothing is compared across clocks without conversion.

> 🚨 **Redaction notice.** `origin` is **github.com/ipost76/trevor-dashboard**, confirmed **public**
> (`visibility: public`, `private: false`, unauthenticated GitHub API, 2026-08-09). Three of the seven
> rulings — **M1, M12, M26** — disclose live-box security posture and are **redacted here by Ghost's
> ruling**. Their unredacted text was recovered in full and is quoted by exact line reference to the
> on-box master. **Nothing was reconstructed; the redaction removes text, it does not replace it with
> anything invented.** See §4.3 for what is *already* public and for the destination problem this
> redaction creates.

---

## Section 1 — The seven rulings

**Source, pinned:**

| | |
|---|---|
| Path | `/home/ghost/docs/reports/recon/2026-08-06_RM-ALERTS/MASTER_2026-08-06_RM-ALERTS.md` |
| sha256 | `5651c20d80cd84f28d155b2c26bf5352555d2eedfc9c22167ff743aca4ba3314` |
| Size | 78,286 bytes · 1,027 lines |
| mtime | 2026-08-06 12:29:55 **EDT** |
| Archive row | `RECON-OBSERVABILITY-004`, `box=wsl`, `role=master`, `path_status=present` |

The master was found at **the first place looked** — the exact path the archive row names. It was never
missing from this box; it was unreachable from the box the compile ran on. Each ruling below appears
**twice** in the master: as a row in §8 (COMBINED SEVERITY-RANKED RECOMMENDATIONS) and as a numbered
paragraph in §8's "⚖️ GHOST MUST RULE ON — 7 decisions". Both are quoted for the four unredacted
rulings; line numbers are given for all seven.

**Recovery tally: 7 verbatim · 0 summary-only · 0 unrecoverable.**
Four are reproduced verbatim below. Three are recovered-verbatim-but-withheld-here (§1.5).

---

### ✅ M11 — verbatim

*Master §8, line 831:*

> | **M11** | 🚨 | **Restart `trevor-hub-monitor.service` to load `4ebb925`** — no code change; the honest four-state `check_cert()` has been unloaded since 2026-08-04. **Do M10 first so one restart loads both** | A1 R4 | VM | **GHOST-DECISION** (restart approval) |

*Master §"GHOST MUST RULE ON" item 4, lines 875–877:*

> 4. **M11 — restart `trevor-hub-monitor.service`.** A service restart needs approval. The honest
>    `check_cert()` has been sitting unloaded for 2 days. *Options: restart now / land M10's debounce
>    first and restart once / leave it and keep the mislabelled cert alerts.*

---

### ✅ M13 — verbatim

*Master §8, line 833:*

> | **M13** | 🚨 | **Rule on the HMM approach** — fix the probe's semantics (opt 2) vs recalibrate the 3600s bar (opt 3) vs both. **Option 4 is RULED OUT on evidence** | A4 §8 | VM / Ghost-side | **GHOST-DECISION** |

*Master §"GHOST MUST RULE ON" item 3, lines 870–874:*

> 3. **M13 — the HMM approach ruling.** The alert is measuring signal drought and calling it model
>    staleness. *Options: **(2)** fix the probe's semantics — the real fix / **(3)** recalibrate the
>    3600s bar — cheap interim that hides rather than fixes / **(2+3)** both, A4's recommendation /
>    **(4)** accept rules as equivalent — **RULED OUT on evidence**, 42% disagreement skewed permissive.*
>    ⚠️ **M2 (kPEPE) is mandatory regardless of this ruling** — no threshold change touches it.

---

### ✅ M17 — verbatim

*Master §8, line 837:*

> | **M17** | ⚠️ | **Decide on `apt-daily-upgrade.timer`** — live, mutating the trading box unattended, and it restarts TREVOR services. Accept + re-baseline on a schedule, or disable + patch deliberately. **Next fire 2026-08-07 06:58:39** | A3 §10.8 + A1 §6 | VM / Ghost-side | **GHOST-DECISION** |

*Master §"GHOST MUST RULE ON" item 5, lines 878–880:*

> 5. **M17 — `apt-daily-upgrade.timer`.** Live, mutating the trading box unattended, restarting TREVOR
>    services with zero alerting. **Next fire 2026-08-07 06:58:39.** *Options: accept it + re-baseline on
>    a schedule / disable it and patch deliberately.*

📌 **Status note, not part of the ruling:** the "next fire" date quoted above is **2026-08-07**, now in
the past. This is a recovered historical document — the ruling's *deadline* has elapsed, which is
itself information for whoever answers it. Do not read the elapsed date as the ruling being void.

---

### ✅ M23 — verbatim

*Master §8, line 843:*

> | **M23** | ⚠️ | **Decide whether the drain routes through `post()`** (and thus `qa_channel_guard`) **or keeps the direct `send`.** Either is defensible; **the silent bypass is not** | A1 R10 | VM | **GHOST-DECISION** |

*Master §"GHOST MUST RULE ON" item 6, lines 881–883:*

> 6. **M23 — should the alert drain route through `post()`/`qa_channel_guard`?** `BEHAVIOR_RULES.md:162`
>    asserts every `#qa-agent` post passes the guard; the drain bypasses it. *Options: route through
>    `post()` and accept its silent truncation / keep the direct `send` and correct the doc.*

---

### 🔒 §1.5 — M1, M12, M26: recovered verbatim, withheld from this file

All three were located and read in full. Their text is **not reproduced here** because this file is
tracked on a **public** remote and all three describe live-box security posture. This is a publication
decision, **not** a recovery failure — the distinction matters, because a future reader must not
re-classify these as lost.

| Ruling | Sev | Type | Source slice | Master §8 line | Master §GHOST item | Recovery |
|---|---|---|---|---|---|---|
| **M1** | 🚨 | GHOST-DECISION | A3 §5.2 / §10.6 | 821 | item 1, lines 862–866 | ✅ recovered verbatim, withheld |
| **M12** | 🚨 | GHOST-DECISION | A3 §10.7 | 832 | item 2, lines 867–869 | ✅ recovered verbatim, withheld |
| **M26** | ⚠️ | GHOST-DECISION | A3 §10.9 | 846 | item 7, lines 884–887 | ✅ recovered verbatim, withheld |

- **M1** — [REDACTED for the public remote.] A blocking VM host-state decision. **It gates M12.**
- **M12** — [REDACTED for the public remote.] A human-gated VM host-state maintenance action,
  sequenced strictly **after M1**.
- **M26** — [REDACTED for the public remote.] A VM account-privilege review item. The master records
  **no evidence of misuse**.

**To read the unredacted three:** open the master at the pinned path and sha256 above, at the line
numbers in the table. **On this box only** — the file does not exist on the VM.

⚠️ **The withheld three currently have no durable private home.** They live only in the unversioned
on-box master (§4.2). Redacting them from the one tracked, backed-up copy protects them from
publication but leaves them exposed to *loss*. §4.3 states this plainly and hands the fix to a
VM-side prompt; it is not solvable from this box.

**No secret values appear in any recovered ruling.** No webhook URL, token, key or password value was
present in the seven; nothing of that class needed redaction. Configuration keys are referenced by
**name** only in the master, and none of those names is reproduced here.

---

## Section 2 — S5: **UNTESTED — not passed**

**The signature.** S5 is not a third-party description; it is **pre-registered by the change's own
author, in the commit message of `e06c5fe`**, quoted verbatim:

> FALSIFIABLE SIGNATURE, pre-registered: if an edge outage that is still DEAD on the
> probe after the hold (3 or more consecutive failed probes, ~30 min) produces only an
> INFO line and no BROKEN page, I have silenced rather than shortened, and this change
> must be reverted.

**Why the VM could not check it.** `e06c5fe` is a **WSL-side** commit in `trevor-dashboard`, touching
`scripts/funnel_edge_watch.py` (+255/−22) and `tests/test_funnel_transient.py` (+242). It is absent
from the VM repo. There is no VM→WSL route (§4.1).

### The verdict, and why it is not "passed"

| Fact | Value | Source · clock |
|---|---|---|
| Commit authored | 2026-08-09 **12:22:42 EDT** | `git log -1 --date=iso-local e06c5fe` |
| Commit is repo HEAD | yes | `git rev-parse --short HEAD` → `e06c5fe` |
| Probe runs since the commit | **37** | `journalctl -u trevor-funnel-watch.service --since "2026-08-09 12:22:42"` |
| Runs with `verdict=HEALTHY` | **37 of 37** | same |
| Runs with `fails>0` | **0** | same |
| Runs with `pending=` anything but `no` | **0** | same |
| `last_alert` in state | **2026-08-08T21:48:25Z (UTC)** — *before* the commit | `data/funnel-edge-status.json` |
| `consecutive_fails` now | 0, `status=HEALTHY` | same, `last_check` 2026-08-10T01:29:51Z **UTC** |

**The hold path has never executed.** Not once. A signature that asks "does a sustained outage still
page?" cannot be answered by 37 consecutive successes — no outage occurred, so neither branch of the
question was exercised. **37 healthy runs is not a pass; it is an absence of evidence.**

Per the standing law on zero-counts: the window is **2026-08-09 12:22:42 EDT → 2026-08-09 21:39 EDT,
≈9 h 15 m, 37 probe runs at a 15-minute interval.** Journald retention on this box extends further
back, but the *change* is only 9 hours old — the window is bounded by the commit, not by retention.

### What the code says (structure, not evidence)

Read at HEAD; **this is code-reading and does not upgrade the verdict.** Constants:
`FAILS_TO_ALERT = 2`, `HEAL_CAP = 2`, `REPROBE_MAX_TIME_S = 8`, `PENDING_MAX_HOLD_S = 3600`,
`_HOLD_OUTCOMES = ("rearmed_still_dead", "rearmed_unconfirmed")`; timer `OnUnitActiveSec=15min`.

- The hold is entered **only** for `_HOLD_OUTCOMES`, and only `if not st.get("pending") and not
  st.get("alerted")` — so it can fire **at most once** per incident.
- `left_off`, `rearm_failed` and the heal-skipped path call `alert(...)` / `_post_down(...)`
  **immediately**, bypassing the hold entirely.
- The `else:` branch — "a second still-dead cycle, or rearm_failed" — pops `pending` and calls
  `_post_down(...)`, i.e. the **full page**.
- `UNKNOWN` holds without clearing or posting, bounded by `PENDING_MAX_HOLD_S` (3600 s ≈ 4 cycles),
  after which `_post_down` reports the last known DEAD state.

Structurally the page path is reachable. **That is a reading of the source, not an observation of the
system**, and the distinction is the whole point of S5.

### 🎯 What would settle it — precise enough to act on

**Condition A — the natural experiment (preferred, no intervention).** An edge outage that is *still
DEAD* on the probe after the hold: **≥3 consecutive `verdict=DEAD` probe runs, ≈30–45 minutes**, where
the heal reported a clean re-arm (`last_heal_outcome` ∈ `rearmed_still_dead` / `rearmed_unconfirmed`).

- **PASS** — the 3rd run emits the full 🚨 BROKEN page carrying the revive command.
- **FAIL (silenced — revert `e06c5fe`)** — the incident produces only the 🔵 INFO line and no page.

**Where to look, exactly:**
1. `journalctl -u trevor-funnel-watch.service --since <incident start>` on `ghost@Ghost` — the status
   line prints `pending=` deliberately, so a held alert leaves a trace. Grep the **message text**, not
   the priority: this unit logs via `print()` to stdout, so systemd assigns its own priority and a
   `-p err` filter would be blind to it, exactly as on the VM.
2. `data/funnel-edge-status.json` — `pending.since`, `consecutive_fails`, `last_alert` (all **UTC**).
3. 📋 **Discord `#qa-agent` channel history — a GHOST-SIDE CHECK.** This is the only source that proves
   what was *delivered* rather than what was *decided*. **Not attempted here: reading it requires the
   Discord API and a bot token, which this prompt is forbidden to use.** Ghost should read `#qa-agent`
   for the incident window and confirm whether a full BROKEN page appeared or only a single blue INFO
   line. **The tier-2 poster delivers there** — every probe line in the window records
   `webhook_target=HUB_DOWNLOADS_WEBHOOK_URL resolved, but delivering to #qa-agent via bot-token (tier 2)`.

**Condition B — a forced test (only if A has not occurred by ~2026-08-16).** Drive `main()` with a
mocked probe returning DEAD for three successive ticks, as `tests/test_funnel_transient.py` already
does. Per the commit message that harness runs 53/53 via a `__main__` self-runner, asserts against the
exact string that *would* have been POSTed, and makes **zero** Discord posts. **This is a lower grade
of evidence than A** — it re-tests the author's own model of the system. Record it as
*"passed under simulation"*, never as *"passed"*.

**Until either occurs, S5 stays UNTESTED.** Do not let a quiet week be entered as a pass.

---

## Section 3 — This box, measured

> 🚨 **This is a snapshot taken 2026-08-09, 21:39–21:55 EDT. Re-derive it; do not inherit it.**
> Every figure here decays — start timestamps move on the next restart, the replica lag is a sample of
> a repeating cycle, and HEAD advances with this very commit. The same discipline the RM-LEDGER ledger
> applies to its own numbers applies to these. **Nobody had recorded this box's own state before now**;
> prior slices ran *from* WSL and measured the VM.

### 3.1 Git

| Field | Value |
|---|---|
| Repo | `/home/ghost/projects/trevor-dashboard` |
| Branch | `master` |
| HEAD at measurement | `e06c5fe` (this document's commit is its child) |
| HEAD date | 2026-08-09 **12:22:42 EDT** |
| HEAD subject | `fix: hold a self-healing Funnel-edge alert one cycle -- one INFO line, not a BROKEN/RECOVERED pair` |
| Remote | `https://github.com/ipost76/trevor-dashboard` (HTTPS) · **PUBLIC** |
| Unpushed at measurement | **none** — `git log origin/master..HEAD` empty |
| Working tree | 0 modified, 0 staged, **16 untracked** entries |
| Hooks | **none** — `.git/hooks/` contains only `*.sample`. Confirms: **no post-commit hook on WSL; pushes are manual.** |
| Sacred manifest | **ABSENT** — no `scripts/run_guards.sh`, no `scripts/guards/`, no pre-commit chain |

Untracked entries include `docs/reports/`, 12 loose `docs/*.md` recon files, `shadow_history.db`,
`trainer_archive.db`, `tmp/`. **`docs/reports/` is untracked but NOT ignored** —
`git check-ignore -v docs/reports/` exits **1** and `.gitignore` contains no `docs` or `reports` rule.

### 3.2 Services — `systemctl show`, not `journalctl`

Enabled/active/sub from `systemctl is-enabled` / `is-active` / `show -p SubState`; start times from
`ExecMainStartTimestamp`. **`NRestarts` is reported but is a known false negative** — it counts only
systemd-managed restarts and resets on a manual stop+start, so restart history is derived from the
**start timestamp**, not from this column.

| Unit | Enabled | Active | Sub | ExecMainStartTimestamp (ET) | NRestarts |
|---|---|---|---|---|---|
| `trevor-dashboard.service` | enabled | active | running | Sun 2026-08-09 10:00:38 | 0 |
| `trevor-gateway.service` | enabled | active | running | Sun 2026-08-09 10:00:39 | 0 |
| `trevor-gateway-watchdog.service` | enabled | active | running | Sun 2026-08-09 10:00:39 | 0 |
| `trevor-watcher.service` | enabled | active | running | Sun 2026-08-09 10:00:39 | 0 |
| `trevor-trainer-observe.service` | enabled | active | running | Sun 2026-08-09 10:00:52 | **1** |
| `trevor-funnel-watch.service` | disabled | inactive | dead | Sun 2026-08-09 21:29:51 | 0 |
| `trevor-liveness-check.service` | disabled | inactive | dead | Sun 2026-08-09 21:30:35 | 0 |
| `trevor-tailsync.service` | disabled | inactive | dead | Sun 2026-08-09 21:19:11 | 0 |
| `trevor-cost-refresh.service` | disabled | inactive | dead | — | 0 |
| `trevor-hosts-pin.service` | disabled | inactive | dead | — | 0 |
| `trevor-restore.service` | disabled | inactive | dead | — | 0 |
| `trevor-trainer.service` | disabled | inactive | dead | — | 0 |
| `trevor-alert@.service` | static | — | — | — | (template) |

The four `disabled/inactive/dead` units with recent start timestamps are **one-shots driven by
timers** — `disabled` is correct for them and is not a fault. Nine `trevor-alert@*.service`
instances exist, all `inactive dead` (no failure has invoked them).

📌 **Drift correction:** `trevor-watcher.service` is **enabled + active + running** here. Prior records
(RC-A11, VF-A12) describe it as *disabled + inactive*. That is now stale.

📌 **The five long-running services all started within 14 s of each other (10:00:38–10:00:52 ET), and
uptime is 11 h 45 m** — consistent with a single boot at ≈09:54 ET, **not** with independent restarts.
`trevor-trainer-observe` shows `NRestarts=1` within that boot.

### 3.3 Timers

| Timer | Enabled | Active | Last (ET) | Next (ET) | Interval |
|---|---|---|---|---|---|
| `trevor-funnel-watch.timer` | enabled | active/waiting | 21:29:51 | 21:45:12 | `OnUnitActiveSec=15min`, `OnBootSec=5min` |
| `trevor-liveness-check.timer` | enabled | active/waiting | 21:30:35 | 21:45:32 | ~15 min |
| `trevor-tailsync.timer` | enabled | active/waiting | 21:19:11 | 21:40:59 | ~22 min observed |
| `trevor-cost-refresh.timer` | enabled | active/waiting | 2026-08-09 06:00:13 | 2026-08-10 06:00:00 | daily |
| `trevor-restore.timer` | disabled | inactive | — | — | — |

**Scheduling on this box is systemd timers, not cron.** `crontab -l` for `ghost` → *no crontab for
ghost*. **No lane watches these timers**, and no timer covers `/home/ghost/docs` (see §4.2).

### 3.4 Listening sockets

| Address:Port | Process | Serves |
|---|---|---|
| `127.0.0.1:3000` | `MainThread` pid 237 | Hub (Next.js) — the Funnel's origin |
| `127.0.0.1:3939` | `MainThread` pid 355 | gateway `/healthz` |
| `100.113.60.59:443` + `[fd7a:115c:a1e0::4234:3c3c]:443` | tailscaled | Tailscale Funnel ingress |
| `127.0.0.1:8420`, `0.0.0.0:8471` | — | local/tailnet helpers |
| `0.0.0.0:2222`, `:2225`, `:2228`, `:2232` | — | sshd listeners |
| `127.0.0.54:53`, `10.255.255.254:53` | systemd-resolved / WSL NAT | DNS |

### 3.5 System

| Field | Value |
|---|---|
| Distro | Ubuntu **24.04.4 LTS** |
| Kernel | `6.6.87.2-microsoft-standard-WSL2` |
| Uptime | 11 h 45 m at 21:39 EDT (boot ≈ 09:54 EDT) |
| Memory | 7.8 Gi total · 3.1 Gi used · 4.6 Gi available |
| Disk | `/dev/sdf` — 1007 G total, **17 G used, 940 G avail, 2 %**. `/` and `/home` are the **same filesystem** |
| Tailnet | `100.113.60.59` = `trevorhub-wsl`, account `ipost09122003.76@` |

### 3.6 Read replica

| Field | Value |
|---|---|
| Path | `/home/ghost/trevor-replica/trevor.db` |
| mtime | 2026-08-09 **21:20:50 EDT** |
| Size | 1,734,631,424 bytes (≈1.73 GB) |
| Lag at 21:39:19 EDT | **≈18.5 minutes** |
| Refreshed by | `trevor-tailsync.service` → `deploy/scripts/trevor-tailsync.sh`, *"one-shot, pull-only"* |

🚨 **Every archive figure in this document was read from the LIVE VM database over `ssh vm`
read-only, never from this replica.** The replica is recorded here as box state, not used as a source.

### 3.7 Lock helper — the filename question, settled

**`scripts/locks/_common.sh` is the real filename on this box.** There is no `_lock_common.sh` here.
Full set:

```
scripts/locks/_common.sh          scripts/locks/lock_acquire.sh
scripts/locks/lock_release.sh     scripts/locks/lock_status.sh
scripts/locks/with_file_lock.sh
```

`_common.sh` is **sourced, not executed**, and it *does* expose shell functions — its own header lists
`encode_path()`, `lock_canonicalize()`, `lock_key()`, `now()`, `resolve_repo_root()`,
`resolve_lock_dir()`, `lock_durable_pid()`, `lock_session_token()`, `lock_owner_label()`,
`lock_owner_id()`, `lock_host()`, `lock_liveness()`, `lock_pid_alive()`.

📌 **Correction to a prior record:** an earlier note held that `_common.sh` "exposes NO shell
functions". That is **stale** — the 2026-08-01 B1 rewrite made it the shared helper library. The
*practical* guidance it produced is still right for a different reason: **call `lock_acquire.sh`**,
because `_common.sh` is a library and acquiring is `lock_acquire.sh`'s job.

Mechanism confirmed live: **atomic `mkdir`** on the canonicalised absolute path, under
`<repo-root>/.locks`, meta line `<owner> <epoch> <durable-pid> <shell-pid> <host>`, default stale
window 900 s. This prompt's own claim is the proof:

```
lock root: /home/ghost/projects/trevor-dashboard/.locks
__home__ghost__projects__trevor-dashboard__docs__B7_rmalerts_recovery_s5_wsl_state_2026-08-09.md.lock
    owner=B7-LEDGER  ns=20260809T215302
    pid=144202(ALIVE)  shell_pid=176751  host=Ghost  age=12s
```

---

## Section 4 — What this actually exposes

**Nothing was lost.** "Why the seven were lost" is the wrong question: the master was intact, at the
exact path the archive named, and the four unredacted rulings are quoted above from it. The compile
that recorded them as unrecoverable was **honest and correct from where it stood** — it simply stood on
the wrong box. That honesty is what made this recovery possible; a compile that had guessed would have
left seven plausible fabrications in the record and no way to detect them.

Two findings are larger than the seven rulings.

### 🚨 4.1 — `path_status='wrong_box'` reads as a loss verdict. It means "not reachable from one box."

**46 of 46 present here. 0 missing.**

I pulled every `recon_archive` row with `box='wsl' AND path_status='wrong_box'` from the **live** VM
database over the read-only pipe, normalised the path strings, and tested each against this
filesystem:

```
NORMALIZED — PRESENT: 46 | MISSING: 0 (of 46)
```

Path normalisation was needed because the column holds **three different spellings**: bare absolute
paths, repo-relative paths, and a decorated form
`WSL:ghost@Ghost:/home/ghost/... (UNREADABLE FROM THE VM)`. The decorated form is the column *trying to
say* "reachable, just not from here" — the schema has no field for it, so the annotation was smuggled
into the path string, where it breaks any programmatic use of that path.

**The defect is semantic.** `path_status` conflates two different facts:

| What is true | What the column says |
|---|---|
| The file is gone | `gone` |
| The file exists, on another box, at this exact path | `wrong_box` |

A reader — human or compile — sees `wrong_box` next to a path they cannot open and reasonably
concludes the report is unavailable. **That is exactly what happened to the seven rulings.** The
information needed to recover them was in the row all along: `box=wsl` plus a path that is correct
*on that box*.

Row `RECON-OBSERVABILITY-004` is one of only **3** `box=wsl` rows marked `present` rather than
`wrong_box`, and its `summary` column carries a substantive digest of the master's findings — which is
why the ledger recovered three findings even without the file. **The summary column did its job.**

**Recommendation R1.** Stop overloading `path_status`. Either rename the value to something that cannot
be read as loss — `off_box` / `other_box` — or, better, drop the conflation entirely: `box` already
says *where*, so `path_status` should only ever answer *does it still exist there*. Until then, any
compile that hits `wrong_box` must **check the box named in the `box` column before recording a loss.**

### 🚨 4.2 — THE DURABLE RISK: the corpus is unversioned, unbacked, single-disk — and its only durable-by-default destination is a **public** remote

This is the finding that outlives the campaign.

**Measured:**

| Fact | Evidence |
|---|---|
| `/home/ghost/docs` is in **no git repository at all** | `git -C /home/ghost/docs rev-parse --show-toplevel` → *fatal: not a git repository (or any of the parent directories)*. No `.git` exists at `/home/ghost/docs`, `/home/ghost/docs/reports`, or `/home/ghost`. |
| Scale | **53 campaign directories** under `/home/ghost/docs/reports/recon/`, holding **46 archive-registered reports** plus unregistered slices |
| No backup | No `ghost` crontab (*"no crontab for ghost"*). The four `trevor-*` timers are tailsync / funnel-watch / liveness-check / cost-refresh — **none touches `/home/ghost/docs`**. No `/home/ghost/.snapshots`. `/home/ghost/backups` holds exactly one file, `trainer.db.pre-C2`. |
| Single disk | `/` and `/home` are the same filesystem, `/dev/sdf` |
| The one safe-looking destination is public | `origin` = `github.com/ipost76/trevor-dashboard`, **`visibility: public`** |

**Unversioned is worse than gitignored.** A gitignored file is at least *inside* a working tree that
has a remote, a history and a blast radius someone has thought about; the ignore is a decision that can
be reversed with one line. An unversioned tree has **no commit, no remote, no history, no reflog, no
second copy anywhere**. There is nothing to reverse and nothing to restore from. One `rm -rf`, one WSL
distro reset, one corrupt `/dev/sdf` and 53 campaigns are gone with no trace that they existed —
except the 46 `recon_archive` rows on the VM, which would then point at genuinely nothing and whose
`summary` column would become the *only* surviving record of each report.

**And the pair is the real finding.** The corpus is unversioned **and** the only durable-by-default
destination available to it is a public remote. Those two facts together mean **the safe home does not
currently exist.** Every move from here is blocked on creating one:

- Leave it where it is → no durability.
- Push it to `origin` → durability bought with publication of live-box security posture.

This document is itself the demonstration: it is the *recovery* artifact, it is going to a tracked
path precisely so it cannot be lost the same way — and three of its seven rulings had to be **stripped
out** to make that safe. §1.5 is that trade-off, visible.

**Recommendation R2 — create the missing destination. In order:**

1. **Decide the home first, before moving anything.** The requirement is *durable **and** private*: a
   remote, off this disk, not world-readable. A **private** GitHub repo, or a GCS bucket mirroring
   `/home/ghost/docs/reports/` on a timer, both satisfy it. `origin` as it stands does **not** —
   publishing the corpus wholesale would expose considerably more than the three rulings redacted here.
2. **Then version it**: `git init` at `/home/ghost/docs`, first commit the existing 53 directories,
   push to that private remote.
3. **Then automate it**: one `systemd` timer on this box, alongside the four that already exist. The
   box already proves the pattern works — `trevor-tailsync.timer` has been pulling the replica
   reliably on a ~22-minute cycle.
4. **Then close the loop in the archive**: make a tracked, pushed path a *precondition* of
   registration. A `recon_archive` row whose `file_path` points into an unversioned tree is a
   promise the system cannot keep.

**Recommendation R3 — the registration gap that would have made this unrecoverable.**
`SELECT count(*) FROM recon_archive WHERE roadmap='RM-ALERTS'` returns **1**: only the master
(`RECON-OBSERVABILITY-004`). The four slices it compiles —
`A1_alert_route_shape_census.md`, `A2_paper_fill_failure.md`, `A3_integrity_diff_triage.md`,
`A4_hmm_staleness.md` — sit on disk in the same directory with **no archive row at all**. Had the
master been genuinely lost, there would have been **no `summary` column to fall back to for any of
them**, because there are no rows. The summary-column fallback only works for material that was
registered. **Register slices, not just masters.**

### 📋 4.3 — Already public, and the destination problem this redaction creates

**Reported as text only. Nothing was deleted, rewritten, or force-pushed** — and a history rewrite on
a public repo is not a remedy anyway once GitHub has cached, forked and indexed the content. This is a
Ghost decision.

`git grep` at HEAD over tracked files found sudo/root-account content in **two** tracked, published
files:

| File | Hits | Class of content | Names accounts? | Names paths? |
|---|---|---|---|---|
| `docs/HUB_WAVE_CHANGELOG.md` | 5 | **WSL** box privilege posture — states that `ghost` holds `NOPASSWD: ALL` on WSL (recorded as *measured/confirmed*) and that this is what permits direct unit installs | Yes — `ghost` | Yes — `/home/ghost/.ssh`, `/etc/systemd/system/trevor-cost-refresh.{service,timer}`, `.env.local`, a `:3939/healthz` endpoint |
| `docs/ssh_one_cockpit_runbook.md` | 4 | **Cross-box** privilege + access method — states the **VM** `ghost` user has passwordless sudo via the `google-sudoers` group, and gives a working verification command `ssh vm 'sudo -n whoami'` → root | Yes — `ghost`, `trevor`; group `google-sudoers` | Yes — the `ssh vm` alias and its login user |

**What this means for the §1.5 redaction — stated honestly rather than overclaimed.** The *group name*
`google-sudoers` and the fact that the VM `ghost` user holds passwordless root are **already public**.
The redaction therefore does **not** protect those two facts. What it does still withhold, and what
`git grep` confirms is **not** currently tracked anywhere in this repo, is the material specific to
M1/M12/M26 — no tracked file at HEAD contains the host-integrity tooling state or the account-roster
specifics those three rulings carry. **The redaction buys something real; it does not buy secrecy that
was already spent.**

**R4 — for Ghost, not for this prompt.** Review those two files' publication status as a separate
decision. If the outcome is that this content should never have been public, the honest remedy is
**rotating what the disclosure devalues** (credentials, access paths) — not deleting the text.

### 4.4 — The remaining causes, ruled in or out

Recorded so they are not re-hunted. The gate reported **Causes found: 5**; §4.1 and §4.2 are the two
that matter, and are stated above.

| # | Cause | Verdict | Proof |
|---|---|---|---|
| 1 | **Cross-box path with no route** — the operative cause | ✅ **RULED IN** | The compile ran VM-side; row `RECON-OBSERVABILITY-004` is `box=wsl` with a `/home/ghost/` path. `ssh vm` is WSL→VM only; there is no VM→WSL route. The file was present here the whole time. |
| 2 | **Unversioned reports tree** | ✅ **RULED IN** (durable risk — §4.2) | `git -C /home/ghost/docs rev-parse` → not a git repository |
| 3 | **`wrong_box` reads as a loss verdict** | ✅ **RULED IN** (§4.1) | 46 of 46 present on this box, 0 missing |
| 4 | **Missing archive registration** | ✅ **RULED IN** (§4.3 / R3) | `count(*) WHERE roadmap='RM-ALERTS'` = 1, against 4 slice files on disk |
| 5 | **No backup or snapshot** | ✅ **RULED IN** (§4.2) | No `ghost` crontab; no timer covers `/home/ghost/docs`; `/home/ghost/backups` holds one unrelated file |
| — | **A gitignored reports directory** | ❌ **RULED OUT** | `git check-ignore -v docs/reports/` exits **1**; `.gitignore` has no `docs`/`reports` rule. In *this* repo `docs/reports/` is **untracked-but-not-ignored** — a different and milder failure than the VM's gitignored tree. The WSL corpus at `/home/ghost/docs` is not ignored either; it is outside version control entirely. |
| — | **A retention or prune policy** | ❌ **RULED OUT** | No prune lane exists — no `ghost` crontab, and none of the five timers touches the docs tree. Files dating to 2026-06-30 are still present, so nothing is aging anything out. |
| — | **A report delivered but never committed** | ⚠️ **RULED IN, but not causal here** | True of the whole corpus (§4.2), and it is the mechanism behind the durable risk. It did not cause *this* gap: the master was never delivered-and-then-lost, it was simply never reachable from the VM. |

### 4.5 — Adjacent trouble patterns

| Pattern | Applies? | Where |
|---|---|---|
| **Orphaned / non-durable artifact** | ✅ **the theme of this slice** | 53 unversioned campaign directories, no backup, single disk, and no private durable destination in existence (§4.2) |
| **Cross-box state assumption** | ✅ | The compile assumed *unreachable-from-here* meant *lost*. §4.1. Also `path_status`, which encodes a per-box fact in a global column. |
| **Doc / config drift** | ✅ | `trevor-watcher.service` recorded as disabled+inactive, measured enabled+active+running (§3.2); `_common.sh` recorded as exposing no functions, measured as the shared function library (§3.7) |
| **Silent lifecycle failure** | ❌ not observed | The nine `trevor-alert@*` instances are all `inactive dead`, i.e. never invoked — correct for a box with no unit failures, not evidence of swallowing |
| **Post-restart state assumption** | ❌ not observed | The five long-running services share one boot cohort (§3.2); nothing depends on a stale pre-restart assumption |

---

## Provenance

- All archive figures read from the **live** VM database at `/home/trevor/trevor/trevor.db` via
  `ssh vm "sudo -u trevor sqlite3 ..."`, **read-only**. No write of any kind was made to the VM, and
  no row was inserted or updated. Corrections needed there are reported as text to the chat, for a
  VM-side prompt to apply.
- The read replica was **not** used as a source for any figure.
- No webhook URL, token, key or password value appears in this document. `HUB_DOWNLOADS_WEBHOOK_URL`
  is referenced **by name and length only** (present, len=121).
- **No ruling text in this document was written by me.** Each of the four unredacted rulings is a
  verbatim quotation from the pinned master; the three withheld ones carry a redaction marker and a
  line reference, never a paraphrase or a stand-in. Where a status note was added (M17's elapsed
  date), it is marked 📌 and sits outside the quotation.
