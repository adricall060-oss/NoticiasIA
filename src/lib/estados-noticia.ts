import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";

export type EstadoNoticiaCodigo =
  | "PENDIENTE"
  | "CUERPO_OK"
  | "IMG_OK"
  | "PUBLICADO"
  | "RETIRADO"
  | (string & {});

export async function ensureEstadoNoticia(
  conn: PoolConnection,
  codigo: EstadoNoticiaCodigo,
  nombre: string
): Promise<number> {
  const code = String(codigo ?? "").trim().toUpperCase();
  const name = String(nombre ?? "").trim() || code;

  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id_estado
     FROM tp_estados_noticia
     WHERE codigo = ?
     LIMIT 1`,
    [code]
  );

  if (rows.length) return Number((rows[0] as any).id_estado);

  const [ins] = await conn.query<ResultSetHeader>(
    `INSERT INTO tp_estados_noticia (codigo, nombre, fg_activo)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), fg_activo = 1`,
    [code, name]
  );

  if (ins.insertId) return Number(ins.insertId);

  const [rows2] = await conn.query<RowDataPacket[]>(
    `SELECT id_estado
     FROM tp_estados_noticia
     WHERE codigo = ?
     LIMIT 1`,
    [code]
  );

  if (!rows2.length) throw new Error("NO_ESTADO_NOTICIA");
  return Number((rows2[0] as any).id_estado);
}