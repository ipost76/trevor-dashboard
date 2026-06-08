# WSL #downloads Delivery — Wired + DNS Pinned [W-J-P1]

**Date:** 2026-06-08 · **Box:** TrevorHub (WSL) · **Repo:** `/home/ghost/projects/trevor-dashboard`

This report is itself the delivery test: it is sent to Discord **#downloads** through the
newly-wired path, proving the existing sender now has a caller.

## What changed

1. **Report-gen → #downloads is wired.** New thin helper `scripts/deliver_report.py`
   (`deliver_report(filepath, title, description)`) wraps the existing
   `scripts/discord_file_delivery.post_file_sync()`. The sender, the env webhook
   (`HUB_DOWNLOADS_WEBHOOK_URL`, env-only/fail-loud/no fallback), and the manifest
   registration already existed — this adds the missing **call**, plus a defence-in-depth
   scrub that redacts any webhook URL that could leak into an error string.
   Convention: *finalizing a WSL report = call `deliver_report`*.

2. **Webhook rotated.** The previously-exposed `HUB_DOWNLOADS_WEBHOOK_URL` was reminted in
   Discord and replaced in `.env.local` (gitignored, never printed); the old one deleted.

3. **MagicDNS pinned on BOTH boxes.** Recon had the box backwards: `ssh vm` runs from WSL,
   so the failing resolution was on the **WSL** side (which had no pin). Fixed by adding
   `100.93.113.117  trevor-prime.tail068f72.ts.net trevor-prime` to **WSL** `/etc/hosts`
   (the real fix) and, for symmetry, additively to the **VM** `/etc/hosts`. `ssh vm` now
   resolves by name with no IP override.

## Out of scope (flagged)

The VM's own sender `/home/trevor/trevor/discord_file_delivery.py` (`DISCORD_BOT_TOKEN`-based)
is still returning HTTP 401 — VM daily reports silently failing since 2026-06-06. Different
box, different auth; deferred to a separate VM-side fix.
