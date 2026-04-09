import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";

type ScalarCountRow = RowDataPacket & {
  c: number;
};

type PublicationRow = RowDataPacket & {
  id_publicacion: number;
  canal_codigo?: string | null;
  id_canal?: number | null;
};

type GroupDeptRow = RowDataPacket & {
  id_grupo: number;
  id_departamento: number;
};

type PreviousMetricRow = RowDataPacket & {
  valor_acumulado: string | number;
};

type KpiAggregateRow = RowDataPacket & {
  acumulado_total: string | number;
  delta_total: string | number;
};

type MetricCatalogRow = RowDataPacket & {
  id_metrica?: number | null;
  codigo?: string | null;
};

type ChannelDimension =
  | { kind: "canal_codigo"; value: string }
  | { kind: "id_canal"; value: number };

type CaptureStatsResult = {
  attempted: boolean;
  ok: boolean;
  message: string;
  id_publicacion?: number;
  insertedMetricas: number;
};

type CaptureStatsParams = {
  newsId: number;
  idCliente: number;
  channel?: string;
  capturedAt?: Date;
  origin?: string;
  metrics: Record<string, number>;
};

const tableCache: Record<string, boolean | undefined> = {};
const columnCache: Record<string, boolean | undefined> = {};
const metricIdCache: Record<string, number | null | undefined> = {};

const requiredStatsTables = [
  "no_noticia",
  "gr_grupo",
  "no_publicacion",
  "NO_ESTADISTICA",
  "NO_ESTADISTICA_VALOR",
  "NO_KPI_DIARIO",
] as const;

function normalizeMetricCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

