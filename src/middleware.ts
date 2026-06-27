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
