import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import { createToken } from "@/lib/auth";
import { getRequestIp, verifyTurnstileToken } from "@/lib/turnstile";

type UserRow = RowDataPacket & {
  id_usuario: number;
  email: string;
  password_hash: string;
  dni: string;
  nombre: string | null;
  apellidos: string | null;
  codigo_cliente: string | null;
};

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Solicitud invalida" }, { status: 400 });
  }

  const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

  const em = String(payload.email ?? "").trim().toLowerCase();
  const pw = String(payload.password ?? "");
  const turnstileToken = String(payload.turnstileToken ?? "").trim();

  if (!em || !pw || !turnstileToken) {
    return NextResponse.json({ error: "Credenciales invalidas" }, { status: 401 });
  }

  const isHuman = await verifyTurnstileToken(turnstileToken, getRequestIp(req));
  if (!isHuman) {
    return NextResponse.json({ error: "Verificacion anti-bot no valida" }, { status: 400 });
  }

  const [rows] = await db.query<UserRow[]>(
    `SELECT
       u.id_usuario,
       u.email,
       u.password_hash,
       u.dni,
       u.nombre,
       u.apellidos,
       c.codigo AS codigo_cliente
     FROM us_usuario u
     LEFT JOIN or_cliente c ON c.id_cliente = u.id_cliente
     WHERE u.email = ? AND u.fg_activo = 1
     LIMIT 1`,
    [em]
  );

  if (!rows.length) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(pw, user.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  if (!user.codigo_cliente) {
    return NextResponse.json({ error: "Usuario sin cliente válido" }, { status: 403 });
  }

  await db.query("UPDATE us_usuario SET fe_ultimo_acceso = NOW() WHERE id_usuario = ?", [
    Number(user.id_usuario),
  ]);

  const displayName = `${user.nombre ?? ""} ${user.apellidos ?? ""}`.trim() || null;

  const token = await createToken({
    uid: Number(user.id_usuario),
    codigo_cliente: String(user.codigo_cliente),
    email: String(user.email),
    dni: String(user.dni),
    nombre: user.nombre ?? null,
    apellidos: user.apellidos ?? null,
    displayName,
  });

  const cookieName = process.env.AUTH_COOKIE_NAME ?? "iacc_session";
  const res = NextResponse.json({ ok: true });

  res.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}
