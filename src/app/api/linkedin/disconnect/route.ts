import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { disconnectLinkedInConnection } from "@/lib/linkedin";
import { resolveSessionContext } from "@/lib/session-context";

export async function POST() {
  try {
    const session = await requireSession();
    const context = await resolveSessionContext(session);
    if (context.role !== "admin") {
      return NextResponse.json({ error: "Solo admin puede desconectar LinkedIn." }, { status: 403 });
    }
    const disconnected = await disconnectLinkedInConnection(context.id_cliente);
    return NextResponse.json({ ok: true, disconnected });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return NextResponse.json({ error: "No se pudo desconectar LinkedIn." }, { status: 500 });
  }
}
