import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserDepartamentoAccess } from "@/lib/departamentos";
import { ensureEstadoNoticia } from "@/lib/estados-noticia";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

type EstadoRow = RowDataPacket & {
  estado_codigo: string | null;
};

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
    const imagen = String(body.imagen_url_confirmada ?? body.imagen_url ?? "").trim();
    if (!imagen) return NextResponse.json({ error: "Imagen obligatoria" }, { status: 400 });
    if (imagen.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Formato invalido: usa una URL de imagen, no data URL." },
        { status: 400 }
      );
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

    const [newsRows] = await conn.query<EstadoRow[]>(
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

    const estado = String(newsRows[0]?.estado_codigo ?? "PENDIENTE").toUpperCase();
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

    if (!draft.length) {
      await conn.rollback();
      return NextResponse.json({ error: "Primero confirma el contenido" }, { status: 409 });
    }

    await conn.query(
      `UPDATE no_version_noticia
       SET imagen_portada_url = ?, id_usuario = ?, fe_version = NOW()
       WHERE id_cliente = ? AND id_noticia = ? AND num_version = 0`,
      [imagen, s.uid, id_cliente, newsId]
    );

    const idEstado = await ensureEstadoNoticia(conn, "IMG_OK", "Imagen confirmada");

    await conn.query(
      `UPDATE no_noticia
       SET id_estado = ?, fe_modificacion = NOW()
       WHERE id_cliente = ? AND id_noticia = ?`,
      [idEstado, id_cliente, newsId]
    );

    await conn.commit();
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    try {
      await conn.rollback();
    } catch {}
    console.error("confirm-image error:", e);
    return NextResponse.json({ error: "Error confirmando imagen" }, { status: 500 });
  } finally {
    conn.release();
  }
}
