import { db } from "@/lib/db";

export type ClienteInfo = {
  id_cliente: number;
  nombre: string;
  codigo: string;
};

type ClienteRow = {
  id_cliente: number;
  nombre: string;
  codigo: string;
};

const TRANSIENT_DB_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
]);

function isTransientDbError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "")
    .trim()
    .toUpperCase();
  if (TRANSIENT_DB_ERROR_CODES.has(code)) return true;

  const message = String((error as { message?: unknown }).message ?? "")
    .trim()
    .toUpperCase();
  return message.includes("ECONNRESET") || message.includes("CONNECTION LOST");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchClienteRows(codigo: string): Promise<ClienteRow[]> {
  const [rows] = await db.query<ClienteRow[]>(
    `SELECT id_cliente, nombre, codigo
     FROM or_cliente
     WHERE codigo = ? AND fg_activo = 1
     LIMIT 1`,
    [codigo]
  );
  return rows;
}

export async function getClienteByCodigo(codigo_cliente: string): Promise<ClienteInfo> {
  const codigo = String(codigo_cliente ?? "").trim();
  if (!codigo) throw new Error("CODIGO_CLIENTE_REQUERIDO");

  const maxAttempts = 3;
  let rows: ClienteRow[] = [];
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rows = await fetchClienteRows(codigo);
      lastError = null;
      break;
    } catch (error: unknown) {
      lastError = error;
      const shouldRetry = isTransientDbError(error) && attempt < maxAttempts;
      if (!shouldRetry) throw error;

      // Backoff corto para reconexion de pool tras cortes transitorios.
      await wait(attempt * 150);
    }
  }

  if (lastError) throw lastError;

  if (!rows.length) throw new Error("CODIGO_CLIENTE_INVALIDO");

  return {
    id_cliente: Number(rows[0].id_cliente),
    nombre: String(rows[0].nombre ?? ""),
    codigo: String(rows[0].codigo ?? codigo),
  };
}
