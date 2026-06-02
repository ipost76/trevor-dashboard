#!/usr/bin/env node
/**
 * TREVOR Hub — Custom Server
 * Serves Next.js on port 3333
 */

const http = require("http");
const next = require("next");
const { parse } = require("url");
const { spawn, execFile } = require("child_process");
const { join } = require("path");

// Python interpreter under TREVOR's venv (mirrors src/lib/api-helpers.ts).
const TREVOR_DIR = process.env.TREVOR_PROJECT_DIR || "/home/trevor/trevor";
const PYTHON_PATH = join(TREVOR_DIR, "venv", "bin", "python3");
// systemd unit whose NRestarts feeds /api/health restart_count (REL-14).
const SERVICE_UNIT = process.env.TREVOR_HUB_UNIT || "trevor-dashboard.service";

// Event-loop-lag histogram (RM-DASH 2026-05-29, audit Fix 7) — created + enabled
// ONCE at startup, shared with the /api/health route via globalThis (same Node
// process). perf_hooks is a built-in sampler; this cannot wedge the loop.
try {
  const { monitorEventLoopDelay } = require("perf_hooks");
  if (!globalThis.__trevorEloopDelay) {
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    globalThis.__trevorEloopDelay = h;
  }
} catch (e) {
  console.error("[HUB] event-loop-delay monitor init failed:", e);
}

const PORT = parseInt(process.env.PORT || "3333", 10);
const HOST = "127.0.0.1";

const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  server.listen(PORT, HOST, () => {
    console.log(`[HUB] TREVOR Hub ready on http://${HOST}:${PORT}`);

    // PERF-04 (2026-06-02): pre-warm the Python interpreter. Every bridge call
    // spawns a fresh `venv/bin/python3` (there is no persistent interpreter), so
    // the FIRST post-boot call pays cold disk reads for the interpreter binary +
    // venv shared libs + the json/sqlite3 stdlib. A no-op spawn at boot warms the
    // OS page cache so that first real call is hot. Fire-and-forget AFTER serving
    // starts (inside the listen callback, via setImmediate) → never delays READY;
    // detached + unref'd + error-swallowed → a warm miss can never crash the Hub.
    setImmediate(() => {
      try {
        const warm = spawn(PYTHON_PATH, ["-c", "import json, sqlite3, sys"], {
          stdio: "ignore",
          detached: true,
          env: { ...process.env, HOME: "/home/trevor" },
        });
        warm.on("error", () => {}); // ENOENT / perms — best-effort, ignore
        warm.unref();
      } catch (e) {
        /* best-effort prewarm; never fatal */
      }
    });

    // REL-14 (2026-06-02): capture systemd NRestarts ONCE at boot for the
    // /api/health `restart_count` field. Read here (not per-request) so the
    // health route stays instant + non-blocking (REL-09) — it just reads the
    // cached number. NRestarts only changes when systemd restarts the unit,
    // which replaces this process → the new process re-reads at its own boot, so
    // a boot-time snapshot is always current for the process's lifetime. Null on
    // any failure (the route renders null rather than a wrong number).
    globalThis.__trevorRestartCount = null;
    setImmediate(() => {
      try {
        execFile(
          "systemctl",
          ["show", SERVICE_UNIT, "-p", "NRestarts", "--value"],
          { timeout: 4000 },
          (err, stdout) => {
            if (err) return; // leaves the cached value at null
            const n = parseInt(String(stdout).trim(), 10);
            if (Number.isFinite(n)) globalThis.__trevorRestartCount = n;
          }
        );
      } catch (e) {
        /* systemctl unavailable — restart_count stays null */
      }
    });
  });
});
