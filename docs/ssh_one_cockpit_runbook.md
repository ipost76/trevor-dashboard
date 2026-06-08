# SSH One-Cockpit Runbook — WSL Hub → VM (`trevor-prime`)

> Setup code: W-G-P1. Lets an operator drive the VM from this WSL tab without
> switching Termius tabs. Additive config only (`~/.ssh/config` + this doc).

## Purpose

Drive the VM `trevor-prime` straight from the WSL Hub (`ghost@Ghost`) terminal.
One `ssh vm '<cmd>'` lands you on the VM, runs the command, and returns — no tab
switching, no re-typing the full target.

## The pipe

```
ssh vm '<cmd>'
```

- Lands you as **`ghost@trevor-prime`**.
- Prefix with **`sudo`** for trevor-owned / root work — it is **passwordless**
  (`ghost` is in `google-sudoers`), so `sudo -n` works non-interactively.
- The `vm` alias (and `trevor-prime`) is defined in `~/.ssh/config`:
  `HostName trevor-prime.tail068f72.ts.net`, `User ghost`,
  `IdentityFile ~/.ssh/google_compute_engine`, `IdentitiesOnly yes`.

### Why an explicit IdentityFile is in the config

The WSL box's only private key is `~/.ssh/google_compute_engine` (a **non-default**
filename), and there is **no ssh-agent running**. Plain `ssh` only auto-offers
default-named keys (`~/.ssh/id_*`), so without the `IdentityFile` line the login
fails with `Permission denied (publickey,password)`. The config pins the key, so
`ssh vm` works with no `-i` flag.

## Common commands (examples)

```
ssh vm 'sudo systemctl status trevor.service'                       # bot status
ssh vm 'sudo journalctl -u trevor.service -n 50 --no-pager'         # recent bot logs
ssh vm 'cd /home/trevor/trevor && sudo -u trevor git log --oneline -5'  # bot repo state
```

## Why `ghost`, not `trevor`

The WSL box's key (RSA-3072, `SHA256:Sjqpld1uO2dSv+fjStW1d/W3AkTrM5Y37BUA/MwtIkk`,
comment `ghost@Ghost`) is installed under the VM's **`ghost`** account
(`/home/ghost/.ssh/authorized_keys`, GCP-metadata-managed) — **not** under
`trevor`. The VM `ghost` user has passwordless sudo (`google-sudoers`) and is a
member of the `trevor` group (gid 1005), so `ssh vm 'sudo …'` can do effectively
all VM work, including trevor-owned files. `trevor@…` is **not** a valid SSH
target from this box (the earlier `Permission denied` was the wrong user).

## DNS note

The hostname resolves via a static `/etc/hosts` pin on this WSL box:

```
100.93.113.117  trevor-prime.tail068f72.ts.net
```

This is required because WSL periodically regenerates `/etc/resolv.conf` (pointing
at the Windows-host resolver on a different tailnet suffix), so MagicDNS for
`*.tail068f72.ts.net` is **not** reliably resolvable here. The pin makes the name
resolve deterministically (`nsswitch` = `files dns`, files first). If the VM's
tailnet IP ever changes (rare — only on node remove/re-add), update that one line
in `/etc/hosts`.

**Durability (W-K-P1, 2026-06-08):** WSL also regenerates `/etc/hosts` itself on
every distro start (`generateHosts` is default-on), which silently wiped this pin
after PC sleep/resume — leaving `ssh vm` to fail with `Could not resolve hostname`
during the tailscaled MagicDNS warm-up window. The pin is now **auto-restored on
every boot** by a systemd oneshot, so it survives resume:

```
systemctl status trevor-hosts-pin.service     # enabled; re-adds the pin if missing
cat /etc/systemd/system/trevor-hosts-pin.service
```

## Recovery

If `ssh vm` ever fails, re-run the W-G-P1 Phase 0 checks to isolate the layer:

