#!/usr/bin/env node
/**
 * TREVOR Hub — Custom Server
 * Serves Next.js on port 3333
 */

const http = require("http");
const next = require("next");
const { parse } = require("url");

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
  });
});
