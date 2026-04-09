"use client";

import { useEffect, useState } from "react";
import type { SupportTicket, SupportTicketCategory } from "@/lib/types";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function categoryLabel(value: SupportTicketCategory) {
  switch (value) {
    case "ACCESO_LOGIN":
      return "Acceso / Login";
    case "N8N":
      return "n8n";
    case "NOTICIAS":
      return "Noticias";
    case "PUBLICACION":
      return "Publicacion";
    case "MEJORA":
      return "Mejora";
    case "UX":
      return "UX";
    default:
      return "Otro";
  }
}

export function SupportTicketsSection() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadTickets() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSupportTickets();
      setTickets(res.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las incidencias.");
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTickets();
  }, []);

  if (loading) {
    return <Card className="p-4">Cargando incidencias...</Card>;
  }

  if (error) {
    return <Card className="border-destructive/30 p-3 text-sm text-destructive">{error}</Card>;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">{tickets.length} incidencia(s) encontrada(s)</div>
        <Button
          variant="outline"
          className="cursor-pointer bg-white text-slate-900 border border-slate-300 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
          onClick={() => void loadTickets()}
        >
          Actualizar
        </Button>
      </div>

      {tickets.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">Aun no hay incidencias registradas.</Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <Card key={ticket.id_contacto} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold">
                    {ticket.nombre} {ticket.apellido}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {ticket.email}
                    {ticket.telefono ? ` | ${ticket.telefono}` : ""}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{formatDate(ticket.created_at)}</div>
              </div>

              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {categoryLabel(ticket.categoria)}
              </div>

              <div className="text-sm whitespace-pre-wrap break-words">{ticket.mensaje}</div>

              <div className="text-xs text-muted-foreground">
                {ticket.departamento_nombre ? `Departamento: ${ticket.departamento_nombre}` : "Sin departamento"}
                {ticket.usuario_nombre ? ` | Usuario: ${ticket.usuario_nombre}` : ""}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
