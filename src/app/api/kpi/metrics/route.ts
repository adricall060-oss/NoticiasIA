import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { requireSession } from "@/lib/auth";
import { resolveSessionContext } from "@/lib/session-context";
import { db } from "@/lib/db";

type MetricCodeRow = RowDataPacket & {
  codigo: string | null;
};

export async function GET() {
  try {
    const session = await requireSession();
    const context = await resolveSessionContext(session);
    if (context.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const [rows] = await db.execute<MetricCodeRow[]>(
      `SELECT codigo
       FROM TP_METRICA
       ORDER BY codigo ASC`
    );

    const data = rows
      .map((row) => String(row.codigo ?? "").trim().toUpperCase())
      .filter((codigo) => codigo.length > 0);

    return NextResponse.json({ ok: true, data });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "ER_NO_SUCH_TABLE"
    ) {
      return NextResponse.json({ error: "Falta la tabla TP_METRICA en base de datos." }, { status: 400 });
    }
    console.error("GET /api/kpi/metrics failed:", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
