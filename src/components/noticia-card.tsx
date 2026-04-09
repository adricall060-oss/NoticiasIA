import type { Noticia } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function NoticiaCard({
  n,
  onReview,
}: {
  n: Noticia;
  onReview: (n: Noticia) => void;
}) {
  const estado = String(n.estado_codigo ?? "PENDIENTE").toUpperCase();
  const published = estado === "PUBLICADO";

  const estadoNombre = String(n.estado_nombre ?? "").trim();
  const badgeText =
    estado === "PENDIENTE" ? "Pendiente" : estadoNombre || (published ? "Publicado" : "Pendiente");

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="font-semibold line-clamp-2">{n.titulo ?? "Sin título"}</div>
          <div className="text-xs text-muted-foreground">
            {published && n.fecha_publicacion
              ? `Publicado: ${new Date(n.fecha_publicacion).toLocaleString()}`
              : "Aún no publicado"}
          </div>
        </div>

        <Badge variant={published ? "default" : "secondary"}>{badgeText}</Badge>
      </div>

      <div className="mt-4">
        <Button
          className="w-full bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
          onClick={() => onReview(n)}
        >
          Revisar
        </Button>
      </div>
    </Card>
  );
}
