import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";

const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map((v) => Number(v));
  if (parts.length !== 4 || parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local")) return true;
  if (isPrivateIpv4(host)) return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  return false;
}

export async function GET(req: Request) {
  try {
    await requireSession();

    const { searchParams } = new URL(req.url);
    const rawUrl = String(searchParams.get("url") ?? "").trim();
    if (!rawUrl) {
      return NextResponse.json({ error: "URL obligatoria" }, { status: 400 });
    }

    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      return NextResponse.json({ error: "URL invalida" }, { status: 400 });
    }

    if (!["http:", "https:"].includes(target.protocol)) {
      return NextResponse.json({ error: "Protocolo no permitido" }, { status: 400 });
    }

    if (isBlockedHost(target.hostname)) {
      return NextResponse.json({ error: "Host no permitido" }, { status: 403 });
    }

    const upstream = await fetch(target.toString(), {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!upstream.ok) {
      return NextResponse.json({ error: "No se pudo descargar la imagen remota" }, { status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "La URL no apunta a una imagen" }, { status: 415 });
    }

    const body = await upstream.arrayBuffer();
    if (body.byteLength > 12_000_000) {
      return NextResponse.json({ error: "La imagen remota supera 12MB" }, { status: 413 });
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    console.error("image-proxy error:", error);
    return NextResponse.json({ error: "Error cargando imagen" }, { status: 500 });
  }
}
