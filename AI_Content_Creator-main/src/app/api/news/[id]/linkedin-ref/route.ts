import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveSessionContext } from "@/lib/session-context";
import { fetchLinkedInPostStats } from "@/lib/linkedin";
import { captureNewsStats } from "@/lib/news-stats";

type LinkBody = {
  postRef?: unknown;
};

type PublicationRow = RowDataPacket & {
  id_publicacion: number;
};

type ResolvedNewsRow = RowDataPacket & {
  id_noticia: number;
};

const tableCache: Record<string, boolean | undefined> = {};
const columnCache: Record<string, boolean | undefined> = {};

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toErrorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function humanizeLinkedInWarning(message: string) {
  if (/partnerApiMemberCreatorPostAnalytics\.FINDER-entity/i.test(message)) {
    return (
      "LinkedIn no permite leer IMPRESIONES porque esta aplicacion no esta autorizada " +
      "para r_member_postAnalytics (Community Management API)."
    );
  }
  return message;
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
  const idCanal = Number(rows[0].id_canal);
  return Number.isFinite(idCanal) ? idCanal : null;
}

async function resolveNewsId(newsId: number, idCliente: number) {
  const newsHasActiveFlag = await hasColumn("no_noticia", "fg_activo");
  const [newsRows] = await db.execute<ResolvedNewsRow[]>(
    `SELECT id_noticia
     FROM no_noticia
     WHERE id_noticia = ?
       AND id_cliente = ?
       ${newsHasActiveFlag ? "AND fg_activo = 1" : ""}
     LIMIT 1`,
    [newsId, idCliente]
  );
  if (!newsRows.length) return null;
  const resolved = Number(newsRows[0].id_noticia);
  return Number.isFinite(resolved) ? resolved : null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const context = await resolveSessionContext(session);
    if (context.role !== "admin") {
      return NextResponse.json({ error: "Solo admin puede vincular referencias de LinkedIn." }, { status: 403 });
    }

    const { id } = await params;
    const newsId = Number(id);
    if (!Number.isSafeInteger(newsId) || newsId <= 0) {
      return NextResponse.json({ error: "ID de noticia invalido." }, { status: 400 });
    }

    let body: LinkBody = {};
    try {
      const raw = await req.json();
      body = typeof raw === "object" && raw !== null ? (raw as LinkBody) : {};
    } catch {
      body = {};
    }

    const postRef = toNonEmptyString(body.postRef);
    if (!postRef) {
      return NextResponse.json({ error: "Debes enviar `postRef` con URL o URN de LinkedIn." }, { status: 400 });
    }

    const resolvedNewsId = await resolveNewsId(newsId, context.id_cliente);
    if (!resolvedNewsId) {
      return NextResponse.json({ error: "Noticia no encontrada." }, { status: 404 });
    }

    const publicationHasCanalCodigo = await hasColumn("no_publicacion", "canal_codigo");
    const publicationHasIdCanal = await hasColumn("no_publicacion", "id_canal");
    if (!publicationHasCanalCodigo && !publicationHasIdCanal) {
      return NextResponse.json(
        { error: "no_publicacion no tiene canal_codigo ni id_canal para vincular LinkedIn." },
        { status: 400 }
      );
    }

    const publicationHasEstado = await hasColumn("no_publicacion", "estado_publicacion");
    const publicationHasFePublicada = await hasColumn("no_publicacion", "fe_publicada");
    const publicationHasFechaPublicacion = await hasColumn("no_publicacion", "fecha_publicacion");
    const publicationHasUrlPublicada = await hasColumn("no_publicacion", "url_publicada");
    const publicationHasPayloadJson = await hasColumn("no_publicacion", "payload_respuesta_json");

    const insertColumns = ["id_cliente", "id_noticia"];
    const insertValues: Array<number | string | Date | null> = [context.id_cliente, resolvedNewsId];
    const updateClauses: string[] = [];
    let selectChannelPredicate = "";
    let selectChannelValue: number | string = "LINKEDIN";

    if (publicationHasCanalCodigo) {
      insertColumns.push("canal_codigo");
      insertValues.push("LINKEDIN");
      selectChannelPredicate = "canal_codigo = ?";
      selectChannelValue = "LINKEDIN";
    } else {
      const linkedinChannelId = (await resolveChannelIdByCode("LINKEDIN")) ?? 1;
      insertColumns.push("id_canal");
      insertValues.push(linkedinChannelId);
      selectChannelPredicate = "id_canal = ?";
      selectChannelValue = linkedinChannelId;
    }

    if (publicationHasEstado) {
      insertColumns.push("estado_publicacion");
      insertValues.push("PUBLICADO");
      updateClauses.push("estado_publicacion = VALUES(estado_publicacion)");
    }

    if (publicationHasFePublicada) {
      insertColumns.push("fe_publicada");
      insertValues.push(new Date());
      updateClauses.push("fe_publicada = VALUES(fe_publicada)");
    }

    if (publicationHasFechaPublicacion) {
      insertColumns.push("fecha_publicacion");
      insertValues.push(new Date());
      updateClauses.push("fecha_publicacion = VALUES(fecha_publicacion)");
    }

    if (publicationHasUrlPublicada) {
      insertColumns.push("url_publicada");
      insertValues.push(postRef);
      updateClauses.push("url_publicada = VALUES(url_publicada)");
    }

    if (publicationHasPayloadJson) {
      insertColumns.push("payload_respuesta_json");
      insertValues.push(JSON.stringify({ postRef }));
      updateClauses.push("payload_respuesta_json = VALUES(payload_respuesta_json)");
    }

    const [upsertRes] = await db.execute<ResultSetHeader>(
      `INSERT INTO no_publicacion (${insertColumns.join(", ")})
       VALUES (${insertColumns.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE
         ${updateClauses.length ? updateClauses.join(", ") : "id_noticia = VALUES(id_noticia)"}`,
      insertValues
    );

    let idPublicacion = Number.isFinite(Number(upsertRes.insertId)) && Number(upsertRes.insertId) > 0
      ? Number(upsertRes.insertId)
      : null;

    if (!idPublicacion) {
      const [pubRows] = await db.execute<PublicationRow[]>(
        `SELECT id_publicacion
         FROM no_publicacion
         WHERE id_cliente = ?
           AND id_noticia = ?
           AND ${selectChannelPredicate}
         LIMIT 1`,
        [context.id_cliente, resolvedNewsId, selectChannelValue]
      );
      idPublicacion = pubRows.length ? Number(pubRows[0].id_publicacion) : null;
    }

    const warnings: string[] = [];
    let insertedMetricas = 0;
    let captured = false;

    try {
      const postStats = await fetchLinkedInPostStats({
        idCliente: context.id_cliente,
        postRef,
      });

      const metrics = Object.fromEntries(
        Object.entries(postStats.metrics).filter(([, value]) => Number.isFinite(value) && value >= 0)
      );

      if (Object.keys(metrics).length) {
        const capturedRes = await captureNewsStats({
          newsId,
          idCliente: context.id_cliente,
          channel: "LINKEDIN",
          capturedAt: new Date(),
          origin: "LINKEDIN_LINK_MANUAL",
          metrics,
        });
        captured = capturedRes.ok;
        insertedMetricas = capturedRes.insertedMetricas;
        if (!capturedRes.ok && capturedRes.message) {
          warnings.push(capturedRes.message);
        }
      } else {
        warnings.push("LinkedIn no devolvio metricas para el post indicado.");
      }

      if (postStats.warnings.length > 0) {
        warnings.push(...postStats.warnings);
      }
    } catch (e: unknown) {
      warnings.push(humanizeLinkedInWarning(toErrorMessage(e)));
    }

    return NextResponse.json({
      ok: true,
      postRef,
      id_publicacion: idPublicacion,
      captured,
      insertedMetricas,
      warnings: warnings.slice(0, 10),
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    console.error("POST /api/news/[id]/linkedin-ref failed:", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
