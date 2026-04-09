import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
//import { createToken} from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json();

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const dni = String(body.dni ?? "").trim();
  const nombre = String(body.nombre ?? "").trim();
  const apellidos = String(body.apellidos ?? "").trim();
  const codigo_cliente = String(body.codigo_cliente ?? "").trim();

  if (!email || !password || !dni || !nombre || !apellidos || !codigo_cliente) {
    return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [cliRows] = await conn.query<any[]>(
      `SELECT id_cliente
       FROM or_cliente
       WHERE codigo = ? AND fg_activo = 1
       LIMIT 1`,
      [codigo_cliente]
    );
    const empresaExiste = cliRows.length > 0;

    if (!empresaExiste) {
      await conn.rollback();
      return NextResponse.json({ error: "Código de empresa inválido" }, { status: 404 });
    }

    const id_cliente = Number(cliRows[0].id_cliente);
    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await conn.query<any>(
      `INSERT INTO us_usuario (id_cliente, email, password_hash, dni, nombre, apellidos, tipo_usuario, fg_activo)
       VALUES (?, ?, ?, ?, ?, ?, 'TENANT', 1)`,
      [id_cliente, email, password_hash, dni, nombre, apellidos]
    );

    const uid = Number(result.insertId);
    await conn.commit();

const displayName = `${nombre} ${apellidos}`.trim() || null;

/*
const token = await createToken({
  uid,
  codigo_cliente,
  email,
  dni,
  nombre,
  apellidos,
  displayName,
});
*/

//const cookieName = process.env.AUTH_COOKIE_NAME ?? "iacc_session";

const res = NextResponse.json({ ok: true });

/*
res.cookies.set(cookieName, token, {
  httpOnly: true,
  sameSite: "lax",
  secure: false, 
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
});
*/

return res;

  } catch (e: any) {
    await conn.rollback();
    if (String(e?.code) === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "Email ya registrado" }, { status: 409 });
    }
    return NextResponse.json({ error: "Error en registro" }, { status: 500 });
  } finally {
    conn.release();
  }
}