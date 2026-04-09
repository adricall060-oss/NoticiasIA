import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";

const MAX_UPLOAD_BYTES = 5_000_000;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function parseImageDataUrl(input: string) {
  const value = String(input ?? "").trim();
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase();
  const ext = MIME_TO_EXT[mime];
  if (!ext) return null;

  const base64 = match[2].replace(/\s+/g, "");
  if (!base64) return null;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return null;
  }

  if (!buffer.length) return null;
  return { buffer, ext };
}

export async function POST(req: Request) {
  try {
    await requireSession();

    const body = await req.json().catch(() => ({}));
    const parsed = parseImageDataUrl(String(body?.data_url ?? ""));
    if (!parsed) {
      return NextResponse.json({ error: "Formato de imagen invalido" }, { status: 400 });
    }

    if (parsed.buffer.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "La imagen supera 5MB" }, { status: 413 });
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads", "news");
    await mkdir(uploadsDir, { recursive: true });

    const fileName = `${Date.now()}-${randomUUID()}.${parsed.ext}`;
    const filePath = path.join(uploadsDir, fileName);
    await writeFile(filePath, parsed.buffer);

    return NextResponse.json({
      ok: true,
      data: {
        url: `/uploads/news/${fileName}`,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    console.error("image-upload error:", error);
    return NextResponse.json({ error: "No se pudo guardar la imagen" }, { status: 500 });
  }
}
