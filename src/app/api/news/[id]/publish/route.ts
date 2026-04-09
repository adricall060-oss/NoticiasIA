import { NextResponse } from "next/server";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserDepartamentoAccess } from "@/lib/departamentos";
import { ensureEstadoNoticia } from "@/lib/estados-noticia";
import { publishTenantNewsToLinkedIn } from "@/lib/linkedin";

const DEFAULT_CANAL_ID = 1;

function toErrorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const conn: PoolConnection = await db.getConnection();

  try {
    const s = await requireSession();
    const { id_cliente } = await getClienteByCodigo(s.codigo_cliente);

    const { id } = await params;
    const newsId = Number(id);
    if (!Number.isFinite(newsId) || newsId <= 0) {
      return NextResponse.json({ error: "ID invalido" }, { status: 400 });
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

    const estado = String((newsRows[0] as RowDataPacket).estado_codigo ?? "PENDIENTE").toUpperCase();
    if (estado === "PUBLICADO") {
      await conn.commit();
      return NextResponse.json({ ok: true });
    }
    if (estado !== "IMG_OK") {
      await conn.rollback();
      return NextResponse.json({ error: "Primero confirma imagen" }, { status: 409 });
    }

    const [draftRows] = await conn.query<RowDataPacket[]>(
      `SELECT id_version_noticia, titulo, cuerpo, imagen_portada_url
       FROM no_version_noticia
       WHERE id_cliente = ? AND id_noticia = ? AND num_version = 0
       LIMIT 1`,
      [id_cliente, newsId]
    );

    if (!draftRows.length) {
      await conn.rollback();
      return NextResponse.json({ error: "No existe borrador (num_version = 0)" }, { status: 409 });
    }

    const draft = draftRows[0] as RowDataPacket;
    const draftId = Number(draft.id_version_noticia);
    const titulo = String(draft.titulo ?? "").trim();
    const cuerpo = String(draft.cuerpo ?? "").trim();
    const imagen = String(draft.imagen_portada_url ?? "").trim();

    if (!titulo || !cuerpo || !imagen) {
      await conn.rollback();
      return NextResponse.json({ error: "Faltan datos en el borrador (titulo/cuerpo/imagen)" }, { status: 400 });
    }

    const linkedInPublish = await publishTenantNewsToLinkedIn({
      idCliente: id_cliente,
      title: titulo,
      body: cuerpo,
      imageUrl: imagen,
    });
    const postRef = String(linkedInPublish.postUrn ?? "").trim();

    const [maxRows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(MAX(num_version), 0) AS maxver
       FROM no_version_noticia
       WHERE id_cliente = ? AND id_noticia = ? AND num_version > 0`,
      [id_cliente, newsId]
    );

    const maxver = Number((maxRows[0] as RowDataPacket).maxver ?? 0);
    const nextVer = maxver + 1;

    await conn.query(
      `UPDATE no_version_noticia
       SET num_version = ?, id_usuario = ?, fe_version = NOW()
       WHERE id_version_noticia = ? AND id_cliente = ? AND id_noticia = ?`,
      [nextVer, s.uid, draftId, id_cliente, newsId]
    );

    await conn.query(
      `INSERT INTO no_publicacion (id_cliente, id_noticia, id_canal, estado_publicacion, fe_publicada, url_publicada, fe_programada)
       VALUES (?, ?, ${DEFAULT_CANAL_ID}, 'PUBLICADO', NOW(), ?, NULL)
       ON DUPLICATE KEY UPDATE
         estado_publicacion = 'PUBLICADO',
         fe_publicada = NOW(),
         url_publicada = VALUES(url_publicada),
         fe_programada = NULL`,
      [id_cliente, newsId, postRef || null]
    );

    const idEstadoPublicado = await ensureEstadoNoticia(conn, "PUBLICADO", "Publicado");

    await conn.query(
      `UPDATE no_noticia
       SET id_estado = ?,
           id_version_actual = ?,
           fe_publicacion = NOW(),
           fe_modificacion = NOW()
       WHERE id_cliente = ? AND id_noticia = ?`,
      [idEstadoPublicado, draftId, id_cliente, newsId]
    );

    await conn.commit();
    return NextResponse.json({ ok: true, postRef: postRef || null });
  } catch (e: unknown) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback error on already closed transaction
    }

    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const message = toErrorMessage(e);
    if (/linkedin|token|oauth|author|cuenta|post|invalid_client|invalid token/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("publish error:", e);
    return NextResponse.json({ error: "Error al publicar" }, { status: 500 });
  } finally {
    conn.release();
  }
}