```
grep trevor-prime /etc/hosts                                   # DNS pin present?
getent ahosts trevor-prime.tail068f72.ts.net                   # resolves to .117?
tailscale ping --timeout=5s --c=1 100.93.113.117               # connectivity?
ssh vm 'hostname; whoami'                                       # login + identity
ssh vm 'sudo -n whoami'                                         # passwordless sudo -> root
ssh vm 'sudo -n systemctl is-active trevor.service'            # trevor-owned access -> active
```

### Host key is pinned in `known_hosts`

The VM's host key is pinned under the **hostname** in `~/.ssh/known_hosts`:
ed25519 `SHA256:kVtP7kkLwUuMBR9drtbXvKrnbWuOoYdvcRulW5Q8xoY` (verified identical to
the key already trusted under IP `100.93.113.117`). If you ever hit
`Host key verification failed` (e.g. the **VM is rebuilt** and its host key
changes), re-pin it safely:

```
ssh-keygen -R trevor-prime.tail068f72.ts.net            # drop the stale entry
ssh-keyscan -t ed25519 trevor-prime.tail068f72.ts.net | ssh-keygen -lf -   # inspect new fp
# Only after you have INDEPENDENTLY confirmed the new fingerprint is the real VM:
ssh-keyscan -t ed25519 trevor-prime.tail068f72.ts.net >> ~/.ssh/known_hosts
```

Never blindly accept a changed host key — a mismatch can mean MITM.

## Phone → WSL Cockpit Stability (W-K-P1, 2026-06-08)

This section is the **reverse** pipe: the phone (Termius) reaching **this WSL Hub**
as the daily cockpit. It is independent of the `ssh vm` pipe above and independent
of the bot (the bot runs on the VM and is unaffected by any WSL/PC flake).

### Topology

```
Phone (Termius)
  → Windows PC tailnet IP 100.79.103.74 : 2232   (account ipost09122003.76@, node "ghost")
    → Windows netsh portproxy  0.0.0.0:2232 → <WSL eth0>:2232
      → WSL distro TrevorHub (internal hostname "Ghost") sshd on 2232
```

Tailscale runs **on the Windows PC** for this path (not inside WSL). A separate
Tailscale instance runs **inside** WSL (node `trevorhub-wsl` 100.125.247.52,
account `ipost76@`) purely to reach the VM via `ssh vm` — different account/tailnet.

### Root cause of the post-sleep "connection reset by peer"

After the PC slept/resumed, the phone got *"connection established → starting SSH
session → reset by peer"* on 2232. The network recovered but **nothing was behind
the portproxy**:

- The WSL distro **idle-stops** ~30s after its last attached client and was **not
  restarted on resume**. The Windows `netsh portproxy` (`0.0.0.0:2232 → <wslIP>:2232`)
  still *accepts* the phone's TCP connect (so "connection established"), then forwards
  into a dead WSL VM → **reset by peer**.
- The `WSL-Keepalive` scheduled task that pins the distro up **was killed by sleep**:
  its `StopIfGoingOnBatteries`/`DisallowStartIfOnBatteries` were the default `true`,
  so the power transition into sleep aborted the forever-running task
  (`LastTaskResult 0x8007042B` = `ERROR_PROCESS_ABORTED`), and with only a
  **Logon trigger** (resume is an *unlock*, not a fresh logon) nothing relaunched it.

**sshd itself was never the problem.** Inside a *running* distro, ssh is
systemd-`enabled` + socket-activated (`ssh.socket` → `ssh.service`) and comes up
in <1s automatically. The failure was the **Windows-side WSL lifecycle**, which
cannot be fixed from inside WSL.

### The fix (applied 2026-06-08)

**WSL side (in-distro, additive):**
- SSH keepalives added to `/etc/ssh/sshd_config` so idle phone sessions are not
  silently reset: `ClientAliveInterval 30`, `ClientAliveCountMax 3`
  (verify: `sudo sshd -T | grep -i clientalive`).
- `/etc/hosts` pin made durable via `trevor-hosts-pin.service` (see DNS note above).

