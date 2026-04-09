import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserDepartamentoAccess } from "@/lib/departamentos";
import { validateFuenteInput } from "@/lib/fuentes";

// ✅ CAMBIO: tipamos conn y resultados de query
import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";

/**
 * ✅ CAMBIO: parsea "HH:MM" de <Input type="time" />
 * Si no viene o viene mal, usa fallback (09:00).
 */
function parseHora(hora: unknown, fallback = "09:00"): { h: number; m: number } {
  const s = String(hora ?? "").trim();
  const v = s || fallback;

  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return { h: 9, m: 0 };

  const hh = Number(m[1]);
  const mm = Number(m[2]);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return { h: 9, m: 0 };
  if (hh < 0 || hh > 23) return { h: 9, m: 0 };
  if (mm < 0 || mm > 59) return { h: 9, m: 0 };

  return { h: hh, m: mm };
}

/**
 * ✅ CAMBIO: freq -> cron incluyendo HORA y MINUTO.
 * cron: "min hour dom month dow"
 */
function freqToCron(freq: string, hora?: unknown): string {
  const { h, m } = parseHora(hora);
  switch (freq) {
    case "diario":
      return `${m} ${h} * * *`;
    case "mensual":
      return `${m} ${h} 1 * *`;
    case "semanal":
    default:
      return `${m} ${h} * * 1`; // lunes
  }
}

function cronToFreq(cron: string | null | undefined): "diario" | "semanal" | "mensual" {
  const parts = String(cron ?? "").trim().split(/\s+/);
  if (parts.length < 5) return "semanal";

  const dom = parts[2];
  const month = parts[3];
  const dow = parts[4];

  if (dom === "1" && month === "*" && dow === "*") return "mensual";
  if (dom === "*" && month === "*" && dow === "1") return "semanal";
  if (dom === "*" && month === "*" && dow === "*") return "diario";

  return "semanal";
}

function cronToHora(cron: string | null | undefined, fallback = "09:00"): string {
  const parts = String(cron ?? "").trim().split(/\s+/);
  if (parts.length < 2) return fallback;

  const min = Number(parts[0]);
  const hour = Number(parts[1]);

  if (!Number.isFinite(min) || !Number.isFinite(hour)) return fallback;
  if (hour < 0 || hour > 23 || min < 0 || min > 59) return fallback;

  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number((rows?.[0] as any)?.c ?? 0) > 0;
}

async function ensureDefaultDepartamento(conn: PoolConnection, id_cliente: number): Promise<number> {
  // 1) ¿Hay algún departamento activo?
  const [deps] = await conn.query<RowDataPacket[]>(
    `SELECT d.id_departamento
     FROM or_departamento d
     WHERE d.id_cliente = ? AND d.fg_activo = 1
     ORDER BY d.id_departamento ASC
     LIMIT 1`,
    [id_cliente]
  );
  if (deps.length) return Number((deps[0] as any).id_departamento);

  // 2) Crear Área "GENERAL" (si no existe)
  let id_area: number;

  const [areas] = await conn.query<RowDataPacket[]>(
    `SELECT id_area
     FROM or_area
     WHERE id_cliente = ? AND nombre = 'GENERAL'
     LIMIT 1`,
    [id_cliente]
  );

  if (areas.length) {
    id_area = Number((areas[0] as any).id_area);
  } else {
    const [insA] = await conn.query<ResultSetHeader>(
      `INSERT INTO or_area (id_cliente, nombre, fg_activo)
       VALUES (?, 'GENERAL', 1)`,
      [id_cliente]
    );
    id_area = Number(insA.insertId);
  }

  // 3) Crear Departamento "GENERAL"
  const [insD] = await conn.query<ResultSetHeader>(
    `INSERT INTO or_departamento (id_cliente, id_area, nombre, fg_activo)
     VALUES (?, ?, 'GENERAL', 1)`,
    [id_cliente, id_area]
  );

  return Number(insD.insertId);
}

