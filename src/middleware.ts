import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/session-token";

const SESSION_COOKIE = "trevor_session";

// QUAL-06 (2026-06-03): externalized the VM IP for the direct-IP→domain redirect.
// Override via the HUB_VM_IP env var; defaults to the current VM IP so the
// redirect keeps working unchanged if the var is unset. A VM IP change is now a
// config flip, not a code edit.
// B7 (2026-06-26): default repointed old box 34.28.231.36 (terminated) → new box
// trevor-prime-2 34.122.2.61; .env.local HUB_VM_IP now also set to match.
const HUB_VM_IP = process.env.HUB_VM_IP || "34.122.2.61";

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

// ─────────────────────────────────────────────────────────────────────────────
// hasMalformedEscape — the router-boundary half of B4's decode guard. [C2, 2026-08-01]
//
// 🚨 THE DEFECT THIS CLOSES IS NOT IN ANY HANDLER. B4 fixed the handler-level
// decode (`api-helpers.safeDecodeSegment`, six call sites) and that closed `%25`,
// which is a VALID escape decoding to a bare `%`. It could not close `%2`, `%zz`,
// `%%` or `%C3%28` — those are STRUCTURALLY INVALID escapes, and Next's own
// router throws while decoding the segment BEFORE any handler exists to guard.
// Measured before this fix: all four returned 500 on every dynamic route,
// including `/api/memory/brain/%2`, a route containing zero decodeURIComponent
// calls. A malformed escape is a CLIENT error and must not be indistinguishable
// from a genuine server failure.
//
// ✅ MIDDLEWARE IS UPSTREAM OF THE THROW — VERIFIED, NOT ASSUMED. An
// unauthenticated `/api/health/digests/%2` returns 401, not 500: middleware ran
// to completion on the malformed path and its response short-circuited routing.
// And `nextUrl.pathname` still carries the RAW escapes here — proven with
// `/%64ashboard` (%64='d') NOT matching the exact-match `/dashboard` legacy key,
// and `/%6Cogin` NOT hitting the `/login` allowlist. A decoded pathname would
// have matched both.
//
// THE DETECTOR IS B4's PREDICATE, NOT A SECOND STYLE. "Malformed" means exactly
// what `safeDecodeSegment` means by it: `decodeURIComponent` throws. Only the
// disposition differs — B4 passes the value through so a handler can reject it;
// here there IS no handler to reach, so we reject. Deliberately NOT a regex: an
// RFC-3986 pattern would be a SECOND definition of malformed, free to drift from
// what the router actually chokes on.
//
// ⚠️ IT CANNOT LITERALLY IMPORT `safeDecodeSegment`. `api-helpers.ts` imports
// `child_process` and `path` at module top level; middleware runs in the Edge
// runtime. Do NOT "DRY this up" by importing from api-helpers — it drags Node
// builtins into the middleware bundle. The shared thing here is the predicate,
// and it is one line.
// ─────────────────────────────────────────────────────────────────────────────
function hasMalformedEscape(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return false;
  } catch {
    return true;
  }
}

