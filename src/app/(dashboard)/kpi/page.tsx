"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { KpiDailyPayload, Me } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);
}

function formatKpiDate(value: string) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;

  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const year = String(parsed.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function humanizeSyncWarning(message: string) {
  if (/partnerApiMemberCreatorPostAnalytics\.FINDER-entity/i.test(message)) {
    return (
      "LinkedIn no permite leer IMPRESIONES porque esta aplicacion no esta autorizada " +
      "para r_member_postAnalytics (Community Management API)."
    );
  }
  return message;
}

export default function KpiPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncInfo, setSyncInfo] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState("");
  const [data, setData] = useState<KpiDailyPayload | null>(null);
  const [linkNewsId, setLinkNewsId] = useState("");
  const [linkPostRef, setLinkPostRef] = useState("");
  const [metricCodes, setMetricCodes] = useState<string[]>([]);
  const [manualMetricCode, setManualMetricCode] = useState("IMPRESIONES");
  const [manualMetricValue, setManualMetricValue] = useState("");
  const [linkingRef, setLinkingRef] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSyncInfo(null);
    try {
      const meRes = await api.me();
      setMe(meRes.data);
      if (meRes.data.role !== "admin") {
        setData(null);
        return;
      }

      const [res, metricsRes] = await Promise.all([
        api.getKpiDaily({
          days,
          canal: channel || undefined,
          sync: true,
          syncLimit: 20,
          syncMinMinutes: 0,
          forceSync: true,
        }),
        api.getKpiMetricCodes(),
      ]);
      setData(res.data);
      const metricList = Array.from(
        new Set(metricsRes.data.map((code) => String(code ?? "").trim().toUpperCase()).filter(Boolean))
      );
      setMetricCodes(metricList);
      setManualMetricCode((current) => {
        const normalizedCurrent = String(current ?? "").trim().toUpperCase();
        if (normalizedCurrent && metricList.includes(normalizedCurrent)) return normalizedCurrent;
        if (metricList.includes("IMPRESIONES")) return "IMPRESIONES";
        return metricList[0] ?? "";
      });

      if (res.data.sync?.attempted) {
        const s = res.data.sync;
        const detailParts: string[] = [];
        if (s.skippedNoRef > 0) detailParts.push(`${s.skippedNoRef} sin postRef`);
        if (s.skippedRecent > 0) detailParts.push(`${s.skippedRecent} recientes`);
        if (s.skippedNoMetrics > 0) detailParts.push(`${s.skippedNoMetrics} sin metricas`);
        const detail = detailParts.length ? ` | Omitidas: ${detailParts.join(", ")}` : "";
        const firstWarning = s.warnings.length ? ` | Aviso: ${humanizeSyncWarning(s.warnings[0])}` : "";
        setSyncInfo(
          `Sync LinkedIn: ${s.synced} noticia(s) actualizada(s), ${s.insertedMetricas} metrica(s) insertada(s), ${s.failed} error(es).${detail}${firstWarning}`
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cargar KPI");
    } finally {
      setLoading(false);
    }
  }, [days, channel]);

  useEffect(() => {
    load();
  }, [load]);

  async function onLinkPostRef() {
    const newsId = Number(linkNewsId);
    const postRef = linkPostRef.trim();
    const metricCode = String(manualMetricCode ?? "").trim().toUpperCase();
    const hasManualValue = String(manualMetricValue ?? "").trim().length > 0;
    const manualValue = Number(manualMetricValue);

    if (!Number.isSafeInteger(newsId) || newsId <= 0) {
      setError("Indica un ID de noticia valido para vincular LinkedIn.");
      return;
    }
    if (!postRef) {
      setError("Pega la URL o URN del post de LinkedIn.");
      return;
    }
    if (hasManualValue && !metricCode) {
      setError("Selecciona una metrica para la captura manual.");
      return;
    }
    if (hasManualValue && (!Number.isFinite(manualValue) || manualValue < 0)) {
      setError("Indica una cantidad valida (numero >= 0).");
      return;
    }

    setLinkingRef(true);
    setError(null);
    try {
      const res = await api.linkLinkedInPostRef(newsId, { postRef });
      let manualInfo = "";

      if (hasManualValue) {
        await api.captureNewsStats(newsId, {
          channel: "LINKEDIN",
          origen: "MANUAL_LINKEDIN_UI",
          metrics: {
            [metricCode]: manualValue,
          },
        });
        manualInfo = ` | ${metricCode} manual: ${manualValue}`;
      }
      const warning = res.warnings.length ? ` | Aviso: ${humanizeSyncWarning(res.warnings[0])}` : "";
      setSyncInfo(
        `Vinculado post LinkedIn para noticia #${newsId}. Captura inmediata: ${res.captured ? "ok" : "sin captura"} (${res.insertedMetricas} metrica(s)).${manualInfo}${warning}`
      );
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo vincular el post de LinkedIn.");
    } finally {
      setLinkingRef(false);
    }
  }

  const channels = useMemo(() => data?.channels ?? [], [data]);
  const topSummary = useMemo(() => (data?.summary ?? []).slice(0, 6), [data]);

  if (!loading && me?.role !== "admin") {
    return (
      <EmptyState
        title="Acceso solo para administradores"
        description="Tu rol actual no tiene permisos para ver KPI."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-2xl font-semibold">KPI de rendimiento</div>
          <div className="text-sm text-muted-foreground">
            Agregado diario por canal y metrica (no_kpi_diario)
          </div>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          Recargar
        </Button>
      </div>

      <Card className="space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_220px_auto]">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Rango (dias)</span>
            <Select value={String(days)} onValueChange={(value) => setDays(Number(value))}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona rango" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Ultimos 7</SelectItem>
                <SelectItem value="30">Ultimos 30</SelectItem>
                <SelectItem value="90">Ultimos 90</SelectItem>
                <SelectItem value="180">Ultimos 180</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Canal</span>
            <Select value={channel || "__all__"} onValueChange={(value) => setChannel(value === "__all__" ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {channels.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <div className="flex items-end justify-end">
            <Button
              size="sm"
              className="h-8 px-3 bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
              onClick={load}
              disabled={loading}
            >
              Aplicar filtros
            </Button>
          </div>

        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="text-sm font-medium">Vincular post LinkedIn existente</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_1fr_auto]">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">ID noticia</span>
            <Input
              value={linkNewsId}
              onChange={(e) => setLinkNewsId(e.target.value)}
              placeholder="Ej: 80"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">URL o URN del post</span>
            <Input
              value={linkPostRef}
              onChange={(e) => setLinkPostRef(e.target.value)}
              placeholder="https://www.linkedin.com/feed/update/urn:li:activity:..."
            />
          </label>

          <div className="flex items-end">
            <Button
              className="w-full bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
              onClick={onLinkPostRef}
              disabled={linkingRef || loading}
            >
              {linkingRef ? "Vinculando..." : "Vincular y capturar"}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_240px_1fr]">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Metrica (TP_METRICA.codigo)</span>
            <Select
              value={metricCodes.length > 0 ? manualMetricCode : "__empty__"}
              onValueChange={setManualMetricCode}
              disabled={metricCodes.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={metricCodes.length === 0 ? "Sin metricas" : "Selecciona"} />
              </SelectTrigger>
              <SelectContent>
                {metricCodes.length === 0 ? (
                  <SelectItem value="__empty__" disabled>
                    Sin metricas
                  </SelectItem>
                ) : (
                  metricCodes.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Cantidad acumulada (opcional)</span>
            <Input
              value={manualMetricValue}
              onChange={(e) => setManualMetricValue(e.target.value)}
              placeholder="Ej: 21"
            />
          </label>
          <div className="flex items-end text-xs text-muted-foreground">
            Si LinkedIn bloquea analytics, se guarda la metrica seleccionada con este valor acumulado.
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Usa esto cuando la noticia ya este publicada en LinkedIn pero KPI no tenga referencia del post.
        </div>
      </Card>

      {syncInfo ? <Card className="p-3 text-sm text-muted-foreground">{syncInfo}</Card> : null}
      {error ? <Card className="border-destructive/30 p-3 text-sm text-destructive">{error}</Card> : null}

      {loading ? (
        <Card className="p-6">Cargando KPI...</Card>
      ) : !data || data.series.length === 0 ? (
        <EmptyState
          title="Sin datos KPI"
          description="Al recargar se intenta sincronizar LinkedIn automaticamente; si sigue vacio revisa permisos de la integracion."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {topSummary.map((item) => (
              <Card key={item.metrica_codigo} className="space-y-1 p-4">
                <div className="text-xs font-medium text-muted-foreground">{item.metrica_codigo}</div>
                <div className="text-lg font-semibold">{formatNumber(item.acumulado_actual)}</div>
                <div className="text-xs text-muted-foreground">
                  Delta periodo: {formatNumber(item.delta_periodo)} | Corte: {formatKpiDate(item.latest_date)}
                </div>
              </Card>
            ))}
          </div>

          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Grupo</th>
                  <th className="px-4 py-3 font-medium">Canal</th>
                  <th className="px-4 py-3 font-medium">Metrica</th>
                  <th className="px-4 py-3 font-medium">Acumulado</th>
                  <th className="px-4 py-3 font-medium">Delta</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((row) => (
                  <tr key={`${row.fecha}-${row.id_grupo ?? "nogroup"}-${row.canal_codigo}-${row.metrica_codigo}`} className="border-t">
                    <td className="px-4 py-3">{formatKpiDate(row.fecha)}</td>
                    <td className="px-4 py-3">{row.id_grupo ?? "-"}</td>
                    <td className="px-4 py-3">{row.canal_codigo}</td>
                    <td className="px-4 py-3">{row.metrica_codigo}</td>
                    <td className="px-4 py-3">{formatNumber(row.acumulado_total)}</td>
                    <td className="px-4 py-3">{formatNumber(row.delta_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
