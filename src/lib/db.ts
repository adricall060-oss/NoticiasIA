import mysql from "mysql2/promise";

const useSsl = String(process.env.DB_SSL ?? "")
  .trim()
  .toLowerCase() === "true";

const caCert = String(process.env.DB_CA_CERT ?? "").replace(/\\n/g, "\n").trim();
const connectTimeoutRaw = Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10000);
const connectTimeoutMs =
  Number.isFinite(connectTimeoutRaw) && connectTimeoutRaw > 0 ? connectTimeoutRaw : 10000;

export const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: useSsl
    ? {
        ...(caCert ? { ca: caCert } : {}),
      }
    : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: connectTimeoutMs,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});
