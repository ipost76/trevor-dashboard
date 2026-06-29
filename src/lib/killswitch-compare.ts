import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time password compare for the killswitch gate (KILLSWITCH-TIMING-SAFE).
 *
 * Pure — both values passed in, no .env read — so it is unit-testable at the
 * function level (the killswitch route imports THIS exact function, so a test
 * of it can't drift from the deployed code) without POSTing the live route.
 *
 * Fails CLOSED:
 *  - empty submitted OR empty stored → false. Never authorize on an empty
 *    configured pass: timingSafeEqual(<empty>, <empty>) would otherwise return
 *    true (a fail-OPEN footgun).
 *  - length mismatch → false, returned BEFORE timingSafeEqual (which THROWS on
 *    differing buffer lengths), so a length difference can never throw / 500.
 *
 * Equal non-empty buffer lengths → timingSafeEqual byte compare (no early-exit
 * timing side-channel — this is the whole point of the swap from plain `===`).
 */
export function passwordsMatch(submitted: string, stored: string): boolean {
  if (submitted.length === 0 || stored.length === 0) return false;
  const a = Buffer.from(submitted, "utf8");
  const b = Buffer.from(stored, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