/** ✅ CAMBIO: conn tipado */
async function ensureFuenteId(conn: PoolConnection, id_cliente: number, nombre: string): Promise<number> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id_fuente
     FROM fu_fuente
     WHERE id_cliente = ? AND nombre = ?
     LIMIT 1`,
    [id_cliente, nombre]
  );
  if (rows.length) return Number((rows[0] as any).id_fuente);

  const [ins] = await conn.query<ResultSetHeader>(
    `INSERT INTO fu_fuente (id_cliente, nombre, tipo_fuente, url, fg_activo)
     VALUES (?, ?, 'MANUAL', NULL, 1)`,
    [id_cliente, nombre]
  );
  return Number(ins.insertId);
}

export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const { id_cliente } = await getClienteByCodigo(s.codigo_cliente);

    const access = await getUserDepartamentoAccess(db, s.uid, id_cliente);
    const depIds = access.departamentoIds;
    const mustRestrictByAccess = access.alcance === "DEPARTAMENTOS_ASIGNADOS";

    if (mustRestrictByAccess && !depIds.length) {
      return NextResponse.json({ ok: true, data: [] });
    }

    const { searchParams } = new URL(req.url);
    const requestedDepRaw = String(searchParams.get("id_departamento") ?? "").trim();
    let filterDepIds: number[] | null = mustRestrictByAccess ? depIds : null;

    if (requestedDepRaw) {
      const requestedDep = Number(requestedDepRaw);
      if (!Number.isSafeInteger(requestedDep) || requestedDep <= 0) {
        return NextResponse.json({ error: "id_departamento invalido" }, { status: 400 });
      }
      if (!depIds.includes(requestedDep)) {
        return NextResponse.json({ error: "No tienes acceso a ese departamento" }, { status: 403 });
      }
      filterDepIds = [requestedDep];
    }

    const hasIdioma = await columnExists("gr_grupo", "idioma");
    void hasIdioma;

    const whereDepartamento = filterDepIds
      ? ` AND g.id_departamento IN (${filterDepIds.map(() => "?").join(",")})`
      : "";

    const queryParams: number[] = [id_cliente, id_cliente, ...(filterDepIds ?? [])];

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT
     g.id_grupo,
     g.nombre,
     g.descripcion,
     g.objetivo_diario,
     g.idioma,
     p.cron_expr,
     COALESCE(nc.c, 0) AS noticias_count
   FROM gr_grupo g
   LEFT JOIN gr_planificacion p
     ON p.id_grupo = g.id_grupo AND p.id_cliente = g.id_cliente
   LEFT JOIN (
     SELECT id_grupo, COUNT(*) AS c
     FROM no_noticia
     WHERE id_cliente = ?
     GROUP BY id_grupo
   ) nc ON nc.id_grupo = g.id_grupo
   WHERE g.id_cliente = ?
     AND g.fg_activo = 1
     ${whereDepartamento}
   ORDER BY g.id_grupo DESC`,
      queryParams
    );

    const ids = rows.map((r) => Number((r as any).id_grupo)).filter((x) => Number.isFinite(x));

    // Fuentes por grupo
    const sourcesByGroup = new Map<number, string[]>();
    if (ids.length) {
      const [srcRows] = await db.query<RowDataPacket[]>(
        `SELECT rg.id_grupo, f.nombre
         FROM fu_rl_gr rg
         JOIN fu_fuente f
           ON f.id_fuente = rg.id_fuente
          AND f.id_cliente = rg.id_cliente
          AND f.fg_activo = 1
         WHERE rg.id_cliente = ?
           AND rg.fg_activo = 1
           AND rg.id_grupo IN (${ids.map(() => "?").join(",")})`,
        [id_cliente, ...ids]
      );

      for (const r of srcRows) {
        const gid = Number((r as any).id_grupo);
        const name = String((r as any).nombre ?? "").trim();
        if (!name) continue;
        const prev = sourcesByGroup.get(gid) ?? [];
        prev.push(name);
        sourcesByGroup.set(gid, prev);
      }

      for (const [gid, list] of sourcesByGroup) {
        sourcesByGroup.set(gid, Array.from(new Set(list)));
      }
    }

    const data = rows.map((r) => {
      const gid = Number((r as any).id_grupo);
      const cron = String((r as any).cron_expr ?? "");
      return {
        id: gid,
        tema: String((r as any).nombre ?? ""),
        descripcion: (r as any).descripcion ?? null,
        frecuencia: cronToFreq(cron),

        // devolvemos la hora (por si el front la quiere mostrar)
        hora: cronToHora(cron),

        cantidad: Number((r as any).objetivo_diario ?? 1),
        idioma: String((r as any).idioma ?? "es"),
        sources: sourcesByGroup.get(gid) ?? [],
        utilizado: Number((r as any).noticias_count ?? 0) > 0 ? "Si" : "No",
      };
    });

    return NextResponse.json({ ok: true, data });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
}







function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIdiomaForN8n(value: string): "es" | "en" {
  const v = String(value ?? "").trim().toLowerCase();
  if (v.startsWith("en") || v.includes("ingl")) return "en";
  return "es";
}

type N8nWebhookTarget = {
  kind: "production" | "test";
  url: string;
};

