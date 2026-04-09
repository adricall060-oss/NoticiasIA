import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveSessionContext } from "@/lib/session-context";
import { fetchLinkedInPostStats } from "@/lib/linkedin";
import { captureNewsStats } from "@/lib/news-stats";

type KpiRow = RowDataPacket & {
  fecha: Date | string;
  id_grupo: number | null;
  canal_codigo: string | number | null;
  metrica_codigo: string | null;
  acumulado_total: string | number;
  delta_total: string | number;
};

type SummaryAccumulator = {
  latestDate: string;
  acumuladoActual: number;
  deltaPeriodo: number;
};

type LinkedInSyncCandidateRow = RowDataPacket & {
  id_publicacion: number;
  id_noticia: number;
  post_ref: string | null;
  last_capture: Date | string | null;
};

type LinkedInSyncSummary = {
  attempted: boolean;
  totalCandidates: number;
  synced: number;
  failed: number;
  skippedNoRef: number;
  skippedRecent: number;
  skippedNoMetrics: number;
  insertedMetricas: number;
  warnings: string[];
};

const tableCache: Record<string, boolean | undefined> = {};
const columnCache: Record<string, boolean | undefined> = {};

const DEFAULT_SYNC_LIMIT = 20;
const MAX_SYNC_LIMIT = 80;
const DEFAULT_SYNC_MIN_MINUTES = 15;
const MAX_SYNC_MIN_MINUTES = 24 * 60;

function toDateYmd(value: Date | string) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clampDays(raw: string | null) {
  const n = Number(raw ?? 30);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(180, Math.floor(n)));
}

function clampSyncLimit(raw: string | null) {
  const n = Number(raw ?? DEFAULT_SYNC_LIMIT);
  if (!Number.isFinite(n)) return DEFAULT_SYNC_LIMIT;
  return Math.max(1, Math.min(MAX_SYNC_LIMIT, Math.floor(n)));
}

function clampSyncMinMinutes(raw: string | null) {
  const n = Number(raw ?? DEFAULT_SYNC_MIN_MINUTES);
  if (!Number.isFinite(n)) return DEFAULT_SYNC_MIN_MINUTES;
  return Math.max(0, Math.min(MAX_SYNC_MIN_MINUTES, Math.floor(n)));
}

function parseBool(raw: string | null, defaultValue: boolean) {
  if (raw === null) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (!v) return defaultValue;
  return !["0", "false", "no", "off"].includes(v);
}

function toDate(value: Date | string | null) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function elapsedEnough(lastCapture: Date | null, minMinutes: number) {
  if (!lastCapture || minMinutes <= 0) return true;
  const elapsedMs = Date.now() - lastCapture.getTime();
  return elapsedMs >= minMinutes * 60 * 1000;
}

async function hasTable(tableName: string) {
  if (tableCache[tableName] === true) return true;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 AS found
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
       LIMIT 1`,
      [tableName]
    );
    tableCache[tableName] = rows.length > 0 ? true : undefined;
  } catch {
    tableCache[tableName] = undefined;
  }
  return tableCache[tableName] === true;
}

async function hasColumn(tableName: string, columnName: string) {
  const key = `${tableName}.${columnName}`;
  if (columnCache[key] === true) return true;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 AS found
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [tableName, columnName]
    );
    columnCache[key] = rows.length > 0 ? true : undefined;
  } catch {
    columnCache[key] = undefined;
  }
  return columnCache[key] === true;
}

async function resolveChannelIdByCode(canalCodigo: string) {
  if (!(await hasTable("tp_canales"))) return null;
  const hasIdCanal = await hasColumn("tp_canales", "id_canal");
  const hasCodigo = await hasColumn("tp_canales", "codigo");
  if (!hasIdCanal || !hasCodigo) return null;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id_canal
     FROM tp_canales
     WHERE UPPER(codigo) = ?
     LIMIT 1`,
    [canalCodigo]
  );
  if (!rows.length) return null;
  const resolved = Number(rows[0].id_canal);
  return Number.isFinite(resolved) ? resolved : null;
}

async function resolveStatsCaptureDateColumn() {
  if (await hasColumn("NO_ESTADISTICA", "fecha_captura")) return "fecha_captura";
  if (await hasColumn("NO_ESTADISTICA", "fe_captura")) return "fe_captura";
  return null;
}

