import type { Connection, RowDataPacket } from "mysql2/promise";

export type Departamento = {
  id_departamento: number;
  nombre: string;
};

export type UsuarioAlcance = "DEPARTAMENTOS_ASIGNADOS" | "TENANT_COMPLETO";

export type UserDepartamentoAccess = {
  alcance: UsuarioAlcance;
  departamentoIds: number[];
};

type Queryable = Pick<Connection, "query">;

function mapDepartamentos(rows: RowDataPacket[]): Departamento[] {
  return rows
    .map((r: any) => ({
      id_departamento: Number(r.id_departamento),
      nombre: String(r.nombre ?? ""),
    }))
    .filter((r) => Number.isSafeInteger(r.id_departamento) && r.id_departamento > 0 && r.nombre.length > 0);
}

async function getDepartamentosCliente(conn: Queryable, id_cliente: number): Promise<Departamento[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT d.id_departamento, d.nombre
     FROM or_departamento d
     WHERE d.id_cliente = ?
       AND d.fg_activo = 1
     ORDER BY d.nombre ASC`,
    [id_cliente]
  );

  return mapDepartamentos(rows);
}

async function getDepartamentosAsignados(
  conn: Queryable,
  uid: number,
  id_cliente: number
): Promise<Departamento[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT d.id_departamento, d.nombre
     FROM us_usuario_departamento ud
     JOIN or_departamento d ON d.id_departamento = ud.id_departamento
     WHERE ud.id_usuario = ?
       AND d.id_cliente = ?
       AND d.fg_activo = 1
     ORDER BY d.nombre ASC`,
    [uid, id_cliente]
  );

  return mapDepartamentos(rows);
}

export async function getUserAlcance(
  conn: Queryable,
  uid: number,
  id_cliente: number
): Promise<UsuarioAlcance> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT alcance
     FROM us_usuario_rol
     WHERE id_usuario = ?
       AND id_cliente = ?`,
    [uid, id_cliente]
  );

  const hasTenantCompleto = rows.some(
    (r: any) => String(r?.alcance ?? "").toUpperCase() === "TENANT_COMPLETO"
  );

  return hasTenantCompleto ? "TENANT_COMPLETO" : "DEPARTAMENTOS_ASIGNADOS";
}

export async function getUserDepartamentos(
  conn: Queryable,
  uid: number,
  id_cliente: number
): Promise<Departamento[]> {
  const alcance = await getUserAlcance(conn, uid, id_cliente);
  if (alcance === "TENANT_COMPLETO") {
    return getDepartamentosCliente(conn, id_cliente);
  }

  return getDepartamentosAsignados(conn, uid, id_cliente);
}

export async function getUserDepartamentoAccess(
  conn: Queryable,
  uid: number,
  id_cliente: number
): Promise<UserDepartamentoAccess> {
  const alcance = await getUserAlcance(conn, uid, id_cliente);

  const departamentos =
    alcance === "TENANT_COMPLETO"
      ? await getDepartamentosCliente(conn, id_cliente)
      : await getDepartamentosAsignados(conn, uid, id_cliente);

  return {
    alcance,
    departamentoIds: departamentos.map((d) => d.id_departamento),
  };
}

export async function getUserDepartamentoIds(
  conn: Queryable,
  uid: number,
  id_cliente: number
): Promise<number[]> {
  const deps = await getUserDepartamentos(conn, uid, id_cliente);
  return deps.map((d) => d.id_departamento);
}
