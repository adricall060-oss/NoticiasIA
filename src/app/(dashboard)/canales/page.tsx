"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { LinkedInConnectionStatus, Me } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";

function formatDate(value: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

export default function LinkedInIntegrationPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<LinkedInConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthResult, setOauthResult] = useState<string | null>(null);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    setOauthResult(qs.get("li"));
    setOauthMessage(qs.get("li_msg"));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const meRes = await api.me();
      setMe(meRes.data);
      if (meRes.data.role !== "admin") {
        setStatus(null);
        return;
      }
      const statusRes = await api.getLinkedInStatus();
      setStatus(statusRes.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cargar LinkedIn.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onDisconnect() {
    setWorking(true);
    setError(null);
    try {
      await api.disconnectLinkedIn();
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo desconectar LinkedIn.");
    } finally {
      setWorking(false);
    }
  }

  function onConnect() {
    const next = encodeURIComponent("/canales");
    window.location.href = `/api/linkedin/connect?next=${next}`;
  }

  if (!loading && me?.role !== "admin") {
    return (
      <EmptyState
        title="Acceso solo para administradores"
        description="Tu rol actual no tiene permisos para configurar integraciones."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-2xl font-semibold">Integracion LinkedIn</div>
        <div className="text-sm text-muted-foreground">
          Conecta una cuenta para publicar automaticamente al pulsar Publicar en noticias.
        </div>
      </div>

      {oauthResult === "ok" ? (
        <Card className="border-emerald-300 p-3 text-sm text-emerald-700">
          LinkedIn conectado correctamente.
        </Card>
      ) : null}
      {oauthResult === "error" ? (
        <Card className="border-destructive/30 p-3 text-sm text-destructive">
          Error al conectar LinkedIn{oauthMessage ? `: ${oauthMessage}` : "."}
        </Card>
      ) : null}
      {error ? <Card className="border-destructive/30 p-3 text-sm text-destructive">{error}</Card> : null}

      {loading ? (
        <Card className="p-6">Cargando...</Card>
      ) : (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Estado de conexion</div>
              <div className="text-xs text-muted-foreground">
                Fuente: {status?.source ?? "-"} | Expira: {formatDate(status?.expiresAt ?? null)}
              </div>
            </div>
            <Badge variant={status?.connected ? "default" : "secondary"}>
              {status?.connected ? "Conectado" : "No conectado"}
            </Badge>
          </div>

          <div className="grid gap-2 text-sm">
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="text-xs text-muted-foreground">Author URN</div>
              <div className="break-all font-mono text-xs">{status?.authorUrn ?? "-"}</div>
            </div>
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="text-xs text-muted-foreground">Scopes</div>
              <div className="break-all font-mono text-xs">{status?.scopes ?? "-"}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="cursor-pointer bg-white text-slate-900 border border-slate-300 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
              onClick={load}
              disabled={loading || working}
            >
              Recargar
            </Button>
            <Button
              variant="destructive"
              className="bg-white cursor-pointer text-red-700 border border-red-200 hover:border-red-300 hover:bg-red-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
              onClick={onDisconnect}
              disabled={working || !status?.connected || status?.source !== "db"}
            >
              Desconectar
            </Button>
            <Button
              className="bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
              onClick={onConnect}
              disabled={working}
            >
              Conectar LinkedIn
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