function resolveN8nWebhookTargets(): N8nWebhookTarget[] {
  const productionUrl = toTrimmedString(process.env.N8N_WEBHOOK_URL);
  const testUrl = toTrimmedString(process.env.N8N_WEBHOOK_TEST_URL);
  const modeRaw = toTrimmedString(process.env.N8N_WEBHOOK_MODE).toLowerCase();
  const mode =
    modeRaw === "production" || modeRaw === "test" || modeRaw === "auto" ? modeRaw : "";
  const targets: N8nWebhookTarget[] = [];

  if (mode === "production") {
    if (productionUrl) targets.push({ kind: "production", url: productionUrl });
    return targets;
  }

  if (mode === "test") {
    if (testUrl) targets.push({ kind: "test", url: testUrl });
    if (productionUrl && productionUrl !== testUrl) targets.push({ kind: "production", url: productionUrl });
    return targets;
  }

  // auto/default: produccion primero, test como fallback.
  if (productionUrl) targets.push({ kind: "production", url: productionUrl });
  if (testUrl && testUrl !== productionUrl) targets.push({ kind: "test", url: testUrl });

  return targets;
}

function isWebhookNotRegistered(status: number, message: string): boolean {
  if (status !== 404) return false;
  return /not registered/i.test(message);
}

type N8nTriggerResult = {
  attempted: boolean;
  ok: boolean;
  status: number;
  message: string;
};

async function triggerN8nPlanningWebhook(
  payload: Record<string, unknown>
): Promise<N8nTriggerResult> {
  const webhookTargets = resolveN8nWebhookTargets();

  if (!webhookTargets.length) {
    return {
      attempted: false,
      ok: false,
      status: 0,
      message: "N8N webhook URL no configurada (N8N_WEBHOOK_URL)",
    };
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  const token = toTrimmedString(process.env.N8N_WEBHOOK_TOKEN);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers["x-webhook-token"] = token;
  }

  const timeoutRaw = Number(process.env.N8N_WEBHOOK_TIMEOUT_MS ?? 20000);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 20000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let i = 0; i < webhookTargets.length; i++) {
      const target = webhookTargets[i];
      const isLastTarget = i === webhookTargets.length - 1;

      const res = await fetch(target.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      });

      let message = "";
      try {
        message = (await res.text()).slice(0, 500);
      } catch {
        message = "";
      }

      if (res.ok) {
        return {
          attempted: true,
          ok: true,
          status: res.status,
          message:
            target.kind === "test"
              ? i > 0
                ? "N8N production webhook no registrado; se uso N8N_WEBHOOK_TEST_URL"
                : "Se uso N8N_WEBHOOK_TEST_URL"
              : "",
        };
      }

      // Si la URL de producciÃ³n no estÃ¡ registrada, intentamos URL de test (si existe).
      const shouldTryFallback =
        !isLastTarget &&
        target.kind === "production" &&
        isWebhookNotRegistered(res.status, message);

      if (shouldTryFallback) {
        continue;
      }

      return {
        attempted: true,
        ok: false,
        status: res.status,
        message: `[${target.kind}] ${message}`.trim(),
      };
    }

    return {
      attempted: true,
      ok: false,
      status: 0,
      message: "No se pudo ejecutar ningÃºn webhook de n8n",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        attempted: true,
        ok: false,
        status: 0,
        message: `Timeout esperando respuesta de n8n (${timeoutMs}ms)`,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}