function toDateYmd(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asNumber(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n;
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

async function hasAllTables(tableNames: readonly string[]) {
  const missing: string[] = [];
  for (const tableName of tableNames) {
    if (!(await hasTable(tableName))) missing.push(tableName);
  }
  return {
    ok: missing.length === 0,
    missing,
  };
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

async function resolveChannelCodeById(idCanal: number) {
  if (!(await hasTable("tp_canales"))) return null;
  const hasIdCanal = await hasColumn("tp_canales", "id_canal");
  const hasCodigo = await hasColumn("tp_canales", "codigo");
  if (!hasIdCanal || !hasCodigo) return null;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT codigo
     FROM tp_canales
     WHERE id_canal = ?
     LIMIT 1`,
    [idCanal]
  );

  if (!rows.length) return null;
  const codigo = String(rows[0].codigo ?? "").trim().toUpperCase();
  return codigo || null;
}

async function resolveMetricIdByCode(metricCode: string) {
  const normalized = normalizeMetricCode(metricCode);
  if (!normalized) return null;
  if (metricIdCache[normalized] !== undefined) return metricIdCache[normalized] ?? null;
  if (!(await hasTable("TP_METRICA"))) {
    metricIdCache[normalized] = null;
    return null;
  }

  const hasCodigo = await hasColumn("TP_METRICA", "codigo");
  const hasIdMetrica = await hasColumn("TP_METRICA", "id_metrica");
  if (!hasCodigo || !hasIdMetrica) {
    metricIdCache[normalized] = null;
    return null;
  }

  const [rows] = await db.execute<MetricCatalogRow[]>(
    `SELECT id_metrica
     FROM TP_METRICA
     WHERE UPPER(codigo) = ?
     LIMIT 1`,
    [normalized]
  );

  if (!rows.length) {
    metricIdCache[normalized] = null;
    return null;
  }

  const resolved = Number(rows[0].id_metrica);
  metricIdCache[normalized] = Number.isFinite(resolved) ? resolved : null;
  return metricIdCache[normalized] ?? null;
}

async function resolveStatsCaptureDateColumn() {
  if (await hasColumn("NO_ESTADISTICA", "fecha_captura")) return "fecha_captura";
  if (await hasColumn("NO_ESTADISTICA", "fe_captura")) return "fe_captura";
  return null;
}

async function resolveChannelDimension(channelRaw: string): Promise<ChannelDimension | null> {
  const channel = channelRaw.trim().toUpperCase() || "LINKEDIN";
  const publicationHasCanalCodigo = await hasColumn("no_publicacion", "canal_codigo");
  const publicationHasIdCanal = await hasColumn("no_publicacion", "id_canal");

  if (publicationHasCanalCodigo) {
    return { kind: "canal_codigo", value: channel };
  }

  if (publicationHasIdCanal) {
    const numeric = Number(channel);
    const channelId =
      Number.isFinite(numeric) && numeric > 0 ? numeric : await resolveChannelIdByCode(channel) ?? 1;
    return { kind: "id_canal", value: channelId };
  }

  return null;
}

async function isMetricAllowedForChannel(
  idCliente: number,
  channelDimension: ChannelDimension,
  metricCode: string,
  metricId: number | null
) {
  if (!(await hasTable("NO_RL_CA_ME"))) return true;

  const hasCanalCodigo = await hasColumn("NO_RL_CA_ME", "canal_codigo");
  const hasIdCanal = await hasColumn("NO_RL_CA_ME", "id_canal");
  const hasMetricaCodigo = await hasColumn("NO_RL_CA_ME", "metrica_codigo");
  const hasIdMetrica = await hasColumn("NO_RL_CA_ME", "id_metrica");
  if ((!hasMetricaCodigo && !hasIdMetrica) || (!hasCanalCodigo && !hasIdCanal)) return true;

  const activePredicate = (await hasColumn("NO_RL_CA_ME", "activo"))
    ? "AND activo = 1"
    : (await hasColumn("NO_RL_CA_ME", "fg_activo"))
      ? "AND fg_activo = 1"
      : "";

  const normalizedMetricCode = normalizeMetricCode(metricCode);
  if (!normalizedMetricCode) return true;

  let channelPredicate = "";
  let channelValue: string | number | null = null;

  if (channelDimension.kind === "id_canal" && hasIdCanal) {
    channelPredicate = "id_canal = ?";
    channelValue = channelDimension.value;
  } else if (channelDimension.kind === "canal_codigo" && hasCanalCodigo) {
    channelPredicate = "UPPER(canal_codigo) = ?";
    channelValue = channelDimension.value;
  } else if (channelDimension.kind === "canal_codigo" && hasIdCanal) {
    const resolvedId = await resolveChannelIdByCode(channelDimension.value);
    if (resolvedId) {
      channelPredicate = "id_canal = ?";
      channelValue = resolvedId;
    }
  } else if (channelDimension.kind === "id_canal" && hasCanalCodigo) {
    const resolvedCode = await resolveChannelCodeById(channelDimension.value);
    if (resolvedCode) {
      channelPredicate = "UPPER(canal_codigo) = ?";
      channelValue = resolvedCode;
    }
  }

  if (!channelPredicate || channelValue === null) return true;

  const [countRows] = await db.execute<ScalarCountRow[]>(
    `SELECT COUNT(*) AS c
     FROM NO_RL_CA_ME
     WHERE id_cliente = ?
       AND ${channelPredicate}
       ${activePredicate}`,
    [idCliente, channelValue]
  );

  const hasRowsForChannel = Number(countRows?.[0]?.c ?? 0) > 0;
  if (!hasRowsForChannel) return true;

  const metricPredicate =
    hasIdMetrica && metricId !== null
      ? "id_metrica = ?"
      : hasMetricaCodigo
        ? "UPPER(metrica_codigo) = ?"
        : "";

  if (!metricPredicate) return true;

  const metricValue = hasIdMetrica && metricId !== null ? metricId : normalizedMetricCode;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 AS found
     FROM NO_RL_CA_ME
     WHERE id_cliente = ?
       AND ${channelPredicate}
       AND ${metricPredicate}
       ${activePredicate}
     LIMIT 1`,
    [idCliente, channelValue, metricValue]
  );
  return rows.length > 0;
}

async function recalculateDailyKpi(params: {
  idCliente: number;
  idGrupo: number;
  idDepartamento: number;
  channelDimension: ChannelDimension;
  channelCodeHint: string;
  metricaCodigo: string;
  metricId: number | null;
  day: string;
}) {
  const captureDateColumn = await resolveStatsCaptureDateColumn();
  if (!captureDateColumn) {
    throw new Error("NO_ESTADISTICA no tiene fecha_captura ni fe_captura.");
  }

  const publicationChannelPredicate =
    params.channelDimension.kind === "canal_codigo" ? "np.canal_codigo = ?" : "np.id_canal = ?";

  const [aggRows] = await db.execute<KpiAggregateRow[]>(
    `SELECT
       COALESCE(SUM(pub_agg.max_acum), 0) AS acumulado_total,
       COALESCE(SUM(pub_agg.sum_delta), 0) AS delta_total
     FROM (
       SELECT
         ne.id_publicacion,
         MAX(nev.valor_acumulado) AS max_acum,
         SUM(nev.valor_delta) AS sum_delta
       FROM NO_ESTADISTICA ne
       JOIN NO_ESTADISTICA_VALOR nev
         ON nev.id_estadistica = ne.id_estadistica
       JOIN no_publicacion np
         ON np.id_publicacion = ne.id_publicacion
       JOIN no_noticia nn
         ON nn.id_noticia = np.id_noticia
       WHERE ne.id_cliente = ?
         AND DATE(ne.${captureDateColumn}) = ?
         AND ${publicationChannelPredicate}
         AND nn.id_grupo = ?
         AND nev.metrica_codigo = ?
       GROUP BY ne.id_publicacion
     ) pub_agg`,
    [
      params.idCliente,
      params.day,
      params.channelDimension.value,
      params.idGrupo,
      params.metricaCodigo,
    ]
  );

  const acumuladoTotal = asNumber(aggRows?.[0]?.acumulado_total);
  const deltaTotal = asNumber(aggRows?.[0]?.delta_total);

  const kpiHasCanalCodigo = await hasColumn("NO_KPI_DIARIO", "canal_codigo");
  const kpiHasIdCanal = await hasColumn("NO_KPI_DIARIO", "id_canal");
  const kpiHasIdMetrica = await hasColumn("NO_KPI_DIARIO", "id_metrica");
  const kpiHasValorTotal = await hasColumn("NO_KPI_DIARIO", "valor_total");
  const kpiHasValorDelta = await hasColumn("NO_KPI_DIARIO", "valor_delta");
  const kpiHasValorAcumuladoTotal = await hasColumn("NO_KPI_DIARIO", "valor_acumulado_total");
  const kpiHasValorDeltaTotal = await hasColumn("NO_KPI_DIARIO", "valor_delta_total");

  let canalCodigoValue = "";
  if (params.channelDimension.kind === "canal_codigo") {
    canalCodigoValue = params.channelDimension.value;
  } else {
    canalCodigoValue =
      (await resolveChannelCodeById(params.channelDimension.value)) ??
      params.channelCodeHint.trim().toUpperCase();
  }

  let canalIdValue: number | null = null;
  if (params.channelDimension.kind === "id_canal") {
    canalIdValue = params.channelDimension.value;
  } else {
    canalIdValue = await resolveChannelIdByCode(params.channelDimension.value);
  }

  const columns = ["id_cliente", "fecha", "id_grupo", "id_departamento", "metrica_codigo"];
  const values: Array<number | string> = [
    params.idCliente,
    params.day,
    params.idGrupo,
    params.idDepartamento,
    params.metricaCodigo,
  ];

  if (kpiHasCanalCodigo) {
    if (canalCodigoValue) {
      columns.push("canal_codigo");
      values.push(canalCodigoValue);
    }
  }

  let insertedIdCanal = false;
  if (kpiHasIdCanal && canalIdValue !== null) {
    columns.push("id_canal");
    values.push(canalIdValue);
    insertedIdCanal = true;
  }

  let insertedIdMetrica = false;
  if (kpiHasIdMetrica && params.metricId !== null) {
    columns.push("id_metrica");
    values.push(params.metricId);
    insertedIdMetrica = true;
  }

  if (kpiHasValorAcumuladoTotal) {
    columns.push("valor_acumulado_total");
    values.push(acumuladoTotal);
  }
  if (kpiHasValorDeltaTotal) {
    columns.push("valor_delta_total");
    values.push(deltaTotal);
  }
  if (kpiHasValorTotal) {
    columns.push("valor_total");
    values.push(acumuladoTotal);
  }
  if (kpiHasValorDelta) {
    columns.push("valor_delta");
    values.push(deltaTotal);
  }

  const hasCalcVersion = await hasColumn("NO_KPI_DIARIO", "calc_version");
  if (hasCalcVersion) {
    columns.push("calc_version");
    values.push(1);
  }

  const updateColumns = [
    ...(kpiHasValorAcumuladoTotal ? ["valor_acumulado_total"] : []),
    ...(kpiHasValorDeltaTotal ? ["valor_delta_total"] : []),
    ...(kpiHasValorTotal ? ["valor_total"] : []),
    ...(kpiHasValorDelta ? ["valor_delta"] : []),
    ...(insertedIdMetrica ? ["id_metrica"] : []),
    ...(insertedIdCanal ? ["id_canal"] : []),
    ...(hasCalcVersion ? ["calc_version"] : []),
  ];
  if (!updateColumns.length) {
    throw new Error("NO_KPI_DIARIO no tiene columnas de valor compatibles.");
  }
  const updateSql = updateColumns.map((c) => `${c} = VALUES(${c})`).join(", ");

  await db.execute(
    `INSERT INTO NO_KPI_DIARIO (${columns.join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})
     ON DUPLICATE KEY UPDATE ${updateSql}`,
    values
  );
}

export async function captureNewsStats(params: CaptureStatsParams): Promise<CaptureStatsResult> {
  const tables = await hasAllTables(requiredStatsTables);
  if (!tables.ok) {
    return {
      attempted: false,
      ok: false,
      message: `KPI stats no disponible. Faltan tablas: ${tables.missing.join(", ")}`,
      insertedMetricas: 0,
    };
  }

  const [newsRows] = await db.execute<RowDataPacket[]>(
    `SELECT id_noticia
     FROM no_noticia
     WHERE id_noticia = ?
       AND id_cliente = ?
     LIMIT 1`,
    [params.newsId, params.idCliente]
  );
  if (!newsRows.length) {
    return {
      attempted: true,
      ok: false,
      message: "Noticia no encontrada en no_noticia.",
      insertedMetricas: 0,
    };
  }
  const resolvedNewsId = Number(newsRows[0].id_noticia);

  const channelCodeHint = (params.channel ?? "LINKEDIN").trim().toUpperCase() || "LINKEDIN";
  const channelDimension = await resolveChannelDimension(channelCodeHint);
  if (!channelDimension) {
    return {
      attempted: true,
      ok: false,
      message: "no_publicacion no tiene canal_codigo ni id_canal.",
      insertedMetricas: 0,
    };
  }

  const publicationChannelPredicate =
    channelDimension.kind === "canal_codigo" ? "np.canal_codigo = ?" : "np.id_canal = ?";

  const [pubRows] = await db.execute<PublicationRow[]>(
    `SELECT np.id_publicacion
     FROM no_publicacion np
     WHERE np.id_cliente = ?
       AND np.id_noticia = ?
       AND ${publicationChannelPredicate}
     LIMIT 1`,
    [params.idCliente, resolvedNewsId, channelDimension.value]
  );

  if (!pubRows.length) {
    return {
      attempted: true,
      ok: false,
      message: "No hay publicacion para esa noticia/canal.",
      insertedMetricas: 0,
    };
  }

  const idPublicacion = Number(pubRows[0].id_publicacion);
  const capturedAt = params.capturedAt ?? new Date();
  const day = toDateYmd(capturedAt);

  const [groupRows] = await db.execute<GroupDeptRow[]>(
    `SELECT nn.id_grupo, gg.id_departamento
     FROM no_noticia nn
     JOIN gr_grupo gg
       ON gg.id_grupo = nn.id_grupo
      AND gg.id_cliente = nn.id_cliente
     WHERE nn.id_noticia = ?
       AND nn.id_cliente = ?
     LIMIT 1`,
    [resolvedNewsId, params.idCliente]
  );

  if (!groupRows.length) {
    return {
      attempted: true,
      ok: false,
      message: "No se pudo resolver grupo/departamento de la noticia.",
      id_publicacion: idPublicacion,
      insertedMetricas: 0,
    };
  }

  const idGrupo = Number(groupRows[0].id_grupo);
  const idDepartamento = Number(groupRows[0].id_departamento);
  const captureDateColumn = await resolveStatsCaptureDateColumn();
  if (!captureDateColumn) {
    return {
      attempted: true,
      ok: false,
      message: "NO_ESTADISTICA no tiene fecha_captura ni fe_captura.",
      id_publicacion: idPublicacion,
      insertedMetricas: 0,
    };
  }

  const hasFeCaptura = await hasColumn("NO_ESTADISTICA", "fe_captura");
  const hasFechaCaptura = await hasColumn("NO_ESTADISTICA", "fecha_captura");

  const snapshotColumns = ["id_publicacion", "id_cliente", "origen"];
  const snapshotValues: Array<number | string | Date> = [
    idPublicacion,
    params.idCliente,
    params.origin ?? "API_NEWS_STATS",
  ];

  if (hasFeCaptura) {
    snapshotColumns.push("fe_captura");
    snapshotValues.push(capturedAt);
  }
  if (hasFechaCaptura) {
    snapshotColumns.push("fecha_captura");
    snapshotValues.push(capturedAt);
  }

  const [snapshotIns] = await db.execute<ResultSetHeader>(
    `INSERT INTO NO_ESTADISTICA
     (${snapshotColumns.join(", ")})
     VALUES (${snapshotColumns.map(() => "?").join(", ")})`,
    snapshotValues
  );
  const idEstadistica = Number(snapshotIns.insertId);

  const normalizedEntries = Object.entries(params.metrics)
    .map(([metric, value]) => [normalizeMetricCode(metric), Number(value)] as const)
    .filter(([metric, value]) => metric.length > 0 && Number.isFinite(value) && value >= 0);

  let insertedMetricas = 0;
  const hasMetricIdInStatsValue = await hasColumn("NO_ESTADISTICA_VALOR", "id_metrica");

  for (const [metricCode, acumulado] of normalizedEntries) {
    const metricId = await resolveMetricIdByCode(metricCode);
    const allowed = await isMetricAllowedForChannel(params.idCliente, channelDimension, metricCode, metricId);
    if (!allowed) continue;

    const [prevRows] = await db.execute<PreviousMetricRow[]>(
      `SELECT nev.valor_acumulado
       FROM NO_ESTADISTICA ne
       JOIN NO_ESTADISTICA_VALOR nev
         ON nev.id_estadistica = ne.id_estadistica
       WHERE ne.id_publicacion = ?
         AND nev.metrica_codigo = ?
         AND ne.id_estadistica <> ?
       ORDER BY ne.${captureDateColumn} DESC, ne.id_estadistica DESC
       LIMIT 1`,
      [idPublicacion, metricCode, idEstadistica]
    );

    const previous = prevRows.length ? asNumber(prevRows[0].valor_acumulado) : 0;
    const delta = acumulado - previous;

    const metricValueColumns = ["id_estadistica", "metrica_codigo", "valor_acumulado", "valor_delta"];
    const metricValueParams: Array<number | string> = [idEstadistica, metricCode, acumulado, delta];
    if (hasMetricIdInStatsValue && metricId !== null) {
      metricValueColumns.push("id_metrica");
      metricValueParams.push(metricId);
    }

    await db.execute(
      `INSERT INTO NO_ESTADISTICA_VALOR
       (${metricValueColumns.join(", ")})
       VALUES (${metricValueColumns.map(() => "?").join(", ")})`,
      metricValueParams
    );
    insertedMetricas += 1;

    await recalculateDailyKpi({
      idCliente: params.idCliente,
      idGrupo,
      idDepartamento,
      channelDimension,
      channelCodeHint,
      metricaCodigo: metricCode,
      metricId,
      day,
    });
  }

  return {
    attempted: true,
    ok: true,
    message: "",
    id_publicacion: idPublicacion,
    insertedMetricas,
  };
}
