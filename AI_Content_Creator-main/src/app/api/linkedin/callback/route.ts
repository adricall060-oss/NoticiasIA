import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { exchangeLinkedInCodeForToken, saveLinkedInOAuthConnection } from "@/lib/linkedin";
import { resolveSessionContext } from "@/lib/session-context";

const STATE_COOKIE = "li_oauth_state";
const NEXT_COOKIE = "li_oauth_next";

function sanitizeNextPath(value: string | undefined) {
  if (!value) return "/canales";
  const v = value.trim();
  if (!v.startsWith("/")) return "/canales";
  return v.slice(0, 200);
}

function buildRedirectUrl(origin: string, path: string, status: "ok" | "error", msg?: string) {
  const target = new URL(path, origin);
  target.searchParams.set("li", status);
  if (msg) {
    target.searchParams.set("li_msg", msg.slice(0, 200));
  }
  return target;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const store = await cookies();
  const nextPath = sanitizeNextPath(store.get(NEXT_COOKIE)?.value);
  const clearCookies = (res: NextResponse) => {
    res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(NEXT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  try {
    const session = await requireSession();
    const context = await resolveSessionContext(session);
    if (context.role !== "admin") {
      return NextResponse.json({ error: "Solo admin puede conectar LinkedIn." }, { status: 403 });
    }

    const expectedState = store.get(STATE_COOKIE)?.value ?? "";
    const code = String(url.searchParams.get("code") ?? "").trim();
    const state = String(url.searchParams.get("state") ?? "").trim();
    const oauthError = String(url.searchParams.get("error") ?? "").trim();
    const oauthErrorDescription = String(url.searchParams.get("error_description") ?? "").trim();

    if (oauthError) {
      const redirect = buildRedirectUrl(
        url.origin,
        nextPath,
        "error",
        oauthErrorDescription || oauthError
      );
      return clearCookies(NextResponse.redirect(redirect));
    }

    if (!expectedState || !state || state !== expectedState) {
      const redirect = buildRedirectUrl(url.origin, nextPath, "error", "State OAuth invalido");
      return clearCookies(NextResponse.redirect(redirect));
    }

    if (!code) {
      const redirect = buildRedirectUrl(url.origin, nextPath, "error", "No llego codigo OAuth");
      return clearCookies(NextResponse.redirect(redirect));
    }

    const redirectUri =
      process.env.LINKEDIN_REDIRECT_URI?.trim() || `${url.origin}/api/linkedin/callback`;
    const token = await exchangeLinkedInCodeForToken({
      code,
      redirectUri,
    });

    await saveLinkedInOAuthConnection({
      idCliente: context.id_cliente,
      idUsuarioConectado: session.uid,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt,
      scopes: token.scopes,
    });

    const redirect = buildRedirectUrl(url.origin, nextPath, "ok");
    return clearCookies(NextResponse.redirect(redirect));
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const message = e instanceof Error ? e.message : "No se pudo completar conexión LinkedIn.";
    const redirect = buildRedirectUrl(url.origin, nextPath, "error", message);
    return clearCookies(NextResponse.redirect(redirect));
  }
}