export async function POST(req: Request) {
  // ✅ CAMBIO: tipamos conn como PoolConnection
  const conn: PoolConnection = await db.getConnection();
  try {
    const s = await requireSession();
    const { id_cliente } = await getClienteByCodigo(s.codigo_cliente);
    const body = await req.json();

    const tema = String(body.tema ?? "").trim();
    const descripcion = body.descripcion ? String(body.descripcion) : null;
    const frecuencia = String(body.frecuencia ?? "semanal");
    const cantidad = Number(body.cantidad ?? 1);
    const idioma = String(body.idioma ?? "es");
    const sourceCandidates = Array.isArray(body.sources)
      ? body.sources.map(String).map((x: string) => x.trim()).filter(Boolean)
      : [];
    const validatedSources: string[] = [];

    for (const source of sourceCandidates) {
      const validation = validateFuenteInput(source);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
      if (validation.value) validatedSources.push(validation.value);
    }

    const sources = Array.from(new Set(validatedSources));

    // leemos la hora que viene del genero-dialog ("HH:MM")
    const hora = body.hora ?? null;

    if (!tema) return NextResponse.json({ error: "El tema es obligatorio" }, { status: 400 });
    if (!Number.isFinite(cantidad) || cantidad < 1) return NextResponse.json({ error: "Cantidad inválida" }, { status: 400 });


    await conn.beginTransaction();

    const access = await getUserDepartamentoAccess(conn, s.uid, id_cliente);
    let userDepIds = [...access.departamentoIds];

    // En TENANT_COMPLETO usamos todos los departamentos activos del cliente.
    // Si todavía no existe ninguno, creamos/recuperamos GENERAL para permitir crear grupos.
    if (access.alcance === "TENANT_COMPLETO" && !userDepIds.length) {
      const fallbackDep = await ensureDefaultDepartamento(conn, id_cliente);
      userDepIds = [fallbackDep];
    }

    if (!userDepIds.length) { //  mismo caso de error pero ahora sobre userDepIds
      await conn.rollback(); //  cerramos la transacción antes de salir
      return NextResponse.json(
        { error: "Usuario sin departamento asignado" },
        { status: 403 }
      );
    }

    const requestedDepId = body.id_departamento ?? body.departamentoId ?? null; // permitimos seleccionar departamento desde el front
    let id_departamento: number; // se decide por body o fallback

    if (requestedDepId != null && String(requestedDepId).trim() !== "") { // si viene informado, lo validamos
      const cand = Number(requestedDepId); //lo convertimos a number
      if (!Number.isSafeInteger(cand) || cand <= 0) { // validación básica
        await conn.rollback();
        return NextResponse.json({ error: "Departamento inválido" }, { status: 400 });
      }
      if (!userDepIds.includes(cand)) { // seguridad multi-departamento
        await conn.rollback();
        return NextResponse.json({ error: "No tienes acceso a ese departamento" }, { status: 403 });
      }
      id_departamento = cand; // usamos el departamento solicitado
    } else {
      id_departamento = userDepIds[0]; //  compatibilidad: si no se especifica, usamos el primero asignado
    }

// 1) Crear grupo
let id_grupo: number;

const [insG] = await conn.query<ResultSetHeader>(
  `INSERT INTO gr_grupo (id_cliente, id_departamento, nombre, descripcion, objetivo_diario, idioma, id_autor, fg_activo)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1)`, 
  [id_cliente, id_departamento, tema, descripcion, cantidad, idioma, s.uid] 
);

id_grupo = Number(insG.insertId);

    // 2) Planificación 1:1
    // cron_expr ahora incluye la hora seleccionada
    const cron_expr = freqToCron(frecuencia, hora);

    await conn.query(
      `INSERT INTO gr_planificacion (id_cliente, id_grupo, cron_expr, timezone, fg_activa)
       VALUES (?, ?, ?, 'Europe/Madrid', 1)
       ON DUPLICATE KEY UPDATE cron_expr = VALUES(cron_expr), fg_activa = 1`,
      [id_cliente, id_grupo, cron_expr]
    );

    // 3) Fuentes
    for (const f of sources) {
      const id_fuente = await ensureFuenteId(conn, id_cliente, f);
      await conn.query(
        `INSERT INTO fu_rl_gr (id_cliente, id_fuente, id_grupo, fg_activo)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE fg_activo = 1`,
        [id_cliente, id_fuente, id_grupo]
      );
    }


await conn.commit();

let n8nTriggered = false;
let n8nStatus = 0;
let n8nMessage = "";

try {
  const trigger = await triggerN8nPlanningWebhook({
    source: "aicc-daniel",
    id_cliente,
    id_grupo,
    generoId: id_grupo, // alias temporal para compatibilidad
    id_departamento,
    id_autor: s.uid,
    tema,
    descripcion,
    frecuencia,
    cron_expr,
    timezone: "Europe/Madrid",
    cantidad,
    idioma: normalizeIdiomaForN8n(idioma),
    idioma_label: idioma,
    sources,
  });

  n8nTriggered = trigger.attempted && trigger.ok;
  n8nStatus = trigger.status;
  n8nMessage = trigger.message;

  if (trigger.attempted && !trigger.ok) {
    console.error("N8N webhook returned non-OK status:", trigger.status, trigger.message);
  }
} catch (webhookError) {
  console.error("N8N webhook call failed:", webhookError);
  n8nMessage =
    webhookError instanceof Error
      ? webhookError.message
      : "Error desconocido llamando a n8n";
}

return NextResponse.json({
  ok: true,
  generoId: id_grupo,
  n8nTriggered,
  n8nStatus,
  n8nMessage,
});


} catch (e: any) {
  try { await conn.rollback(); } catch {}

  if (String(e?.code) === "ER_DUP_ENTRY") {
    return NextResponse.json({ error: "Ya existe un género con ese nombre" }, { status: 409 });
  }

  console.error("POST /api/genres error:", {
    code: e?.code,
    message: e?.message,
    sqlMessage: e?.sqlMessage,
    sql: e?.sql,
  });

  return NextResponse.json(
    {
      error: "Error al crear género",
      debug:
        process.env.NODE_ENV !== "production"
          ? { code: e?.code, message: e?.message, sqlMessage: e?.sqlMessage }
          : undefined,
    },
    { status: 500 }
  );
} finally {
  conn.release();
}
}