async function syncLinkedInKpiForTenant(params: {
  idCliente: number;
  limit: number;
  minMinutes: number;
  force: boolean;
}): Promise<LinkedInSyncSummary> {
  const statsCaptureDateColumn = await resolveStatsCaptureDateColumn();
  const safeLimit = Math.max(1, Math.min(MAX_SYNC_LIMIT, Math.floor(params.limit)));
  const publicationHasCanalCodigo = await hasColumn("no_publicacion", "canal_codigo");
  const publicationHasIdCanal = await hasColumn("no_publicacion", "id_canal");

  if (!publicationHasCanalCodigo && !publicationHasIdCanal) {
    return {
      attempted: true,
      totalCandidates: 0,
      synced: 0,
      failed: 1,
      skippedNoRef: 0,
      skippedRecent: 0,
      skippedNoMetrics: 0,
      insertedMetricas: 0,
      warnings: ["no_publicacion no tiene canal_codigo ni id_canal."],
    };
  }

  const hasEstadoPublicacion = await hasColumn("no_publicacion", "estado_publicacion");
  const hasUrlPublicada = await hasColumn("no_publicacion", "url_publicada");
  const hasPayloadJson = await hasColumn("no_publicacion", "payload_respuesta_json");
  const hasUpdatedAt = await hasColumn("no_publicacion", "updated_at");
  const hasFePublicada = await hasColumn("no_publicacion", "fe_publicada");
  const hasFechaPublicacion = await hasColumn("no_publicacion", "fecha_publicacion");

  const stateSql = hasEstadoPublicacion
    ? " AND UPPER(np.estado_publicacion) IN ('PUBLICADO', 'PUBLICADA')"
    : "";
  const postRefSql = hasUrlPublicada && hasPayloadJson
    ? `COALESCE(
         NULLIF(np.url_publicada, ''),
         JSON_UNQUOTE(JSON_EXTRACT(np.payload_respuesta_json, '$.postRef'))
       ) AS post_ref`
    : hasUrlPublicada
      ? "NULLIF(np.url_publicada, '') AS post_ref"
      : hasPayloadJson
        ? "JSON_UNQUOTE(JSON_EXTRACT(np.payload_respuesta_json, '$.postRef')) AS post_ref"
        : "NULL AS post_ref";
  const orderField = hasUpdatedAt
    ? "np.updated_at"
    : hasFePublicada
      ? "np.fe_publicada"
      : hasFechaPublicacion
        ? "np.fecha_publicacion"
        : "np.id_publicacion";

  let channelSql = "";
  const queryParams: Array<number | string> = [params.idCliente];

  if (publicationHasCanalCodigo) {
    channelSql = " AND UPPER(np.canal_codigo) = 'LINKEDIN'";
  } else {
    const linkedinId = (await resolveChannelIdByCode("LINKEDIN")) ?? 1;
    channelSql = " AND np.id_canal = ?";
    queryParams.push(linkedinId);
  }

  const [rows] = await db.execute<LinkedInSyncCandidateRow[]>(
    `SELECT
       np.id_publicacion,
       np.id_noticia,
       ${postRefSql},
       ${statsCaptureDateColumn ? `(
         SELECT MAX(ne.${statsCaptureDateColumn})
         FROM NO_ESTADISTICA ne
         WHERE ne.id_publicacion = np.id_publicacion
       )` : "NULL"} AS last_capture
     FROM no_publicacion np
     WHERE np.id_cliente = ?
       ${channelSql}
       ${stateSql}
     ORDER BY ${orderField} DESC, np.id_publicacion DESC
     LIMIT ${safeLimit}`,
    queryParams
  );

  let synced = 0;
  let failed = 0;
  let skippedNoRef = 0;
  let skippedRecent = 0;
  let skippedNoMetrics = 0;
  let insertedMetricas = 0;
  const warnings: string[] = [];

  for (const row of rows) {
    const noticiaId = Number(row.id_noticia);
    const postRef = String(row.post_ref ?? "").trim();
    const lastCapture = toDate(row.last_capture);

    if (!Number.isSafeInteger(noticiaId) || noticiaId <= 0) {
      failed += 1;
      warnings.push(`Publicacion ${row.id_publicacion}: id_noticia invalido.`);
      continue;
    }

    if (!postRef) {
      skippedNoRef += 1;
      continue;
    }

    if (!params.force && !elapsedEnough(lastCapture, params.minMinutes)) {
      skippedRecent += 1;
      continue;
    }

    try {
      const postStats = await fetchLinkedInPostStats({
        idCliente: params.idCliente,
        postRef,
      });
      const metrics = Object.fromEntries(
        Object.entries(postStats.metrics).filter(([, value]) => Number.isFinite(value) && value >= 0)
      );
      if (!Object.keys(metrics).length) {
        skippedNoMetrics += 1;
        continue;
      }

      const saved = await captureNewsStats({
        newsId: noticiaId,
        idCliente: params.idCliente,
        channel: "LINKEDIN",
        capturedAt: new Date(),
        origin: "LINKEDIN_AUTO_SYNC",
        metrics,
      });

      if (!saved.ok) {
        failed += 1;
        warnings.push(`Noticia ${noticiaId}: ${saved.message || "No se pudieron guardar metricas"}`);
        continue;
      }

      synced += 1;
      insertedMetricas += saved.insertedMetricas;
      if (postStats.warnings.length > 0) {
        warnings.push(`Noticia ${noticiaId}: ${postStats.warnings.join(" | ")}`);
      }
    } catch (e: unknown) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      warnings.push(`Noticia ${noticiaId}: ${message}`);
    }
  }

  return {
    attempted: true,
    totalCandidates: rows.length,
    synced,
    failed,
    skippedNoRef,
    skippedRecent,
    skippedNoMetrics,
    insertedMetricas,
    warnings: warnings.slice(0, 25),
  };
}

