// HMAC-SHA256 signed, expiring session token. Edge-safe: uses only Web Crypto
// (crypto.subtle) + Buffer base64url — both work in the Next Edge middleware
// runtime AND the Node API-route runtime, so this single module is the SOLE
// encode/decode authority (middleware + /api/auth both import it → no drift).
//
// Token shape:  base64url(JSON({u,iat,exp})) + "." + base64url(HMAC_SHA256(salt, payloadPart))
// W-D-P1 (2026-06-07): replaces the legacy reversible `user:pass:salt` token.
// The password is NOT embedded — the HMAC signature proves the server issued the
// token; the password is checked at login before signing. Forgery now requires
// the high-entropy SESSION_SALT (the HMAC key), and tokens carry a server-verifiable exp.

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = { u: string; iat: number; exp: number };

// Fail-closed: a missing/short SESSION_SALT means we refuse to sign OR verify —
// never fall back to a default. (<16 chars also rejects the dead 14-char legacy salt.)
function getSalt(): string {
  const salt = process.env.SESSION_SALT;
  if (!salt || salt.length < 16) {
    throw new Error("SESSION_SALT unset or too short — refusing to issue/verify tokens");
  }
  return salt;
}

async function hmacB64url(salt: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Buffer.from(new Uint8Array(sig)).toString("base64url");
}

// Constant-time compare (both inputs are fixed-length base64url HMACs).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Issue a signed token for `user`. Throws (fail-closed) if SESSION_SALT is unset/short.
export async function signToken(user: string): Promise<string> {
  const salt = getSalt();
  const iat = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { u: user, iat, exp: iat + SESSION_MAX_AGE_SEC };
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = await hmacB64url(salt, payloadPart);
  return `${payloadPart}.${sig}`;
}

// Returns the payload on a valid, unexpired, correctly-signed token; null otherwise.
// Any error (bad format, bad signature, expired, unset salt) → null → caller treats
// the request as unauthenticated (fail-closed). The payload is parsed only AFTER the
// HMAC verifies, so it is server-signed and trusted.
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const salt = getSalt();
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) return null;
    const payloadPart = token.slice(0, dot);
    const sigPart = token.slice(dot + 1);
    const expected = await hmacB64url(salt, payloadPart);
    if (!timingSafeEqual(sigPart, expected)) return null;
    const payload = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf-8")
    ) as SessionPayload;
    if (
      typeof payload.u !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE = SESSION_MAX_AGE_SEC;