export async function middleware(request: NextRequest) {
  // Redirect direct IP access to domain
  const host = request.headers.get("host") || "";
  if (host.startsWith(HUB_VM_IP)) {
    const url = request.nextUrl.clone();
    url.host = "trevor-prime.com";
    url.port = "";
    url.protocol = "https";
    return NextResponse.redirect(url, 301);
  }

  const { pathname } = request.nextUrl;

  // B1 (HEALTH consolidation, 2026-06-20) — the duplicate MEMORY "System Health"
  // sub-tab was removed; the bottom-nav HEALTH tab (/health) is the single home.
  // Query-aware redirect so old `/memory?tab=health` bookmarks land on /health
  // instead of silently falling through to the MEMORY default (BrainSection).
  // next.config.ts / the legacyMap below match on path only, never query — so the
  // tab check has to live here. Fires whether authed or not; /health then
  // auth-gates normally. The query string is dropped on the hop.
  if (
    pathname === "/memory" &&
    request.nextUrl.searchParams.get("tab") === "health"
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/health";
    url.search = "";
    return NextResponse.redirect(url, 308);
  }

  // B1 — legacy nav-redesign redirects.
  // Old route names map to new canonical paths; redirects fire whether the
  // session is authed or not (the new path is then auth-gated normally).
  // Each entry is a single 308 hop — no chaining. The /stocks zone was removed
  // (Stock+DCA removal, 2026-06-19); its three legacy paths now land on the new
  // default zone /autotrader so old bookmarks don't 404.
  const legacyMap: Record<string, string> = {
    "/trading": "/autotrader",
    "/scalp": "/autotrader",
    "/manual": "/autotrader", // was /stocks — zone removed (Stock+DCA removal)
    "/command": "/memory",
    "/intelligence": "/intel",
    "/dashboard": "/autotrader", // Wave B1 — HOME/dashboard page retired
  };
  const legacyTarget = legacyMap[pathname];
  if (legacyTarget) {
    const url = request.nextUrl.clone();
    url.pathname = legacyTarget;
    return NextResponse.redirect(url, 308);
  }

  // Always allow: login page, auth API, the liveness probe, static assets.
  // NB: the liveness allowlist is an EXACT match on "/api/health" (the REL-06
  // watchdog probe), NOT a prefix — so data sub-routes like
  // /api/health/ai-findings* are auth-gated like every other /api/* route
  // (they carry recon/cost data that must not be public on trevor-prime.com).
  // B4: the cost-refresh WORKER is hit by trevor-cost-refresh.timer's curl, which
  // carries no session cookie. It is exempt from session auth HERE but guards
  // ITSELF with a Bearer GATEWAY_TOKEN check inside the route (fails closed).
  // EXACT match — only the refresh POST is exempt; the cost READ route
  // (/api/cost) stays session-gated like every other data route.
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname === "/api/cost/refresh" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Check for session cookie
  const token = request.cookies.get(SESSION_COOKIE)?.value || "";
  if (!token) {
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Verify the HMAC-signed token (signature + expiry); no network fetch needed.
  if (await verifyToken(token)) {
    // C2 (2026-08-01) — reject a malformed percent-escape before the router
    // decodes it. See hasMalformedEscape above for why this belongs here.
    //
    // 🚨 THE THREE NARROWINGS ARE DELIBERATE. Middleware is a global
    // interceptor, so this is bounded as tightly as the defect allows:
    //
    //   1. PATH ONLY, NEVER THE QUERY. Measured: a malformed escape in the
    //      query does NOT throw (`…/2026-08-01?x=%2` → 200,
    //      `/health?tab=activity&x=%zz` → 200). Guarding the query closes zero
    //      defect and would put the login `?from=` flow at risk.
    //   2. `/api/*` ONLY. All ten dynamic segments live under src/app/api/;
    //      there are ZERO dynamic page routes. Page paths already 404 honestly
    //      (`/no-such-page-%2` → 404, `/memory/%2` → 404) and stay untouched.
    //   3. AFTER verifyToken. This sits downstream of the direct-IP 301, all
    //      seven legacy redirects, the whole allowlist (/login, /api/auth,
    //      the exact-match /api/health liveness probe, the bearer-token
    //      /api/cost/refresh worker, /_next/*) and BOTH auth-failure paths —
    //      every one of them is structurally unreachable from here. An
    //      unauthenticated malformed request still 401s exactly as before.
    //
    // 🚨 ACCEPTED, DELIBERATE BEHAVIOUR CHANGE — DO NOT "FIX" THIS BACK.
    // `/api/no-such-route-%2` returns 400 here, where it used to return 404.
    // Middleware cannot know whether a path resolves to a route without
    // duplicating the route table, and that duplication would be a far worse
    // trade than the one it buys. A URI carrying a syntactically invalid escape
    // cannot be canonically resolved AT ALL, so 400 reports the EARLIER of two
    // errors rather than swallowing the later one — fixing the escape still
    // yields a 404, so no information is lost, only ordered correctly.
    // Ghost accepted this explicitly at the C2 gate and amended the gate to
    // match. Reverting it to chase a 404 re-opens the 500s.
    //
    // malformed ≠ absent ≠ not-found, and all three stay distinct:
    //   malformed  → 400 here (decodeURIComponent throws)
    //   absent     → untouched; an empty segment decodes fine
    //                (`/api/health/digests/` → 308, `/api/health/digests` → 200)
    //   not-found  → untouched for any VALID escape; `%20` and `%25` decode
    //                cleanly, so `/api/intel/downloads/a%20b.md` still 404s and
    //                B4's `%25` → 400 still comes from the handler's shape check.
    if (isApiRoute(pathname) && hasMalformedEscape(pathname)) {
      return NextResponse.json(
        { error: "malformed percent-escape in path" },
        { status: 400 },
      );
    }
    return NextResponse.next();
  }

  // Token invalid
  if (isApiRoute(pathname)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
