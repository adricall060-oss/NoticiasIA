import type { RowDataPacket } from "mysql2/promise";
import type { Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getClienteByCodigo } from "@/lib/tenant";

type UserRoleRow = RowDataPacket & {
  tipo_usuario: string | null;
};

export type SessionContext = {
  id_cliente: number;
  role: "admin" | "member";
};

function mapUserRole(raw: unknown): "admin" | "member" {
  const value = String(raw ?? "").trim().toUpperCase();
  return value.includes("ADMIN") ? "admin" : "member";
}

export async function resolveSessionContext(session: Session): Promise<SessionContext> {
  const cli = await getClienteByCodigo(session.codigo_cliente);

  const [rows] = await db.query<UserRoleRow[]>(
    `SELECT tipo_usuario
     FROM us_usuario
     WHERE id_usuario = ?
       AND fg_activo = 1
     LIMIT 1`,
    [session.uid]
  );

  return {
    id_cliente: cli.id_cliente,
    role: mapUserRole(rows[0]?.tipo_usuario ?? null),
  };
}