**Windows side (Task Scheduler — `C:\Users\ipost\.wsl-ssh\`):**
- `WSL-Keepalive`: `StopIfGoingOnBatteries`/`DisallowStartIfOnBatteries` set to
  **false** (sleep no longer kills it), `ExecutionTimeLimit` unlimited, and triggers
  expanded to **Boot + Logon + SessionUnlock + Power-Troubleshooter(EventID 1, resume)**
  so it relaunches and re-pins the distro after every resume.
- `WSL SSH Portproxy Refresh` (`refresh-ssh-portproxy.ps1`, already dynamically
  discovers the live eth0 IP and self-verifies the socket bound): same
  **SessionUnlock + resume-event** triggers added, so the portproxy re-points at the
  live WSL IP immediately on resume instead of waiting up to 5 min.
- Backups of the pre-change task XML: `WSL-Keepalive.bak.wkp1.xml`,
  `WSL-SSH-Portproxy-Refresh.bak.wkp1.xml` in `C:\Users\ipost\.wsl-ssh\`.

### "Cockpit dropped after PC sleep" — recovery checklist

Most of this is now automatic on resume. If it ever still drops, isolate the layer:

**On the Windows PC (CMD/PowerShell — always up):**
```
wsl -l -v                                              # is TrevorHub Running? (must be)
Get-ScheduledTask WSL-Keepalive | % State              # must be Running
schtasks /run /tn "WSL-Keepalive"                      # re-pin distros if not Running
schtasks /run /tn "WSL SSH Portproxy Refresh"          # re-point portproxy at live IP
netsh interface portproxy show v4tov4                  # 0.0.0.0:2232 -> current WSL eth0 IP?
netstat -ano -p TCP | findstr 0.0.0.0:2232             # LISTENING on the Windows side?
```

**Inside WSL (if reachable):**
```
ss -tln | grep :2232                                   # sshd listening on 2232?
sudo systemctl status ssh.service                      # active (socket-activated)?
ip -4 addr show eth0                                   # current eth0 IP (compare to portproxy target)
```

If the portproxy `connectaddress` no longer matches `eth0` (WSL IP drift), the
refresh task fixes it — just run it (command above); never hand-edit the IP.

### Long-term fix (removes the PC as a single point of failure)

The phone currently depends on the **Windows PC** being awake + on the tailnet +
the portproxy + the distro being up. To delete that whole chain: join the **phone
to the `ipost76@` tailnet** (the one the WSL `trevorhub-wsl` node and the VM
`trevor-prime` are already on). Then the phone can reach:
- the cockpit directly at `trevorhub-wsl` `100.125.247.52:2232`, and
- the VM directly at `trevor-prime` `100.93.113.117`,

with no Windows portproxy in the path. (The PC/WSL must still be powered for the
WSL cockpit; but VM access becomes fully PC-independent.)

## What NOT to do

- **Never hand-edit `/home/ghost/.ssh/authorized_keys` on the VM** — it is
  GCP-metadata-managed and the guest agent will overwrite it. Durable key changes
  go through **GCP project/instance metadata** (`ssh-keys`).
- No `tailscale set` / DNS-mode changes on the WSL box (the `/etc/hosts` pin is the
  surgical fix; do not flip `generateResolvConf`).
- No service restarts or `authorized_keys` edits on either box for routine use.
- **Do not re-enable `StopIfGoingOnBatteries` / `DisallowStartIfOnBatteries` on the
  `WSL-Keepalive` task** (W-K-P1) — that is exactly what let PC sleep kill the
  keepalive and drop the cockpit. Keep them `false`.
- **Do not hand-set a fixed WSL IP in the portproxy** — WSL2 NAT IPs drift on
  restart. Let `WSL SSH Portproxy Refresh` discover the live `eth0` and rebind.
- Do not delete `trevor-hosts-pin.service` — WSL regenerates `/etc/hosts` on boot
  and would silently drop the VM pin again.
