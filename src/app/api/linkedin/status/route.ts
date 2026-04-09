import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getLinkedInConnectionStatus } from "@/lib/linkedin";
import { resolveSessionContext } from "@/lib/session-context";

export async function GET() {
  try {
    const session = await requireSession();
    const context = await resolveSessionContext(session);
    if (context.role !== "admin") {
      return NextResponse.json({ error: "Solo admin puede ver estado de LinkedIn." }, { status: 403 });
    }
    const status = await getLinkedInConnectionStatus(context.id_cliente);
    return NextResponse.json({ ok: true, data: status });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    return NextResponse.json({ error: "No se pudo leer estado de LinkedIn." }, { status: 500 });
  }
}
