import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { signToken, verifyToken, SESSION_MAX_AGE } from "@/lib/session-token";

export const dynamic = "force-dynamic";

const SESSION_COOKIE = "trevor_session";

function getCredentials(): { user: string; pass: string } {
  // Read .env.local directly so password changes are picked up immediately
  try {
    const envPath = join(process.cwd(), ".env.local");
    const content = readFileSync(envPath, "utf-8");
    const userMatch = content.match(/^DASHBOARD_USER=(.+)$/m);
    const passMatch = content.match(/^DASHBOARD_PASS=(.+)$/m);
    return {
      user: userMatch ? userMatch[1].trim() : process.env.DASHBOARD_USER || "trevor",
      pass: passMatch ? passMatch[1].trim() : process.env.DASHBOARD_PASS || "",
    };
  } catch {
    return {
      user: process.env.DASHBOARD_USER || "trevor",
      pass: process.env.DASHBOARD_PASS || "",
    };
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = (body.action as string) || "login";

  // ── LOGIN ──────────────────────────────────────────────────────────────
  if (action === "login") {
    const { username, password } = body as { username: string; password: string };
    const { user, pass } = getCredentials();

    // Fail CLOSED: if no password is configured, refuse ALL logins — never
    // auto-issue a session. H2 (2026-06-28): removes the open-door footgun for a
    // publicly-funnelled Hub — a dropped/empty DASHBOARD_PASS must lock everyone
    // OUT, not let everyone IN. (Was: auto-login on empty pass.)
    if (!pass) {
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json(
        { ok: false, error: "Login is disabled — no password configured" },
        { status: 401 }
      );
    }

    // Username compare is case-insensitive (Trevor / trevor / TREVOR all match).
    // Password compare stays exact — that's a secret, not an identifier.
    // Defensive: missing/non-string username from body would crash .toLowerCase().
    const usernameNorm = (username ?? "").toString().toLowerCase();
    const userNorm = user.toLowerCase();
    if (usernameNorm !== userNorm || password !== pass) {
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json(
        { ok: false, error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const token = await signToken(user);
    const res = NextResponse.json({ ok: true, message: "Logged in" });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    return res;
  }

  // ── LOGOUT ─────────────────────────────────────────────────────────────
  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // ── CHANGE PASSWORD ────────────────────────────────────────────────────
  if (action === "change-password") {
    const { currentPassword, newPassword } = body as {
      currentPassword: string;
      newPassword: string;
    };
    const { user, pass } = getCredentials();

    // These two were already plain English. They carry a code as well (B13) so
    // the modal can render EVERY failure through one hardened path — without
    // codes here, hardening the modal would flatten these two useful, specific
    // messages into a generic one, trading a leak for a worse defect.
    if (currentPassword !== pass) {
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json(
        { ok: false, error_code: "wrong_current_password" },
        { status: 401 }
      );
    }

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json(
        { ok: false, error_code: "new_password_too_short" },
        { status: 400 }
      );
    }

    try {
      const { readFile, writeFile } = await import("fs/promises");
      const { join } = await import("path");

      const candidates = [
        join(process.cwd(), ".env.local"),
        join(process.env.HOME || "/root", "trevor-dashboard", ".env.local"),
      ];

      let envPath = "";
      let envContent = "";
      for (const candidate of candidates) {
        try {
          envContent = await readFile(candidate, "utf-8");
          envPath = candidate;
          break;
        } catch { continue; }
      }

      if (!envPath) {
        // The candidate paths are a server-side detail; the client gets a code.
        console.error(
          "[api/auth] change-password: no .env.local found among candidates:",
          candidates,
        );
        return NextResponse.json(
          { ok: false, error_code: "config_not_found" },
          { status: 500 }
        );
      }

      const updated = envContent.replace(
        /^DASHBOARD_PASS=.*$/m,
        `DASHBOARD_PASS=${newPassword}`
      );
      await writeFile(envPath, updated, "utf-8");

      process.env.DASHBOARD_PASS = newPassword;

      const newToken = await signToken(user);
      const res = NextResponse.json({
        ok: true,
        message: "Password updated. You will be logged in with the new password.",
      });
      res.cookies.set(SESSION_COOKIE, newToken, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: SESSION_MAX_AGE,
        path: "/",
      });
      return res;
    } catch (err) {
      // 🚨 B13 — this used to return `Failed to write password: ${String(err)}`,
      // i.e. `EACCES: permission denied, open '/home/ghost/…/.env.local'`, to the
      // CLIENT. The absolute path is an information disclosure on a
      // Funnel-exposed surface. The raw error stays here, in the server log, at
      // full fidelity; the client gets a code the modal glosses.
      console.error("[api/auth] change-password: write failed:", err);
      return NextResponse.json(
        { ok: false, error_code: "write_failed" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(request: NextRequest) {
  // Accept token from cookie OR query param (middleware uses query param)
  const token =
    request.nextUrl.searchParams.get("token") ||
    request.cookies.get(SESSION_COOKIE)?.value ||
    "";
  const valid = (await verifyToken(token)) !== null;
  return NextResponse.json({ authenticated: valid });
}
