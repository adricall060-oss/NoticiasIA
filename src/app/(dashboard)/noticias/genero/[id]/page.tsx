"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { Noticia } from "@/lib/types";
import { EmptyState } from "@/components/empty-state";
import { NoticiaCard } from "@/components/noticia-card";
import { RevisarNoticiaDialog } from "@/components/revisar-noticia-dialog";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type NoticiasFilterTab = "todas" | "pendientes" | "publicadas";

function normalizeSearchText(value: string) {
  return value.toLocaleLowerCase("es-ES").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function noticiaSearchBlob(n: Noticia) {
  const titulo = n.titulo || n.titulo_confirmado || n.titulo_generado || "";
  return normalizeSearchText(titulo);
}

function isPublished(n: Noticia) {
  if (String(n.estado_codigo ?? "").toUpperCase() === "PUBLICADO") return true;
  if (typeof n.publicado === "boolean") return n.publicado;
  return String(n.publicado ?? "").toLowerCase() === "si";
}

export default function NoticiasGeneroPage() {
  const activeTabClass =
    "data-[state=active]:bg-blue-700 data-[state=active]:text-white data-[state=active]:hover:bg-blue-700/95 data-[state=active]:font-semibold enabled:hover:font-semibold";
  const params = useParams();
  const generoId = Number(params.id);

  const [data, setData] = useState<Noticia[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<NoticiasFilterTab>("todas");
  const [query, setQuery] = useState("");

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Noticia | null>(null);

  const searchTerms = useMemo(
    () =>
      query
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    [query]
  );

  const normalizedTerms = useMemo(
    () => searchTerms.map((term) => normalizeSearchText(term)),
    [searchTerms]
  );

  const filteredData = useMemo(() => {
    let rows = data;

    if (filterTab === "pendientes") {
      rows = rows.filter((n) => !isPublished(n));
    } else if (filterTab === "publicadas") {
      rows = rows.filter((n) => isPublished(n));
    }

    if (!normalizedTerms.length) return rows;

    return rows.filter((n) => {
      const blob = noticiaSearchBlob(n);
      return normalizedTerms.every((term) => blob.includes(term));
    });
  }, [data, filterTab, normalizedTerms]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getNoticias(generoId);
      setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [generoId]);

  useEffect(() => {
    if (!Number.isFinite(generoId)) return;
    void load();
  }, [generoId, load]);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-3xl font-semibold font-satoshi">Noticias del grupo #{generoId}</div>
        <div className="text-sm text-muted-foreground">Generadas por n8n</div>
      </div>

      {!loading && data.length > 0 ? (
        <div className="space-y-3 rounded-xl border bg-card p-3">
          <Tabs className="min-w-0" value={filterTab} onValueChange={(v) => setFilterTab(v as NoticiasFilterTab)}>
            <TabsList className="grid w-full grid-cols-3 sm:w-[340px]">
              <TabsTrigger value="todas" className={activeTabClass}>
                Todas
              </TabsTrigger>
              <TabsTrigger value="pendientes" className={activeTabClass}>
                Pendientes
              </TabsTrigger>
              <TabsTrigger value="publicadas" className={activeTabClass}>
                Publicadas
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar por titulo o palabras clave..."
          />

          <div className="text-xs text-muted-foreground">
            Mostrando {filteredData.length} de {data.length} noticia(s)
          </div>
        </div>
      ) : null}

      {loading ? (
        <Card className="p-6">Cargando...</Card>
      ) : data.length === 0 ? (
        <EmptyState
          title="Aun no hay noticias"
          description="Cuando n8n genere contenido para este genero aparecera aqui."
        />
      ) : filteredData.length === 0 ? (
        <EmptyState
          title="No hay resultados"
          description="Prueba con otra palabra clave o cambia el filtro."
        />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredData.map((n) => (
            <NoticiaCard
              key={n.id}
              n={n}
              onReview={(x) => {
                setSelected(x);
                setOpen(true);
              }}
            />
          ))}
        </div>
      )}

      <RevisarNoticiaDialog
        noticia={selected}
        open={open}
        onOpenChange={setOpen}
        onChanged={load}
      />
    </div>
  );
}
