import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { buildLinkedInAuthUrl } from "@/lib/linkedin";
import { resolveSessionContext } from "@/lib/session-context";

const STATE_COOKIE = "li_oauth_state";
const NEXT_COOKIE = "li_oauth_next";

function sanitizeNextPath(value: string | null) {
  const v = String(value ?? "").trim();
  if (!v.startsWith("/")) return "/canales";
  return v.slice(0, 200);
}

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const context = await resolveSessionContext(session);
    if (context.role !== "admin") {
      return NextResponse.json({ error: "Solo admin puede conectar LinkedIn." }, { status: 403 });
    }

    const url = new URL(req.url);
    const state = randomUUID();
    const redirectUri =
      process.env.LINKEDIN_REDIRECT_URI?.trim() || `${url.origin}/api/linkedin/callback`;
    const nextPath = sanitizeNextPath(url.searchParams.get("next"));
    const linkedInUrl = buildLinkedInAuthUrl({
      redirectUri,
      state,
    });

    const res = NextResponse.redirect(linkedInUrl);
    res.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    res.cookies.set(NEXT_COOKIE, nextPath, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return res;
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const message = e instanceof Error ? e.message : "No se pudo iniciar OAuth con LinkedIn.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
