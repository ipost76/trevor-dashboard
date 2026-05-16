import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "trevor_session";
const SESSION_SALT = "trevor-mc-2025";

function validateTokenLocally(token: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(":");
    // Token format: user:pass:salt — valid if salt matches
    return parts.length === 3 && parts[2] === SESSION_SALT;
  } catch {
    return false;
  }
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function middleware(request: NextRequest) {
  // Redirect direct IP access to domain
  const host = request.headers.get("host") || "";
  if (host.startsWith("34.28.231.36")) {
    const url = request.nextUrl.clone();
    url.host = "trevor-prime.com";
    url.port = "";
    url.protocol = "https";
    return NextResponse.redirect(url, 301);
  }

  const { pathname } = request.nextUrl;

  // B1 — legacy nav-redesign redirects.
  // Old route names map to new canonical paths; redirects fire whether the
  // session is authed or not (the new path is then auth-gated normally).
  const legacyMap: Record<string, string> = {
    "/trading": "/manual",
    "/scalp": "/manual",
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

  // Always allow: login page, auth API, static assets
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
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

  // Validate token locally (no network fetch needed)
  if (validateTokenLocally(token)) {
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
