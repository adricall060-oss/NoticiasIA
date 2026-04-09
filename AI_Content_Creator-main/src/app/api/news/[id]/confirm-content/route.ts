import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserDepartamentoAccess } from "@/lib/departamentos";
import { ensureEstadoNoticia } from "@/lib/estados-noticia";
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const conn: PoolConnection = await db.getConnection();

  try {
    const s = await requireSession();
    const { id_cliente } = await getClienteByCodigo(s.codigo_cliente);

    const { id } = await params;
    const newsId = Number(id);
    if (!Number.isFinite(newsId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const titulo = String(body.titulo_confirmado ?? body.titulo ?? "").trim();
    const cuerpo = String(body.cuerpo_confirmado ?? body.cuerpo ?? "").trim();

    if (!titulo || !cuerpo) {
      return NextResponse.json({ error: "Título y cuerpo son obligatorios" }, { status: 400 });
    }

    const access = await getUserDepartamentoAccess(conn, s.uid, id_cliente);
    const depIds = access.departamentoIds;
    if (access.alcance === "DEPARTAMENTOS_ASIGNADOS" && !depIds.length) {
      return NextResponse.json({ error: "Sin departamentos" }, { status: 403 });
    }

    const whereDepartamento =
      access.alcance === "TENANT_COMPLETO"
        ? ""
        : `
         AND g.id_departamento IN (${depIds.map(() => "?").join(",")})`;

    const newsQueryParams: number[] = [id_cliente, newsId];
    if (access.alcance !== "TENANT_COMPLETO") {
      newsQueryParams.push(...depIds);
    }

    await conn.beginTransaction();

    const [newsRows] = await conn.query<RowDataPacket[]>(
      `SELECT e.codigo AS estado_codigo
       FROM no_noticia n
       JOIN gr_grupo g
         ON g.id_grupo = n.id_grupo
        AND g.id_cliente = n.id_cliente
       LEFT JOIN tp_estados_noticia e
         ON e.id_estado = n.id_estado
       WHERE n.id_cliente = ?
         AND n.id_noticia = ?
         AND n.fg_activo = 1
         AND g.fg_activo = 1
         ${whereDepartamento}
       LIMIT 1`,
      newsQueryParams
    );

    if (!newsRows.length) {
      await conn.rollback();
      return NextResponse.json({ error: "Noticia no encontrada" }, { status: 404 });
    }

    const estado = String((newsRows[0] as any).estado_codigo ?? "PENDIENTE").toUpperCase();
    if (estado === "PUBLICADO") {
      await conn.rollback();
      return NextResponse.json({ error: "Retira la noticia antes de volver a revisarla" }, { status: 409 });
    }

    const [draft] = await conn.query<RowDataPacket[]>(
      `SELECT id_version_noticia
       FROM no_version_noticia
       WHERE id_cliente = ? AND id_noticia = ? AND num_version = 0
       LIMIT 1`,
      [id_cliente, newsId]
    );

    if (draft.length) {
      await conn.query(
        `UPDATE no_version_noticia
         SET titulo = ?, cuerpo = ?, id_usuario = ?, fe_version = NOW()
         WHERE id_cliente = ? AND id_noticia = ? AND num_version = 0`,
        [titulo, cuerpo, s.uid, id_cliente, newsId]
      );
    } else {
      await conn.query<ResultSetHeader>(
        `INSERT INTO no_version_noticia
           (id_cliente, id_noticia, num_version, titulo, cuerpo, tags, url, imagen_portada_url, id_usuario)
         VALUES (?, ?, 0, ?, ?, NULL, NULL, NULL, ?)`,
        [id_cliente, newsId, titulo, cuerpo, s.uid]
      );
    }

    const idEstado = await ensureEstadoNoticia(conn, "CUERPO_OK", "Cuerpo confirmado");

    await conn.query(
      `UPDATE no_noticia
       SET id_estado = ?, fe_modificacion = NOW()
       WHERE id_cliente = ? AND id_noticia = ?`,
      [idEstado, id_cliente, newsId]
    );

    await conn.commit();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try {
      await conn.rollback();
    } catch {}
    console.error("confirm-content error:", e);
    return NextResponse.json({ error: "Error confirmando contenido" }, { status: 500 });
  } finally {
    conn.release();
  }
}
