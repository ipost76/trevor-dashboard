"use strict";
/**
 * TREVOR Hub — systemd watchdog feeder (INFRA-02, RM-HUB Wave 4, 2026-06-02)
 *
 * Feeds systemd's `WatchdogSec=` watchdog with `sd_notify(WATCHDOG=1)` so a
 * HUNG-BUT-ALIVE Hub (event loop wedged, process not dead) gets killed +
 * restarted — the failure mode `Restart=always` alone cannot catch.
 *
 * SUBORDINATE BACKSTOP: this sits BENEATH the /api/health watchdog
 * (`/home/trevor/scripts/dashboard_health_watchdog.sh`), which remains the
 * SINGLE primary restart authority (REL-06/08 preference, windowed give-up +
 * loud #qa-agent page). WatchdogSec is 60s so systemd only fires AFTER the
 * health watchdog (~60-75s: 30s poll × 2 fails + 15s timeout) has already had
 * its chance — last resort, can't restart-loop ahead of the give-up page.
 *
 * WHY systemd-notify (a child process), not an in-process datagram:
 *   Node core `dgram` supports only udp4/udp6 — it CANNOT open an AF_UNIX
 *   SOCK_DGRAM socket, which is what sd_notify requires. There is no pure-Node
 *   way to send WATCHDOG=1 from the main PID without a native addon (a new
 *   dependency, disallowed). So we shell out to /usr/bin/systemd-notify, which
 *   runs as a CHILD pid. That requires `NotifyAccess=all` on the unit (main
 *   would reject a non-main-PID sender). `all` only accepts notifications from
 *   processes inside this service's OWN cgroup — negligible spoof surface for a
 *   single-process unit, and the accepted tradeoff vs a native dependency.
 *
 * RESPONSIVENESS GATING (the FIX-D2 standard — never ping blindly):
 *   1. STRUCTURAL: the ping fires from a setInterval ON THE MAIN EVENT LOOP. A
 *      synchronously-wedged loop physically cannot run the callback -> no ping
 *      -> systemd kills after WatchdogSec. This is the load-bearing detector.
 *   2. FRESH-LIVENESS: a 2s heartbeat stamps `lastBeat`. We ping only if the
 *      beat ran recently (loop is turning RIGHT NOW). The /api/health
 *      event-loop histogram is cumulative-since-boot, so it can't answer
 *      "responsive now" — hence the dedicated fresh heartbeat. The threshold
 *      (3× beat ≈ 6s) is generous so a merely-SLOW loop is NOT false-killed;
 *      only a genuinely stalled one withholds the ping.
 *   3. SERVING: ping only if the HTTP server is actually listening — catches
 *      "loop alive but server died".
 *
 * Inert when not under a systemd watchdog (no NOTIFY_SOCKET) — safe under
 * `next dev` or a plain `node server.js`.
 */
const { spawn } = require("child_process");

function defaultNotify() {
  try {
    // systemd-notify inherits our env (incl. NOTIFY_SOCKET that systemd set for
    // this unit) and sends WATCHDOG=1 from its own pid -> accepted under
    // NotifyAccess=all. Best-effort: a miss (ENOENT / not-under-systemd) must
    // NEVER crash the Hub.
    const p = spawn("systemd-notify", ["WATCHDOG=1"], { stdio: "ignore" });
    p.on("error", () => {});
    if (p.unref) p.unref();
  } catch (e) {
    /* never fatal */
  }
}

/**
 * @param {object} opts
 * @param {{listening?: boolean}} [opts.server]  HTTP server to gate on
 * @param {() => object} [opts.getServer]         alt: lazy server getter
 * @param {string} [opts.notifySocket]            override NOTIFY_SOCKET (tests)
 * @param {string|number} [opts.watchdogUsec]     override WATCHDOG_USEC (tests)
 * @param {number} [opts.beatMs]                  heartbeat cadence (default 2000)
 * @param {() => void} [opts.notify]              override sender (tests)
 * @param {(m:string)=>void} [opts.log]
 */
function startSystemdWatchdog(opts = {}) {
  const notifySocket = opts.notifySocket || process.env.NOTIFY_SOCKET;
  const log = opts.log || ((m) => console.warn(m));
  if (!notifySocket) {
    log("[HUB][watchdog] inert — no NOTIFY_SOCKET (not running under a systemd WatchdogSec).");
    return { enabled: false, reason: "no NOTIFY_SOCKET" };
  }

  const usec = parseInt(String(opts.watchdogUsec || process.env.WATCHDOG_USEC || "0"), 10);
  // Cadence = WatchdogSec / 3 so one delayed/missed tick still leaves two more
  // attempts inside the window (60s window -> 20s ping). Floor 1s, default 20s.
  const pingMs = usec > 0 ? Math.max(1000, Math.floor(usec / 1000 / 3)) : 20000;
  const beatMs = opts.beatMs || 2000;
  const getServer = opts.getServer || (() => opts.server);
  const notify = opts.notify || defaultNotify;

  let lastBeat = Date.now();
  const beat = setInterval(() => {
    lastBeat = Date.now();
  }, beatMs);
  if (beat.unref) beat.unref();

  let sent = 0;
  let withheld = 0;
  const tick = () => {
    const sinceBeat = Date.now() - lastBeat;
    const loopFresh = sinceBeat < beatMs * 3; // beat ran within ~6s -> loop turning now
    const srv = getServer();
    const serving = !!(srv && srv.listening);
    if (loopFresh && serving) {
      notify();
      sent++;
    } else {
      withheld++;
      log(
        `[HUB][watchdog] ping WITHHELD (sinceBeat=${sinceBeat}ms serving=${serving}) — ` +
          "systemd will SIGABRT+restart if this persists past WatchdogSec."
      );
    }
  };
  const pinger = setInterval(tick, pingMs);
  if (pinger.unref) pinger.unref();

  log(
    `[HUB][watchdog] armed — WATCHDOG_USEC=${usec || "?"}, ping every ${pingMs}ms, ` +
      "gated on (loop-fresh && server.listening)."
  );
  return {
    enabled: true,
    pingMs,
    beatMs,
    stats: () => ({ sent, withheld }),
    stop: () => {
      clearInterval(beat);
      clearInterval(pinger);
    },
  };
}

module.exports = { startSystemdWatchdog };
