import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { getClienteByCodigo } from "@/lib/tenant";
import { getUserDepartamentoAccess } from "@/lib/departamentos";
import type { ResultSetHeader } from "mysql2/promise";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireSession();
    const { id_cliente } = await getClienteByCodigo(s.codigo_cliente);

    const access = await getUserDepartamentoAccess(db, s.uid, id_cliente);
    const depIds = access.departamentoIds;
    if (access.alcance === "DEPARTAMENTOS_ASIGNADOS" && !depIds.length) {
      return NextResponse.json({ error: "Usuario sin departamento asignado" }, { status: 403 });
    }

    const { id: idParam } = await ctx.params;
    const raw = decodeURIComponent(String(idParam ?? ""));
    const id = parseInt(raw, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "ID inválido", debug: { received: raw } }, { status: 400 });
    }

    const whereDepartamento =
      access.alcance === "TENANT_COMPLETO"
        ? ""
        : `
         AND id_departamento IN (${depIds.map(() => "?").join(",")})`;

    const params: number[] = [id_cliente, id];
    if (access.alcance !== "TENANT_COMPLETO") {
      params.push(...depIds);
    }

    const [r1] = await db.query<ResultSetHeader>(
      `UPDATE gr_grupo
       SET fg_activo = 0
       WHERE id_cliente = ?
         AND id_grupo = ?
         ${whereDepartamento}`,
      params
    );

    // opcional pero recomendable:
    if ((r1.affectedRows ?? 0) > 0) {
      await db.query(
        `UPDATE gr_planificacion SET fg_activa = 0 WHERE id_cliente = ? AND id_grupo = ?`,
        [id_cliente, id]
      );
      await db.query(
        `UPDATE fu_rl_gr SET fg_activo = 0 WHERE id_cliente = ? AND id_grupo = ?`,
        [id_cliente, id]
      );
    }

    return NextResponse.json({ ok: true, deleted: r1.affectedRows ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ error: "No autorizado", debug: { msg: String(e?.message ?? e) } }, { status: 401 });
  }
}
