# [B2] RM-MERGE — Hub build + ship to ghostbox (2026-08-19)

Roadmap: RM-MERGE v2 · Wave B · recs R4/R5/R6 · finding A1-12 · gaps G-01/G-03/G-11.
Scope executed: install Node on ghostbox, build the Hub **on WSL**, ship the artifact.
**Nothing was installed as a service, started, enabled, or repointed.** `[B5]` owns serving.

## Why the build ran on WSL and never on ghostbox

Measured peak for this build, three ways — they are three different quantities:

| measurement | value | what it is |
|---|---|---|
| **cgroup `memory.peak`** | **3,347,701,760 B = 3.12 GiB** | authoritative; this is the quantity `MemoryMax=` governs |
| `ru_maxrss` (`/usr/bin/time -v`) | 2,098,896 KiB = 2.00 GiB | largest *single* process only |
| naive RSS tree-sum | 4,611,352 KiB = 4.40 GiB | **overcounts shared pages — do not size against this** |

ghostbox had ~3.1 GB available with the engine live. A 3.12 GiB compile peak on that box
is an OOM against a live trading engine. This is the number that justifies the rule.

🚨 **Build peak is not runtime footprint.** `[B5]` must size the service's `MemoryMax`
from an observed running `node server.js`, not from any figure in this table.

## What was built

- source: `master` @ `6d567d5b02c60eed37468ee57aaac55ccff7407f`, tracked sources clean
- node: v24.16.0 / npm 11.13.0 (identical on both boxes)
- command: `NEXT_DIST_DIR=.next.ship npm run build` — the same compiler invocation
  `scripts/build_atomic.sh` uses, **with the swap step deliberately dropped**. The live
  `.next` was never touched, so it remains the rollback path for the whole merge.
  Verified: `.next` tree fingerprint (path+size+mtime over 684 files) byte-identical
  before and after, `BUILD_ID` still `d4tqw6JCSdDgjuxAMY4aQ`, service PID 280556 unchanged,
  `NRestarts=0`.
- `tsconfig.json` and `next-env.d.ts` are rewritten by `next build` to name the dist dir
  (observed again here). Snapshotted and restored; both byte-identical afterwards, git-clean.

## The two fixes this build activates

Both were committed in `2a90fb0` (2026-08-17 20:14 EDT) and had **never been built**.
The running artifact was built 2026-08-14 10:16 from `dd7c45b` — three days earlier.

| | in source | in OLD artifact | in NEW artifact |
|---|---|---|---|
| **Fix A** staleness ceiling (`single-flight.DEFAULT_STALENESS_CEILING_MS`, `createSwrCache.swr`) | yes | **no** — 0 files | **yes** — 24 files, compiled `stalenessCeiling??18e5` (1,800,000 ms = 30 min) |
| **Fix B** killswitch honesty (`api/memory/health/route.GET` catch) | yes | **no** — served route had `killswitch_enabled:!1` | **yes** — `killswitch_enabled:null`; **zero** files contain `:!1` |

All four cells were read out of the built output, not inferred from a clean build or an mtime.

⚠️ Measurement note: `grep` on this WSL box is a **shell function wrapping ugrep**, which
skips binary files. GNU `/usr/bin/grep` additionally matches
`cache/webpack/server-production/0.pack` (a build-cache blob, not served code). Counts of
*files* differ by one between the two greps; the served-route facts are identical either way.
Use `/usr/bin/grep` explicitly when counting matches across a build tree.

## Shipped

- destination: `[gb] /home/ghost/hub-artifact/20260819T182722Z-B2-next/`
- manifest: `[gb] /home/ghost/hub-artifact/20260819T182722Z-B2-next.MANIFEST.txt`
  (placed *beside* the artifact so the artifact stays byte-clean at exactly 685 files)
- 685 files, 220,591,713 bytes by **`stat`** (`du` says 214M for the same tree — never mix them)
- streamed `tar | ssh | tar`, single pass
- **verified 685/685 by sha256 at both ends, compared by (hash, name)** — never by size,
  never by exit code
- `BUILD_ID` `04DNFJ-D1b_LFnGoberGv`

## Node on ghostbox

- v24.16.0 unpacked user-local at `[gb] /home/ghost/opt/node-v24.16.0-linux-x64/bin`
- **no root used, nothing staged for Ghost**
- tarball verified against the published `SHASUMS256.txt` sha256 before unpacking
  (`d804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9`)
- 🚨 **GPG signature NOT verified** — Node's release keys are not in ghostbox's keyring and
  no key was imported. Trust rests on the checksum fetched over HTTPS, not on a signature.
- no shell profile or PATH file was modified. `[B5]` should set PATH in the unit:
  `Environment=PATH=/home/ghost/opt/node-v24.16.0-linux-x64/bin:/usr/local/bin:/usr/bin:/bin`
- the container `trevor-prime-3` still has its own Node v18.19.1 (EOL); untouched.

## Correction to the [B2] brief

The brief stated `ghost` has no passwordless sudo on the ghostbox host "beyond a narrow
read-only grant". Measured: `ghost` **also holds a full `(ALL : ALL) ALL` sudo entry**, but it
is password-gated with `use_pty`, so it is unusable over `ssh -o BatchMode=yes`. The NOPASSWD
grant is indeed narrow and read-only (`smartctl`, `ufw status`, `crontab -l`, `ausearch`,
`nft list`). **The operational rule is unchanged** — root is unreachable non-interactively —
but later prompts should inherit the accurate premise.

## Engine safety

The engine runs **inside the incus container `trevor-prime-3`** (uid 1001000), not on the
ghostbox host; `/home/trevor` does not exist on the host. Liveness was proven four times by
**advancing rows**, never by `systemctl`:

| read | `loop_heartbeat` Σiter | `decision_log` | `shadow_decisions` |
|---|---|---|---|
| pre-install | 1,060,721 | 44,846 | 34,844 |
| pre-install +37s | 1,060,723 | 44,847 | 34,845 |
| post Node install | 1,061,170 | 45,092 | 35,090 |
| post transfer | 1,061,194 | 45,105 | 35,103 |

Nothing on ghostbox is serving the new artifact: 0 processes referencing the path, 0 host
node processes, 0 `trevor-dashboard` units on the host, nothing listening on `:3000`.
