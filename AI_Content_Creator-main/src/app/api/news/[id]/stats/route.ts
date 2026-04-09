import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { requireSession } from "@/lib/auth";
import { resolveSessionContext } from "@/lib/session-context";
import { db } from "@/lib/db";
import { captureNewsStats } from "@/lib/news-stats";

type StatsMetricArrayItem = {
  codigo?: unknown;
  valor_acumulado?: unknown;
  value?: unknown;
};

type StatsPayload = {
  channel?: unknown;
  fecha_captura?: unknown;
  origen?: unknown;
  metrics?: unknown;
  valores?: unknown;
};

type NewsClienteRow = RowDataPacket & {
  id_cliente: number;
};

function normalizeChannel(value: unknown) {
  if (typeof value !== "string") return "LINKEDIN";
  const channel = value.trim().toUpperCase();
  return channel || "LINKEDIN";
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

function parseMetricsObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {} as Record<string, number>;
  const entries = Object.entries(value as Record<string, unknown>);
  return Object.fromEntries(
    entries
      .map(([key, raw]) => [key, Number(raw)] as const)
      .filter(([, num]) => Number.isFinite(num) && num >= 0)
  ) as Record<string, number>;
}

function parseMetricArray(value: unknown) {
  if (!Array.isArray(value)) return {} as Record<string, number>;

  const entries = value
    .map((item) => (typeof item === "object" && item !== null ? (item as StatsMetricArrayItem) : {}))
    .map((item) => {
      const key = typeof item.codigo === "string" ? item.codigo : "";
      const rawValue = item.valor_acumulado ?? item.value;
      return [key, Number(rawValue)] as const;
    })
    .filter(([key, num]) => key.trim().length > 0 && Number.isFinite(num) && num >= 0);

  return Object.fromEntries(entries) as Record<string, number>;
}

function mergeMetrics(primary: Record<string, number>, secondary: Record<string, number>) {
  return {
    ...secondary,
    ...primary,
  };
}

function hasValidToken(req: Request) {
  const incoming = req.headers.get("x-stats-token")?.trim() ?? "";
  if (!incoming) return false;

  const allowed = [
    process.env.NEWS_STATS_TOKEN?.trim() ?? "",
    process.env.NEWS_INGEST_V2_TOKEN?.trim() ?? "",
    process.env.NEWS_INGEST_TOKEN?.trim() ?? "",
  ].filter(Boolean);

  if (!allowed.length) return false;
  return allowed.includes(incoming);
}

async function resolveNewsClienteId(newsId: number) {
  const [rows] = await db.execute<NewsClienteRow[]>(
    `SELECT id_cliente
     FROM no_noticia
     WHERE id_noticia = ?
     LIMIT 1`,
    [newsId]
  );
  if (!rows.length) return null;
  const idCliente = Number(rows[0].id_cliente);
  return Number.isFinite(idCliente) ? idCliente : null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const newsId = Number(id);
    if (!Number.isSafeInteger(newsId) || newsId <= 0) {
      return NextResponse.json({ error: "ID invalido" }, { status: 400 });
    }

    let idCliente: number | undefined;
    if (hasValidToken(req)) {
      const resolved = await resolveNewsClienteId(newsId);
      if (!resolved) {
        return NextResponse.json({ error: "Noticia no encontrada." }, { status: 404 });
      }
      idCliente = resolved;
    } else {
      const session = await requireSession();
      const context = await resolveSessionContext(session);
      idCliente = context.id_cliente;

      if (context.role !== "admin") {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
    }

    const payload = typeof body === "object" && body !== null ? (body as StatsPayload) : {};
    const channel = normalizeChannel(payload.channel);
    const capturedAt = normalizeDate(payload.fecha_captura);
    const origin = typeof payload.origen === "string" ? payload.origen.trim() : "";

    const metricsFromObject = parseMetricsObject(payload.metrics);
    const metricsFromArray = parseMetricArray(payload.valores);
    const mergedMetrics = mergeMetrics(metricsFromObject, metricsFromArray);

    if (!Object.keys(mergedMetrics).length) {
      return NextResponse.json(
        {
          error:
            "Debes enviar metricas en `metrics` (objeto) o `valores` (array con codigo/valor_acumulado).",
        },
        { status: 400 }
      );
    }

    if (!idCliente) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const result = await captureNewsStats({
      newsId,
      idCliente,
      channel,
      capturedAt,
      origin: origin || undefined,
      metrics: mergedMetrics,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.message || "No se pudieron guardar estadisticas KPI",
          insertedMetricas: result.insertedMetricas,
        },
        { status: result.attempted ? 400 : 503 }
      );
    }

    return NextResponse.json({
      ok: true,
      id_publicacion: result.id_publicacion,
      insertedMetricas: result.insertedMetricas,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    console.error("POST /api/news/[id]/stats failed:", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
