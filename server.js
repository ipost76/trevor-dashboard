#!/usr/bin/env node
/**
 * TREVOR Hub — Custom Server
 * Serves Next.js on port 3333
 */

const http = require("http");
const next = require("next");
const { parse } = require("url");

const PORT = parseInt(process.env.PORT || "3333", 10);
const HOST = process.env.HOST || "0.0.0.0";

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
