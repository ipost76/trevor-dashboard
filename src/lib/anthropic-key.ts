/**
 * Resolve the ANTHROPIC_API_KEY for Hub Node-side callers (H1 streaming
 * endpoint, future routes).
 *
 * Strategy: process.env first; else parse /home/trevor/trevor/.env at
 * module-load time and cache. Mirrors F2's Python `env_anthropic_key()`
 * (query_journal_narrative.py:38) — same parse rules, same fallback.
 *
 * Why this exists: trevor-dashboard.service loads only
 * EnvironmentFile=/home/trevor/trevor-dashboard/.env.local. The shared
 * ANTHROPIC_API_KEY lives in /home/trevor/trevor/.env, which the Hub
 * process never sees via env. Rather than duplicate the secret into
 * .env.local (drift risk) or daemon-reload the unit (out of H1 scope),
 * we read it from the canonical file once on first call.
 */
import { readFileSync } from "fs";

const KEY_NAME = "ANTHROPIC_API_KEY";
const TREVOR_ENV_PATH = "/home/trevor/trevor/.env";

let cached: string | null | undefined; // undefined = not yet resolved

function parseEnvFile(path: string, key: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(`${key}=`)) continue;
    let val = trimmed.slice(key.length + 1).trim();
    // Strip a surrounding pair of single or double quotes (matches F2's
    // Python parser; bare values pass through unchanged).
    if (val.length >= 2) {
      const first = val[0];
      const last = val[val.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        val = val.slice(1, -1);
      }
    }
    return val || null;
  }
  return null;
}

export function getAnthropicKey(): string | null {
  if (cached !== undefined) return cached;
  const fromEnv = process.env[KEY_NAME];
  if (fromEnv && fromEnv.trim().length > 0) {
    cached = fromEnv;
    return cached;
  }
  cached = parseEnvFile(TREVOR_ENV_PATH, KEY_NAME);
  return cached;
}

/**
 * Test hook — clears the module-level cache. Production code never
 * needs this; included so unit tests can re-read .env mid-suite without
 * a process restart. NOT part of the public contract.
 */
export function _resetAnthropicKeyCacheForTests(): void {
  cached = undefined;
}
