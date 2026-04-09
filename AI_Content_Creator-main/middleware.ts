import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const token = req.cookies.get("iacc_session")?.value; // mismo nombre que AUTH_COOKIE_NAME
  const { pathname } = req.nextUrl;

  if ((pathname.startsWith("/home") || pathname.startsWith("/noticias")) && !token) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/home/:path*", "/noticias/:path*"],
};