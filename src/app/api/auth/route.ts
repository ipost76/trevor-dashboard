import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const SESSION_COOKIE = "trevor_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getCredentials(): { user: string; pass: string } {
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

function makeSessionToken(user: string, pass: string): string {
  const salt = process.env.SESSION_SALT || "trevor-mc-2025";
  return Buffer.from(`${user}:${pass}:${salt}`).toString("base64url");
}

function validateSession(token: string): boolean {
  const { user, pass } = getCredentials();
  if (!pass) return true;
  const expected = makeSessionToken(user, pass);
  return token === expected;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = (body.action as string) || "login";

  if (action === "login") {
    const username = (body.username || body.user || "") as string;
    const password = (body.password || body.pass || "") as string;
    const { user, pass } = getCredentials();

    if (!pass) {
      const token = makeSessionToken(user, "");
      const res = NextResponse.json({ ok: true, message: "Logged in" });
      res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE, path: "/" });
      return res;
    }

    if (username !== user || password !== pass) {
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }

    const token = makeSessionToken(user, pass);
    const res = NextResponse.json({ ok: true, message: "Logged in" });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE, path: "/" });
    return res;
  }

  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (action === "change-password") {
    const currentPassword = (body.currentPassword || body.currentPass || "") as string;
    const newPassword = (body.newPassword || body.newPass || "") as string;
    const { user, pass } = getCredentials();

    if (currentPassword !== pass) {
      await new Promise((r) => setTimeout(r, 500));
      return NextResponse.json({ ok: false, error: "Current password is incorrect" }, { status: 401 });
    }

    if (!newPassword || newPassword.length < 6) {
      return NextResponse.json({ ok: false, error: "New password must be at least 6 characters" }, { status: 400 });
    }

    try {
      const { readFile, writeFile } = await import("fs/promises");
      const envPath = join(process.cwd(), ".env.local");
      const envContent = await readFile(envPath, "utf-8");
      const updated = envContent.replace(/^DASHBOARD_PASS=.*$/m, `DASHBOARD_PASS=${newPassword}`);
      await writeFile(envPath, updated, "utf-8");
      process.env.DASHBOARD_PASS = newPassword;

      const newToken = makeSessionToken(user, newPassword);
      const res = NextResponse.json({ ok: true, message: "Password updated" });
      res.cookies.set(SESSION_COOKIE, newToken, { httpOnly: true, sameSite: "lax", maxAge: SESSION_MAX_AGE, path: "/" });
      return res;
    } catch (err) {
      return NextResponse.json({ ok: false, error: `Failed: ${String(err)}` }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") || request.cookies.get(SESSION_COOKIE)?.value || "";
  const valid = validateSession(token);
  return NextResponse.json({ authenticated: valid });
}
