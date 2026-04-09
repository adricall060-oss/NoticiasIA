import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserAlcance, getUserDepartamentos } from "@/lib/departamentos";
import { db } from "@/lib/db";
import { resolveSessionContext } from "@/lib/session-context";
import type { RowDataPacket } from "mysql2/promise";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let empresa_nombre: string | null = null;
  let id_cliente: number | null = null;
  let role: "admin" | "member" = "member";
  let departamentos: Array<{ id_departamento: number; nombre: string }> = [];
  let departamento_nombre: string | null = null;
  let tipo_usuario: string | null = null;
  let alcance: "DEPARTAMENTOS_ASIGNADOS" | "TENANT_COMPLETO" = "DEPARTAMENTOS_ASIGNADOS";

  try {
    const context = await resolveSessionContext(session);
    id_cliente = context.id_cliente;
    role = context.role;
  } catch {
    id_cliente = null;
    role = "member";
  }

  try {
    const cli = await getClienteByCodigo(session.codigo_cliente);
    empresa_nombre = cli.nombre || null;
    alcance = await getUserAlcance(db, session.uid, cli.id_cliente);

    const [userRows] = await db.query<RowDataPacket[]>(
      `SELECT tipo_usuario
       FROM us_usuario
       WHERE id_usuario = ?
         AND fg_activo = 1
       LIMIT 1`,
      [session.uid]
    );

    const tipoRaw = String(userRows[0]?.tipo_usuario ?? "")
      .trim()
      .toUpperCase();
    tipo_usuario = tipoRaw || null;

    departamentos = await getUserDepartamentos(db, session.uid, cli.id_cliente);
    departamento_nombre = departamentos[0]?.nombre ?? null;
  } catch {
    empresa_nombre = null;
    departamentos = [];
    departamento_nombre = null;
    tipo_usuario = null;
    alcance = "DEPARTAMENTOS_ASIGNADOS";
  }

  return NextResponse.json({
    ok: true,
    data: {
      email: session.email,
      dni: session.dni,
      codigo_cliente: session.codigo_cliente,
      id_cliente,
      role,
      tipo_usuario,
      alcance,
      empresa_nombre,
      nombre: session.nombre,
      apellidos: session.apellidos,
      displayName: session.displayName,
      departamento_nombre,
      departamentos,
    },
  });
}
