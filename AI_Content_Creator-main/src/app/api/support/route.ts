import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserDepartamentoAccess } from "@/lib/departamentos";

type SupportCategory =
  | "ACCESO_LOGIN"
  | "N8N"
  | "NOTICIAS"
  | "PUBLICACION"
  | "MEJORA"
  | "UX"
  | "OTRO";

type SupportPayload = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phonePrefix?: unknown;
  phone?: unknown;
  issueType?: unknown;
  message?: unknown;
  privacyAccepted?: unknown;
  departamentoId?: unknown;
};

type SupportTicketRow = RowDataPacket & {
  id_contacto: number;
  id_usuario: number | null;
  id_departamento: number | null;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string | null;
  categoria: string;
  mensaje: string;
  created_at: Date | string;
  updated_at: Date | string;
  departamento_nombre: string | null;
  usuario_nombre: string | null;
};

function cleanText(value: unknown, maxLength: number) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.slice(0, maxLength);
}

function cleanEmail(value: unknown) {
  const email = cleanText(value, 320);
  if (!email) return "";
  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  return isValid ? email : "";
}

function parseOptionalPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function mapIssueType(value: unknown): SupportCategory {
  const normalized = cleanText(value, 64).toLowerCase();
  switch (normalized) {
    case "acceso_login":
    case "soporte_login":
      return "ACCESO_LOGIN";
    case "n8n":
    case "soporte_generacion":
      return "N8N";
    case "noticias":
    case "soporte_editor":
      return "NOTICIAS";
    case "publicacion":
    case "soporte_publicacion":
      return "PUBLICACION";
    case "mejora":
    case "sugerencia_mejora":
      return "MEJORA";
    case "ux":
    case "sugerencia_ux":
      return "UX";
    default:
      return "OTRO";
  }
}

function normalizeTimestamp(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

async function validateDepartamento(
  idCliente: number,
  idUsuario: number,
  idDepartamento: number
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const [depRows] = await db.execute<RowDataPacket[]>(
    `SELECT id_departamento
     FROM or_departamento
     WHERE id_cliente = ?
       AND id_departamento = ?
       AND fg_activo = 1
     LIMIT 1`,
    [idCliente, idDepartamento]
  );

  if (!depRows.length) {
    return { ok: false, status: 400, error: "El departamento indicado no existe o no esta activo." };
  }

  const access = await getUserDepartamentoAccess(db, idUsuario, idCliente);
  if (access.alcance !== "TENANT_COMPLETO" && !access.departamentoIds.includes(idDepartamento)) {
    return { ok: false, status: 403, error: "No autorizado para usar el departamento indicado." };
  }

  return { ok: true };
}

export async function GET() {
  try {
    const session = await requireSession();
    const { id_cliente } = await getClienteByCodigo(session.codigo_cliente);
    const access = await getUserDepartamentoAccess(db, session.uid, id_cliente);

    const params: Array<number> = [id_cliente];
    let where = "WHERE c.id_cliente = ?";

    if (access.alcance !== "TENANT_COMPLETO") {
      if (access.departamentoIds.length > 0) {
        const placeholders = access.departamentoIds.map(() => "?").join(", ");
        where += ` AND (c.id_usuario = ? OR c.id_departamento IN (${placeholders}))`;
        params.push(session.uid, ...access.departamentoIds);
      } else {
        where += " AND c.id_usuario = ?";
        params.push(session.uid);
      }
    }

    const [rows] = await db.execute<SupportTicketRow[]>(
      `SELECT c.id_contacto, c.id_usuario, c.id_departamento, c.nombre, c.apellido, c.email, c.telefono,
              c.categoria, c.mensaje, c.created_at, c.updated_at,
              d.nombre AS departamento_nombre,
              CONCAT_WS(' ', u.nombre, u.apellidos) AS usuario_nombre
       FROM ay_contacto c
       LEFT JOIN or_departamento d ON d.id_departamento = c.id_departamento
       LEFT JOIN us_usuario u ON u.id_usuario = c.id_usuario
       ${where}
       ORDER BY c.created_at DESC, c.id_contacto DESC
       LIMIT 200`,
      params
    );

    const data = rows.map((row) => ({
      id_contacto: Number(row.id_contacto),
      id_usuario: row.id_usuario === null ? null : Number(row.id_usuario),
      id_departamento: row.id_departamento === null ? null : Number(row.id_departamento),
      nombre: String(row.nombre ?? ""),
      apellido: String(row.apellido ?? ""),
      email: String(row.email ?? ""),
      telefono: row.telefono ? String(row.telefono) : null,
      categoria: String(row.categoria ?? "OTRO"),
      mensaje: String(row.mensaje ?? ""),
      created_at: normalizeTimestamp(row.created_at),
      updated_at: normalizeTimestamp(row.updated_at),
      departamento_nombre: row.departamento_nombre ? String(row.departamento_nombre) : null,
      usuario_nombre: row.usuario_nombre ? String(row.usuario_nombre) : null,
    }));

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
      return NextResponse.json({ error: "Falta la tabla ay_contacto en base de datos." }, { status: 400 });
    }
    console.error("GET /api/support failed:", e);
    return NextResponse.json({ error: "No se pudo consultar incidencias" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    const { id_cliente } = await getClienteByCodigo(session.codigo_cliente);
    const body = (await req.json()) as SupportPayload;

    const firstName = cleanText(body.firstName, 120);
    const lastName = cleanText(body.lastName, 180);
    const email = cleanEmail(body.email);
    const prefix = cleanText(body.phonePrefix, 6);
    const phone = cleanText(body.phone, 30);
    const issueType = mapIssueType(body.issueType);
    const message = cleanText(body.message, 12000);
    const privacyAccepted = body.privacyAccepted === true;

    const telefono = [prefix, phone].filter(Boolean).join(" ").slice(0, 30) || null;
    const idDepartamento = parseOptionalPositiveInt(body.departamentoId);

    if (!firstName || !lastName || !email || !message) {
      return NextResponse.json(
        { error: "Nombre, apellido, email y mensaje son obligatorios." },
        { status: 400 }
      );
    }

    if (!privacyAccepted) {
      return NextResponse.json({ error: "Debes aceptar la politica de privacidad." }, { status: 400 });
    }

    if (idDepartamento !== null) {
      const validation = await validateDepartamento(id_cliente, session.uid, idDepartamento);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: validation.status });
      }
    }

    const [result] = await db.execute<ResultSetHeader>(
      `INSERT INTO ay_contacto
        (id_cliente, id_usuario, id_departamento, nombre, apellido, email, telefono, categoria, mensaje)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id_cliente,
        session.uid,
        idDepartamento,
        firstName,
        lastName,
        email,
        telefono,
        issueType,
        message,
      ]
    );

    return NextResponse.json({ ok: true, id: Number(result.insertId) });
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
      return NextResponse.json({ error: "Falta la tabla ay_contacto en base de datos." }, { status: 400 });
    }
    console.error("POST /api/support failed:", e);
    return NextResponse.json({ error: "No se pudo crear la incidencia" }, { status: 500 });
  }
}
