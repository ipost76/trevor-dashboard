# INFRA-06 — `virtio_balloon` Host Memory-Pressure Investigation

> **Status:** read-only investigation. **No code changed, no host changed.** **Verdict: MOOT — closed.**
> **Date:** 2026-06-03 · **Repo:** `trevor-dashboard` (`master`) · **Author:** CC (Hub session, RM-HUB Wave 7)
> **Scope:** whether `virtio_balloon` (the GCP host's guest-memory-ballooning driver) is an *independent cause* of TREVOR Hub instability, or merely a downstream symptom of the broader memory/CPU pressure that REL-01 + the RM-HUB roadmap already addressed.

---

## 0. TL;DR

- **`virtio_balloon` is NOT an independent cause of Hub instability.** The audit's hypothesis is **confirmed**: the balloon correlation is *downstream* of memory pressure, not causal.
- The kernel is logging `virtio_balloon virtio2: Out of puff! Can't get 1 pages` **today** (recurring clusters through 17:35, investigated 18:18) — so the balloon is *active*, not purely historical. But **"Out of puff" means the balloon tried to INFLATE (reclaim guest RAM for the host) and FAILED because the guest had no free pages to give.** The balloon is the *messenger* of memory tightness, not the consumer of it.
- `/proc/vmstat` shows `balloon_inflate == balloon_deflate` (equal cumulative page counts) → **net-zero churn**: the balloon thrashes inflate↔deflate but its net size stays flat. It is **not** eating the guest's RAM — the workload is.
- **Zero OOM kills** all-time in the journal; `VIRTIO_BALLOON_F_DEFLATE_ON_OOM` is negotiated, so under true OOM the balloon auto-deflates and returns RAM — the safety net is working.
- **The instability symptoms REL-01 + the roadmap targeted are resolved:** event-loop p99 **11.7 ms** (healthy), CPU steal `st` ≈ 0 (no host-induced CPU starvation), memory PSI `full avg10 = 0.25` (low), swap statically full but **not actively thrashing** (`so` ≈ 0), Hub `restart_count = 0` over the last ~5.6 h, stable.
- **⚠️ Premise correction:** the box is **`e2-standard-2` (2 vCPU / 8 GB)**, confirmed by GCP metadata — **NOT** the `e2-standard-4` / 15 GB the prompt and roadmap state assumed. The VM is **half the size** the roadmap thought. This materially reframes the FIX-D6 VM-resize cost decision (see §5).

---

## 1. Environment (verified)

| Fact | Value | Source |
|---|---|---|
| Machine type | **`e2-standard-2`** (2 vCPU / 8 GB) | GCP metadata `instance/machine-type` |
| vCPU | **2** | `nproc` |
| `MemTotal` | **8,129,684 kB** (~8 GB) | `/proc/meminfo` |
| Swap | 4 GB file (`/swapfile`, prio −2) | `swapon --show` |
| balloon driver | `virtio_balloon` loaded, bound to `virtio2` | `lsmod`, `/sys/bus/virtio/devices/virtio2` |
| balloon features | `STATS_VQ` + `DEFLATE_ON_OOM` negotiated | `virtio2/features` bitmap `1110…` |
| Hub service | `trevor-dashboard.service`, PID booted ~12:43, uptime ~5.6 h | `journalctl`, `/api/health` |

> The prompt's "e2-standard-4, 15 GB RAM" technical context is **stale/incorrect** — every independent source (GCP metadata, `nproc`, `MemTotal`) agrees the live box is `e2-standard-2` / 8 GB. The 7.8 GiB `free` reading is the **native VM size**, NOT ~8 GB of balloon reclamation out of a 16 GB guest.

---

## 2. MOOT-check data (read-only)

| Signal | Reading | Interpretation |
|---|---|---|
| `/proc/pressure/cpu` | `some avg10=74 avg60=69 avg300=55` | High *now*, but `st`≈0 (no host steal) → it is **our own workload**, not host CPU starvation (see §3) |
| `/proc/pressure/memory` | `some avg10=0.8`; **`full avg10=0.25`** | **Low** — the system is not stalling on memory |
| `free -h` | 8 GB total, 70 % used, **2.3 GB available** | Tight, but heavily inflated by this multi-agent session (~2.5 GB is `claude` procs — see §3) |
| `swapon` / `vmstat` | swap **3.6 / 4 GB used**; `si` 30–250 KB/s, **`so` ≈ 0** | Statically full from past pressure; **not actively thrashing** (swap-out ≈ 0; `swpd` flat across samples) |
| Hub restarts / 24 h | one real **watchdog-timeout freeze at 04:26** (merge churn), then a clean build/deploy restart at 12:43; stable since | `restart_count = 0`, ~5.6 h uptime, 0 restarts in the last window |
| `/api/health` | `status: degraded` | **Benign** — `max_ms 1206` latched the degraded flag (`LAG_DEGRADED_MAX_MS = 1000`, a one-time cold-start/GC spike); **p99 = 11.7 ms** (well under the 250 ms threshold). The watchdog reads the HTTP code only and treats 200/degraded as healthy → no restart loop. The event loop is fine. |
| OOM kills | **none** (7-day journal) | `DEFLATE_ON_OOM` safety net working |

---

## 3. CPU/memory pressure is workload-driven, not balloon-driven

`vmstat 1`: `us` 43–58 %, `sy` 8–18 %, `id` 23–36 %, `wa` 3–16 %, **`st` 0–1 %**, run-queue `r` 0–3 on 2 CPUs.

- **`st` ≈ 0** is the decisive fact: the GCP host is **not** stealing CPU cycles from this guest. REL-01's CPU-starvation freeze was an *internal* event-loop wedge (sync `spawnSync` / cache stampede), already fixed — not host contention.
- The high CPU PSI and the 70 %/swap-full memory reading are **inflated by this very session**: `ps` shows **6+ concurrent `claude` agent/CLI processes at ~400–440 MB RSS each (~2.5 GB total)**, plus the bot's two python processes (~460 MB), the Hub `node` (~101 MB), and `litestream` (~91 MB). In steady state (bot + Hub + litestream only, **no** multi-`claude` RM-HUB fleet) the box runs materially lighter.
- **Honesty caveat:** today's "Out of puff" balloon clusters and the swap-full reading were captured **during a heavy multi-agent RM-HUB session**. They should **not** be read as steady-state pressure, and resize urgency should **not** be overstated on this snapshot.

---

## 4. Balloon activity — active, but failing and downstream

- **Kernel log (recurring, current):** `virtio_balloon virtio2: Out of puff! Can't get 1 pages` — clusters at 12:56, 13:17, 14:37, 14:48, 15:00, 16:35, 16:45, 17:12, 17:22, 17:35 (investigated 18:18). The host asked the balloon to inflate (reclaim guest RAM); the guest's `fill_balloon` couldn't allocate a free page → **the reclaim fails.** This is the balloon failing to take RAM, not the balloon holding RAM.
- **`/proc/vmstat`:** `balloon_inflate 273997552` **==** `balloon_deflate 273997552` (equal cumulative page counts); `balloon_migrate 580949`. Equal inflate/deflate = **net-zero size, continuous churn** — the balloon thrashes but does not grow. It is not the ~missing-RAM culprit (there is no missing RAM: the box is natively 8 GB).
- **No `num_pages` sysfs node** is exposed on this kernel and `/proc/meminfo` carries no `Balloon` counter, so live balloon size isn't directly readable — but the vmstat net-zero + "Out of puff" failures together establish the balloon is **not** successfully reclaiming guest memory.

**Conclusion:** balloon activity *correlates* with memory tightness exactly as the audit suspected — but it is a **symptom** (the host periodically wanting RAM back from a near-full 8 GB guest), not a **cause** of Hub instability. With `DEFLATE_ON_OOM` negotiated and zero OOM kills, the balloon is not a stability threat.

---

## 5. Residual (already-known) + FIX-D6 note

There is **one** genuinely actionable residual, and it is **not** a Hub/CC code change:

- **The VM runs near its memory ceiling under load** — 8 GB, swap statically full, balloon churning "Out of puff." This is **FIX-D6 / VM-resize territory**, a host/**cost** decision that belongs to **Ghost**.
- **FIX-D6 correction (flagged):** the box is **`e2-standard-2` (8 GB / 2 vCPU)**, **not** `e2-standard-4` (16 GB) as the prompt/roadmap state assumed. Any resize math should start from the correct 8 GB baseline — the box is **half** the size the roadmap thought, which makes a bump to `e2-standard-4` (16 GB) a *doubling*, not a marginal step.
- **Do not overstate urgency:** today's pressure readings are inflated by the multi-`claude` RM-HUB session (~2.5 GB of `claude` procs). Steady-state load (bot + Hub + litestream) is lighter. There are **zero OOM kills**, memory PSI is low, and swap is not actively thrashing. The resize is a *headroom/cost* judgment for Ghost, not an incident response.

**No safe guest-side mitigation is proposed or applied.** Host machine sizing is Ghost's call; no Hub code change is warranted.

---

## 6. Verdict

**MOOT — INFRA-06 closed.** `virtio_balloon` is downstream, not causal: "Out of puff" means it can't even reclaim, net balloon size is flat, and there are zero OOM kills. The instability was resolved by **REL-01 + the RM-HUB roadmap** (event loop healthy, no CPU steal, restart_count 0, memory PSI low). The only residual is the 8 GB box's headroom under load, deferred to Ghost's **FIX-D6 VM-resize cost decision** — with the correction that the box is `e2-standard-2` (8 GB), not `e2-standard-4` (16 GB).

**No money path. No code change. No host change.**
