import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserDepartamentoAccess } from "@/lib/departamentos";
import type { RowDataPacket } from "mysql2/promise";

const DEFAULT_CANAL_ID = 1;

type NewsRow = RowDataPacket & {
  id: number;
  id_grupo: number;
  titulo: string | null;
  cuerpo: string | null;
  imagen_url: string | null;
  estado_codigo: string | null;
  estado_nombre: string | null;
  fe_publicacion: Date | string | null;
  estado_publicacion: string | null;
  fe_publicada: Date | string | null;
  url_publicada: string | null;
};

export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const { id_cliente } = await getClienteByCodigo(s.codigo_cliente);

    const access = await getUserDepartamentoAccess(db, s.uid, id_cliente);
    const depIds = access.departamentoIds;
    if (access.alcance === "DEPARTAMENTOS_ASIGNADOS" && !depIds.length) {
      return NextResponse.json({ ok: true, data: [] });
    }

    const { searchParams } = new URL(req.url);
    const generoId = searchParams.get("generoId");
    const generoNum = generoId ? Number(generoId) : null;

    const whereGenero = generoNum && Number.isFinite(generoNum) ? " AND n.id_grupo = ?" : "";
    const whereDepartamento =
      access.alcance === "TENANT_COMPLETO"
        ? ""
        : ` AND g.id_departamento IN (${depIds.map(() => "?").join(",")})`;

    const queryParams: number[] = [id_cliente];
    if (access.alcance !== "TENANT_COMPLETO") queryParams.push(...depIds);
    if (generoNum && Number.isFinite(generoNum)) queryParams.push(generoNum);

    const [rows] = await db.query<NewsRow[]>(
      `SELECT
         n.id_noticia AS id,
         n.id_grupo,
         COALESCE(vd.titulo, v.titulo) AS titulo,
         COALESCE(vd.cuerpo, v.cuerpo) AS cuerpo,
         CASE
           WHEN COALESCE(vd.imagen_portada_url, v.imagen_portada_url) LIKE 'data:image/%'
             AND CHAR_LENGTH(COALESCE(vd.imagen_portada_url, v.imagen_portada_url)) >= 2048
           THEN COALESCE(prev_img.imagen_portada_url, COALESCE(vd.imagen_portada_url, v.imagen_portada_url))
           ELSE COALESCE(vd.imagen_portada_url, v.imagen_portada_url)
         END AS imagen_url,
         e.codigo AS estado_codigo,
         e.nombre AS estado_nombre,
         n.fe_publicacion,
         pub.estado_publicacion,
         pub.fe_publicada,
         pub.url_publicada
       FROM no_noticia n
       JOIN gr_grupo g
         ON g.id_grupo = n.id_grupo
        AND g.id_cliente = n.id_cliente
       LEFT JOIN tp_estados_noticia e
         ON e.id_estado = n.id_estado
       LEFT JOIN no_version_noticia v
         ON v.id_version_noticia = n.id_version_actual
       LEFT JOIN no_version_noticia vd
         ON vd.id_cliente = n.id_cliente
        AND vd.id_noticia = n.id_noticia
        AND vd.num_version = 0
       LEFT JOIN no_version_noticia prev_img
         ON prev_img.id_version_noticia = (
           SELECT pv.id_version_noticia
           FROM no_version_noticia pv
           WHERE pv.id_cliente = n.id_cliente
             AND pv.id_noticia = n.id_noticia
             AND pv.imagen_portada_url IS NOT NULL
             AND pv.imagen_portada_url <> ''
             AND pv.imagen_portada_url NOT LIKE 'data:image/%'
           ORDER BY pv.num_version DESC, pv.id_version_noticia DESC
           LIMIT 1
         )
       LEFT JOIN no_publicacion pub
         ON pub.id_cliente = n.id_cliente
        AND pub.id_noticia = n.id_noticia
        AND pub.id_canal = ${DEFAULT_CANAL_ID}
       WHERE n.id_cliente = ?
         AND n.fg_activo = 1
         AND g.fg_activo = 1
         ${whereDepartamento}
         ${whereGenero}
       ORDER BY n.id_noticia DESC`,
      queryParams
    );

    const data = rows.map((r) => {
      const estado = String(r.estado_codigo ?? "PENDIENTE").toUpperCase();
      const pubEstado = String(r.estado_publicacion ?? "").toUpperCase();

      // ✅ CLAVE: publicado SOLO por estado, no por fechas
      const publicadoBool = estado === "PUBLICADO" || pubEstado === "PUBLICADO";
      const fecha_pub = publicadoBool ? (r.fe_publicada ?? r.fe_publicacion ?? null) : null;

      return {
        id: Number(r.id),
        id_grupo: Number(r.id_grupo),
        titulo: r.titulo ?? null,
        cuerpo: r.cuerpo ?? null,
        imagen_url: r.imagen_url ?? null,

        estado_codigo: estado,
        estado_nombre: String(r.estado_nombre ?? (publicadoBool ? "Publicado" : "Pendiente")),

        publicado: publicadoBool ? "Si" : "No",
        fecha_publicacion: fecha_pub ? String(fecha_pub) : null,

        url_publicada: r.url_publicada ?? null,
      };
    });

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
}
