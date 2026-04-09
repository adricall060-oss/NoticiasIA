import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserDepartamentoAccess } from "@/lib/departamentos";
import { ensureEstadoNoticia } from "@/lib/estados-noticia";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

const DEFAULT_CANAL_ID = 1;

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const conn: PoolConnection = await db.getConnection();

  try {
    const s = await requireSession();
    const { id_cliente } = await getClienteByCodigo(s.codigo_cliente);

    const { id } = await params;
    const newsId = Number(id);
    if (!Number.isFinite(newsId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
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

    const existsQueryParams: number[] = [id_cliente, newsId];
    if (access.alcance !== "TENANT_COMPLETO") {
      existsQueryParams.push(...depIds);
    }

    await conn.beginTransaction();

    const [exists] = await conn.query<RowDataPacket[]>(
      `SELECT n.id_noticia
       FROM no_noticia n
       JOIN gr_grupo g
         ON g.id_grupo = n.id_grupo
        AND g.id_cliente = n.id_cliente
       WHERE n.id_cliente = ?
         AND n.id_noticia = ?
         AND n.fg_activo = 1
         AND g.fg_activo = 1
         ${whereDepartamento}
       LIMIT 1`,
      existsQueryParams
    );

    if (!exists.length) {
      await conn.rollback();
      return NextResponse.json({ error: "Noticia no encontrada" }, { status: 404 });
    }

    // ✅ publicación vuelve a PENDIENTE
    await conn.query(
      `INSERT INTO no_publicacion (id_cliente, id_noticia, id_canal, estado_publicacion, fe_publicada, url_publicada, fe_programada)
       VALUES (?, ?, ${DEFAULT_CANAL_ID}, 'PENDIENTE', NULL, NULL, NULL)
       ON DUPLICATE KEY UPDATE
         estado_publicacion = 'PENDIENTE',
         fe_publicada = NULL,
         url_publicada = NULL,
         fe_programada = NULL`,
      [id_cliente, newsId]
    );

    // ✅ estado noticia -> RETIRADO
    const idEstadoRetirado = await ensureEstadoNoticia(conn, "RETIRADO", "Retirado");

    await conn.query(
      `UPDATE no_noticia
       SET id_estado = ?,
           fe_publicacion = NULL,
           fe_modificacion = NOW()
       WHERE id_cliente = ? AND id_noticia = ?`,
      [idEstadoRetirado, id_cliente, newsId]
    );

    // ✅ si existiese borrador (0), lo borramos para empezar limpio
    await conn.query(
      `DELETE FROM no_version_noticia
       WHERE id_cliente = ? AND id_noticia = ? AND num_version = 0`,
      [id_cliente, newsId]
    );

    await conn.commit();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    try {
      await conn.rollback();
    } catch {}
    console.error("withdraw error:", e);
    return NextResponse.json({ error: "Error al retirar" }, { status: 500 });
  } finally {
    conn.release();
  }
}