export async function GET(req: Request) {
  try {
    const session = await requireSession();
    const context = await resolveSessionContext(session);
    if (context.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    if (!(await hasTable("NO_KPI_DIARIO"))) {
      return NextResponse.json(
        { error: "La tabla no_kpi_diario no existe aun. Ejecuta las migraciones V2." },
        { status: 400 }
      );
    }

    const hasCanalCodigo = await hasColumn("NO_KPI_DIARIO", "canal_codigo");
    const hasIdCanal = await hasColumn("NO_KPI_DIARIO", "id_canal");
    const hasValorAcumuladoTotal = await hasColumn("NO_KPI_DIARIO", "valor_acumulado_total");
    const hasValorDeltaTotal = await hasColumn("NO_KPI_DIARIO", "valor_delta_total");
    const hasValorTotal = await hasColumn("NO_KPI_DIARIO", "valor_total");
    const hasValorDelta = await hasColumn("NO_KPI_DIARIO", "valor_delta");

    if (!hasCanalCodigo && !hasIdCanal) {
      return NextResponse.json(
        { error: "no_kpi_diario no tiene canal_codigo ni id_canal para filtrar KPI por canal." },
        { status: 400 }
      );
    }

    if ((!hasValorAcumuladoTotal && !hasValorTotal) || (!hasValorDeltaTotal && !hasValorDelta)) {
      return NextResponse.json(
        { error: "no_kpi_diario no tiene columnas de valor compatibles para KPI diario." },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const days = clampDays(searchParams.get("days"));
    const channel = String(searchParams.get("canal") ?? "").trim().toUpperCase();
    const shouldSync = parseBool(searchParams.get("sync"), true);
    const syncLimit = clampSyncLimit(searchParams.get("syncLimit"));
    const syncMinMinutes = clampSyncMinMinutes(searchParams.get("syncMinMinutes"));
    const forceSync = parseBool(searchParams.get("forceSync"), false);

    let syncSummary: LinkedInSyncSummary | null = null;
    if (shouldSync && (!channel || channel === "LINKEDIN")) {
      try {
        syncSummary = await syncLinkedInKpiForTenant({
          idCliente: context.id_cliente,
          limit: syncLimit,
          minMinutes: syncMinMinutes,
          force: forceSync,
        });
      } catch (syncErr) {
        const message = syncErr instanceof Error ? syncErr.message : String(syncErr);
        syncSummary = {
          attempted: true,
          totalCandidates: 0,
          synced: 0,
          failed: 1,
          skippedNoRef: 0,
          skippedRecent: 0,
          skippedNoMetrics: 0,
          insertedMetricas: 0,
          warnings: [message],
        };
      }
    }

    const to = new Date();
    const from = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
    const fromYmd = toDateYmd(from);
    const toYmd = toDateYmd(to);

    let channelSql = "";
    const queryParams: Array<number | string> = [context.id_cliente, fromYmd, toYmd];

    let selectCanalSql = "k.canal_codigo";
    let joinCanalSql = "";
    let groupByCanalSql = "k.canal_codigo";
    const acumuladoExpr = hasValorTotal && hasValorAcumuladoTotal
      ? "COALESCE(k.valor_total, k.valor_acumulado_total, 0)"
      : hasValorTotal
        ? "COALESCE(k.valor_total, 0)"
        : "COALESCE(k.valor_acumulado_total, 0)";
    const deltaExpr = hasValorDelta && hasValorDeltaTotal
      ? "COALESCE(k.valor_delta, k.valor_delta_total, 0)"
      : hasValorDelta
        ? "COALESCE(k.valor_delta, 0)"
        : "COALESCE(k.valor_delta_total, 0)";

    if (hasCanalCodigo) {
      if (channel) {
        channelSql = " AND k.canal_codigo = ?";
        queryParams.push(channel);
      }
    } else {
      const hasTpCanales = await hasTable("tp_canales");
      const tpHasIdCanal = hasTpCanales && (await hasColumn("tp_canales", "id_canal"));
      const tpHasCodigo = hasTpCanales && (await hasColumn("tp_canales", "codigo"));

      selectCanalSql =
        tpHasIdCanal && tpHasCodigo
          ? "COALESCE(tc.codigo, CAST(k.id_canal AS CHAR)) AS canal_codigo"
          : "CAST(k.id_canal AS CHAR) AS canal_codigo";
      groupByCanalSql = "k.id_canal";

      if (tpHasIdCanal && tpHasCodigo) {
        joinCanalSql = " LEFT JOIN tp_canales tc ON tc.id_canal = k.id_canal";
      }

      if (channel) {
        const parsedNumeric = Number(channel);
        const resolvedChannelId =
          Number.isFinite(parsedNumeric) && parsedNumeric > 0
            ? parsedNumeric
            : await resolveChannelIdByCode(channel);

        if (!resolvedChannelId) {
          return NextResponse.json({
            ok: true,
            data: {
              from: fromYmd,
              to: toYmd,
              days,
              channel,
              channels: [],
              summary: [],
              series: [],
            },
          });
        }

        channelSql = " AND k.id_canal = ?";
        queryParams.push(resolvedChannelId);
      }
    }

    const [rows] = await db.execute<KpiRow[]>(
      `SELECT k.fecha,
              k.id_grupo,
              ${selectCanalSql},
              k.metrica_codigo,
              SUM(${acumuladoExpr}) AS acumulado_total,
              SUM(${deltaExpr}) AS delta_total
       FROM NO_KPI_DIARIO k
       ${joinCanalSql}
       WHERE k.id_cliente = ?
         AND k.fecha BETWEEN ? AND ?
         ${channelSql}
       GROUP BY k.fecha, k.id_grupo, ${groupByCanalSql}, k.metrica_codigo
       ORDER BY k.fecha DESC, k.id_grupo ASC, k.metrica_codigo ASC`,
      queryParams
    );

    const series = rows.map((row) => ({
      fecha: toDateYmd(row.fecha),
      id_grupo: Number.isFinite(Number(row.id_grupo)) ? Number(row.id_grupo) : null,
      canal_codigo: String(row.canal_codigo ?? ""),
      metrica_codigo: String(row.metrica_codigo ?? ""),
      acumulado_total: Number(row.acumulado_total ?? 0),
      delta_total: Number(row.delta_total ?? 0),
    }));

    const summaryMap = new Map<string, SummaryAccumulator>();
    for (const row of series) {
      const current = summaryMap.get(row.metrica_codigo);
      if (!current) {
        summaryMap.set(row.metrica_codigo, {
          latestDate: row.fecha,
          acumuladoActual: row.acumulado_total,
          deltaPeriodo: row.delta_total,
        });
        continue;
      }

      current.deltaPeriodo += row.delta_total;
      if (row.fecha > current.latestDate) {
        current.latestDate = row.fecha;
        current.acumuladoActual = row.acumulado_total;
      } else if (row.fecha === current.latestDate) {
        current.acumuladoActual += row.acumulado_total;
      }
    }

    const summary = Array.from(summaryMap.entries())
      .map(([metrica_codigo, data]) => ({
        metrica_codigo,
        acumulado_actual: data.acumuladoActual,
        delta_periodo: data.deltaPeriodo,
        latest_date: data.latestDate,
      }))
      .sort((a, b) => b.delta_periodo - a.delta_periodo);

    const canales = Array.from(new Set(series.map((row) => row.canal_codigo))).sort();

    return NextResponse.json({
      ok: true,
      data: {
        from: fromYmd,
        to: toYmd,
        days,
        channel: channel || null,
        channels: canales,
        summary,
        series,
        sync: syncSummary,
      },
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "ER_NO_SUCH_TABLE"
    ) {
      return NextResponse.json(
        { error: "Falta alguna tabla requerida para KPI (no_kpi_diario o tablas de usuarios/departamentos)." },
        { status: 400 }
      );
    }
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "ER_BAD_FIELD_ERROR"
    ) {
      return NextResponse.json(
        { error: "Esquema de base de datos incompatible para KPI (faltan columnas esperadas)." },
        { status: 400 }
      );
    }
    console.error("GET /api/kpi/daily failed:", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
