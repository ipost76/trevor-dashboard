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

    if (!pass) {
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

    if (currentPassword !== pass) {
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json(
        { ok: false, error: "Current password is incorrect" },
        { status: 401 }
      );
    }

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json(
        { ok: false, error: "New password must be at least 6 characters" },
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
        return NextResponse.json(
          { ok: false, error: "Could not find .env.local to update password" },
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
      return NextResponse.json(
        { ok: false, error: `Failed to write password: ${String(err)}` },
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
