import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserAlcance } from "@/lib/departamentos";

type ScopeRow = RowDataPacket & {
  id_area: number;
  area_nombre: string;
  id_departamento: number;
  departamento_nombre: string;
};

export async function GET() {
  try {
    const session = await requireSession();
    const { id_cliente } = await getClienteByCodigo(session.codigo_cliente);
    const alcance = await getUserAlcance(db, session.uid, id_cliente);

    const [rows] =
      alcance === "TENANT_COMPLETO"
        ? await db.query<ScopeRow[]>(
            `SELECT DISTINCT
                a.id_area,
                a.nombre AS area_nombre,
                d.id_departamento,
                d.nombre AS departamento_nombre
             FROM or_departamento d
             JOIN or_area a
               ON a.id_area = d.id_area
              AND a.id_cliente = d.id_cliente
              AND a.fg_activo = 1
             WHERE d.id_cliente = ?
               AND d.fg_activo = 1
             ORDER BY a.nombre ASC, d.nombre ASC, d.id_departamento ASC`,
            [id_cliente]
          )
        : await db.query<ScopeRow[]>(
            `SELECT DISTINCT
                a.id_area,
                a.nombre AS area_nombre,
                d.id_departamento,
                d.nombre AS departamento_nombre
             FROM us_usuario_departamento ud
             JOIN or_departamento d
               ON d.id_departamento = ud.id_departamento
              AND d.id_cliente = ?
              AND d.fg_activo = 1
             JOIN or_area a
               ON a.id_area = d.id_area
              AND a.id_cliente = d.id_cliente
              AND a.fg_activo = 1
             WHERE ud.id_usuario = ?
             ORDER BY a.nombre ASC, d.nombre ASC, d.id_departamento ASC`,
            [id_cliente, session.uid]
          );

    const areaMap = new Map<
      number,
      {
        id_area: number;
        nombre: string;
        departamentos: Array<{ id_departamento: number; nombre: string }>;
      }
    >();
    const depSeen = new Set<number>();
    const areaDepSeen = new Set<string>();
    const departamentos: Array<{
      id_departamento: number;
      nombre: string;
      id_area: number;
      area_nombre: string;
    }> = [];

    for (const row of rows) {
      const idArea = Number(row.id_area);
      const idDepartamento = Number(row.id_departamento);
      const areaNombre = String(row.area_nombre ?? "").trim();
      const depNombre = String(row.departamento_nombre ?? "").trim();

      if (!Number.isSafeInteger(idArea) || idArea <= 0) continue;
      if (!Number.isSafeInteger(idDepartamento) || idDepartamento <= 0) continue;
      if (!areaNombre || !depNombre) continue;

      if (!areaMap.has(idArea)) {
        areaMap.set(idArea, {
          id_area: idArea,
          nombre: areaNombre,
          departamentos: [],
        });
      }

      const areaDepKey = `${idArea}:${idDepartamento}`;
      if (!areaDepSeen.has(areaDepKey)) {
        areaDepSeen.add(areaDepKey);
        areaMap.get(idArea)?.departamentos.push({
          id_departamento: idDepartamento,
          nombre: depNombre,
        });
      }

      if (!depSeen.has(idDepartamento)) {
        depSeen.add(idDepartamento);
        departamentos.push({
          id_departamento: idDepartamento,
          nombre: depNombre,
          id_area: idArea,
          area_nombre: areaNombre,
        });
      }
    }

    const areas = Array.from(areaMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    for (const area of areas) {
      area.departamentos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    }
    departamentos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    return NextResponse.json({
      ok: true,
      data: {
        areas,
        departamentos,
        singleDepartamento: departamentos.length === 1,
      },
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    console.error("GET /api/organization/scope failed:", e);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
