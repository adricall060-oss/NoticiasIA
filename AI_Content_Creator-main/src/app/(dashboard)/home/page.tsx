"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Genero, OrganizationScope } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GeneroDialog } from "@/components/genero-dialog";
import { EmptyState } from "@/components/empty-state";
import { ContactSupportSection } from "@/components/contact-support-section";
import { SupportTicketsSection } from "@/components/support-tickets-section";

type ScopeAreaDepartment = {
  id_departamento: number;
  nombre: string;
};

type SelectionMode = "auto" | "area-only" | "department-only" | "area-and-department";
type HelpMainSection = "menu" | "contacto-soporte" | "faq" | "guia";
type HelpContactSection = "menu" | "enviar" | "revisar";

function resolveSelectionMode(scope: OrganizationScope): SelectionMode {
  const areaCount = scope.areas.length;
  const depCount = scope.departamentos.length;

  if (depCount <= 0) return "auto";
  if (areaCount <= 1 && depCount <= 1) return "auto";
  if (areaCount > 1 && depCount <= 1) return "area-only";
  if (areaCount <= 1 && depCount > 1) return "department-only";
  return "area-and-department";
}

export default function HomePage() {
  const searchParams = useSearchParams();
  const showHelp = searchParams.get("section") === "ayuda";
  const resetToken = searchParams.get("reset");

  const [scope, setScope] = useState<OrganizationScope | null>(null);
  const [scopeLoading, setScopeLoading] = useState(true);

  const [generos, setGeneros] = useState<Genero[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedAreaId, setSelectedAreaId] = useState<number | null>(null);
  const [selectedDepartamentoId, setSelectedDepartamentoId] = useState<number | null>(null);
  const [helpMainSection, setHelpMainSection] = useState<HelpMainSection>("menu");
  const [helpContactSection, setHelpContactSection] = useState<HelpContactSection>("menu");

  const selectedArea = useMemo(
    () => scope?.areas.find((area) => area.id_area === selectedAreaId) ?? null,
    [scope?.areas, selectedAreaId]
  );

  const selectedDepartamento = useMemo(
    () =>
      scope?.departamentos.find((departamento) => departamento.id_departamento === selectedDepartamentoId) ?? null,
    [scope?.departamentos, selectedDepartamentoId]
  );

  const selectionMode = useMemo<SelectionMode>(
    () => (scope ? resolveSelectionMode(scope) : "auto"),
    [scope]
  );

  const departmentsForSelection = useMemo<ScopeAreaDepartment[]>(() => {
    if (!scope) return [];
    if (selectionMode === "department-only") {
      return scope.departamentos.map((dep) => ({
        id_departamento: dep.id_departamento,
        nombre: dep.nombre,
      }));
    }
    if (selectionMode === "area-and-department") {
      return selectedArea?.departamentos ?? [];
    }
    return [];
  }, [scope, selectedArea, selectionMode]);

  const requiresAreaSelection = selectionMode === "area-only" || selectionMode === "area-and-department";
  const helpSectionTitle = useMemo(() => {
    if (helpMainSection === "contacto-soporte") {
      if (helpContactSection === "enviar") return "Enviar";
      if (helpContactSection === "revisar") return "Revisar";
      return "Contacto / Soporte";
    }
    if (helpMainSection === "faq") return "Preguntas frecuentes";
    if (helpMainSection === "guia") return "Guia de uso";
    return "Ayuda";
  }, [helpMainSection, helpContactSection]);

  async function loadScope(forceReset = false) {
    setScopeLoading(true);
    setError(null);
    try {
      const res = await api.getOrganizationScope();
      const nextScope = res.data;
      setScope(nextScope);

      if (!nextScope.departamentos.length) {
        setSelectedAreaId(null);
        setSelectedDepartamentoId(null);
        return;
      }

      const mode = resolveSelectionMode(nextScope);
      const uniqueDep = nextScope.departamentos.length === 1 ? nextScope.departamentos[0] : null;

      if (mode === "auto") {
        const dep = uniqueDep ?? nextScope.departamentos[0];
        if (!dep) {
          setSelectedAreaId(null);
          setSelectedDepartamentoId(null);
          return;
        }
        setSelectedAreaId(dep.id_area);
        setSelectedDepartamentoId(dep.id_departamento);
        return;
      }

      if (mode === "area-only") {
        if (forceReset) {
          setSelectedAreaId(null);
          setSelectedDepartamentoId(null);
          return;
        }

        const keepArea =
          selectedAreaId && nextScope.areas.some((area) => area.id_area === selectedAreaId)
            ? selectedAreaId
            : null;

        setSelectedAreaId(keepArea);
        setSelectedDepartamentoId(keepArea && uniqueDep ? uniqueDep.id_departamento : null);
        return;
      }

      const keepDepartment =
        !forceReset &&
        selectedDepartamentoId &&
        nextScope.departamentos.some((dep) => dep.id_departamento === selectedDepartamentoId)
          ? nextScope.departamentos.find((dep) => dep.id_departamento === selectedDepartamentoId)
          : null;

      if (keepDepartment) {
        setSelectedAreaId(keepDepartment.id_area);
        setSelectedDepartamentoId(keepDepartment.id_departamento);
        return;
      }

      const keepArea =
        !forceReset && selectedAreaId && nextScope.areas.some((area) => area.id_area === selectedAreaId)
          ? selectedAreaId
          : null;

      setSelectedAreaId(keepArea);
      setSelectedDepartamentoId(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cargar areas/departamentos");
      setScope(null);
      setSelectedAreaId(null);
      setSelectedDepartamentoId(null);
    } finally {
      setScopeLoading(false);
    }
  }

  async function loadGroupsByDepartamento(idDepartamento: number | null) {
    if (!idDepartamento || !Number.isSafeInteger(idDepartamento)) {
      setGeneros([]);
      setGroupsLoading(false);
      return;
    }

    setGroupsLoading(true);
    setError(null);
    try {
      const res = await api.getGeneros(idDepartamento);
      setGeneros(res.data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los grupos");
      setGeneros([]);
    } finally {
      setGroupsLoading(false);
    }
  }

  async function refreshGroups() {
    await loadGroupsByDepartamento(selectedDepartamentoId);
  }

  useEffect(() => {
    loadScope(Boolean(resetToken));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  useEffect(() => {
    if (showHelp) return;
    loadGroupsByDepartamento(selectedDepartamentoId);
  }, [selectedDepartamentoId, showHelp]);

  useEffect(() => {
    if (showHelp) return;
    setHelpMainSection("menu");
    setHelpContactSection("menu");
  }, [showHelp]);

  async function onDelete(id: string | number) {
    try {
      await api.deleteGenero(id);
      await refreshGroups();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar");
    }
  }

  function onConfirmArea(idArea: number) {
    setSelectedAreaId(idArea);

    if (scope?.departamentos.length === 1) {
      setSelectedDepartamentoId(scope.departamentos[0].id_departamento);
      return;
    }

    const area = scope?.areas.find((item) => item.id_area === idArea);
    if (area && area.departamentos.length === 1) {
      setSelectedDepartamentoId(area.departamentos[0].id_departamento);
      return;
    }
    setSelectedDepartamentoId(null);
  }

  function onConfirmDepartamento(idDepartamento: number) {
    const dep = scope?.departamentos.find((item) => item.id_departamento === idDepartamento);
    if (dep) {
      setSelectedAreaId(dep.id_area);
      setSelectedDepartamentoId(dep.id_departamento);
    }
  }

  if (showHelp) {
    return (
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-3xl font-semibold font-satoshi">{helpSectionTitle}</div>
            <div className="text-sm text-muted-foreground">Centro de soporte y documentacion</div>
          </div>
          {helpMainSection !== "menu" ? (
            <div className="flex flex-wrap items-center gap-2">
              {helpMainSection === "contacto-soporte" && helpContactSection !== "menu" ? (
                <Button
                  variant="outline"
                  className="cursor-pointer bg-white text-slate-900 border border-slate-300 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                  onClick={() => setHelpContactSection("menu")}
                >
                  Volver a contacto / soporte
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="cursor-pointer bg-white text-slate-900 border border-slate-300 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                onClick={() => {
                  setHelpMainSection("menu");
                  setHelpContactSection("menu");
                }}
              >
                Volver al centro de ayuda
              </Button>
            </div>
          ) : null}
        </div>

        {helpMainSection === "menu" ? (
          <div className="space-y-3">
            <button
              type="button"
              className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={() => {
                setHelpMainSection("contacto-soporte");
                setHelpContactSection("menu");
              }}
            >
              <Card className="w-full border-slate-200 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                <div className="space-y-1">
                  <div className="text-xl font-semibold font-satoshi">Contacto / soporte</div>
                  <div className="text-sm text-muted-foreground">
                    Reporta incidencias o comparte sugerencias para el equipo.
                  </div>
                </div>
              </Card>
            </button>

            <button
              type="button"
              className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={() => setHelpMainSection("faq")}
            >
              <Card className="w-full border-slate-200 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                <div className="space-y-1">
                  <div className="text-xl font-semibold font-satoshi">Preguntas frecuentes (FAQ)</div>
                  <div className="text-sm text-muted-foreground">
                    Respuestas rapidas a dudas comunes sobre la plataforma.
                  </div>
                </div>
              </Card>
            </button>

            <button
              type="button"
              className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={() => setHelpMainSection("guia")}
            >
              <Card className="w-full border-slate-200 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                <div className="space-y-1">
                  <div className="text-xl font-semibold font-satoshi">Guia de uso</div>
                  <div className="text-sm text-muted-foreground">
                    Flujo recomendado para crear grupos, generar contenido y publicar.
                  </div>
                </div>
              </Card>
            </button>
          </div>
        ) : null}

        {helpMainSection === "contacto-soporte" && helpContactSection === "menu" ? (
          <div className="space-y-3">
            <button
              type="button"
              className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={() => setHelpContactSection("enviar")}
            >
              <Card className="w-full border-slate-200 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                <div className="space-y-1">
                  <div className="text-xl font-semibold font-satoshi">Enviar</div>
                  <div className="text-sm text-muted-foreground">
                    Enviar una incidencia o sugerencia al equipo de soporte.
                  </div>
                </div>
              </Card>
            </button>

            <button
              type="button"
              className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={() => setHelpContactSection("revisar")}
            >
              <Card className="w-full border-slate-200 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                <div className="space-y-1">
                  <div className="text-xl font-semibold font-satoshi">Revisar</div>
                  <div className="text-sm text-muted-foreground">
                    Consulta el estado de tus solicitudes de soporte.
                  </div>
                </div>
              </Card>
            </button>
          </div>
        ) : null}

        {helpMainSection === "contacto-soporte" && helpContactSection === "enviar" ? (
          <div className="space-y-3">
            <ContactSupportSection idDepartamento={selectedDepartamentoId} />
          </div>
        ) : null}

        {helpMainSection === "contacto-soporte" && helpContactSection === "revisar" ? (
          <SupportTicketsSection />
        ) : null}

        {helpMainSection === "faq" ? (
          <Card className="w-full border-slate-200 p-5">
            <div className="space-y-4">
              <div className="text-xl font-semibold font-satoshi">Preguntas frecuentes (FAQ)</div>
              <div className="space-y-3">
                <div>
                  <div className="font-semibold">Como empiezo a crear contenido con n8n?</div>
                  <div className="text-sm text-muted-foreground">
                    Crea un grupo en la seccion Grupos y configura frecuencia, idioma y cantidad para activar el flujo.
                  </div>
                </div>
                <div>
                  <div className="font-semibold">Que hago si no veo mis departamentos?</div>
                  <div className="text-sm text-muted-foreground">
                    Verifica permisos de usuario y solicita a un administrador que revise las asignaciones en base de
                    datos.
                  </div>
                </div>
                <div>
                  <div className="font-semibold">Donde reviso las noticias generadas?</div>
                  <div className="text-sm text-muted-foreground">
                    En cada grupo usa el boton Ver noticias para validar, confirmar contenido e imagen, y publicar.
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {helpMainSection === "guia" ? (
          <Card className="w-full border-slate-200 p-5">
            <div className="space-y-4">
              <div className="text-xl font-semibold font-satoshi">Guia de uso</div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div>1. Selecciona area y departamento en Grupos.</div>
                <div>2. Crea o ajusta grupos segun los temas que quieres automatizar.</div>
                <div>3. Revisa y confirma las noticias generadas antes de publicar.</div>
                <div>4. Usa Ayuda &gt; Contacto / soporte &gt; Enviar para incidencias o sugerencias.</div>
              </div>
            </div>
          </Card>
        ) : null}
      </section>
    );
  }

  if (scopeLoading) {
    return (
      <section className="min-w-0 space-y-4">
        <div>
          <div className="text-3xl font-semibold font-satoshi">Grupos</div>
          <div className="text-sm text-muted-foreground">Cargando contexto organizativo...</div>
        </div>
        <Card className="p-6">Cargando...</Card>
      </section>
    );
  }

  if (!scope || scope.departamentos.length === 0) {
    return (
      <section className="min-w-0 space-y-4">
        <div>
          <div className="text-3xl font-semibold font-satoshi">Grupos</div>
          <div className="text-sm text-muted-foreground">Planificacion para n8n</div>
        </div>
        <EmptyState
          title="Sin departamentos asignados"
          description="Tu usuario no tiene departamentos activos. Contacta con un administrador."
        />
      </section>
    );
  }

  const showAreaCards = (selectionMode === "area-only" || selectionMode === "area-and-department") && !selectedAreaId;
  const showDepartmentCards =
    (selectionMode === "department-only" || selectionMode === "area-and-department") &&
    !selectedDepartamentoId &&
    !showAreaCards;

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold font-satoshi">Grupos</div>
          <div className="text-sm text-muted-foreground">Planificacion para n8n</div>
        </div>
        {selectedDepartamentoId ? (
          <GeneroDialog onCreated={() => void refreshGroups()} idDepartamento={selectedDepartamentoId} />
        ) : null}
      </div>

      {error ? <Card className="border-destructive/30 p-3 text-sm text-destructive">{error}</Card> : null}

      {showAreaCards ? (
        <Card className="space-y-3 p-4">
          <div className="text-xl font-satoshi font-semibold">Selecciona un area</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {scope.areas.map((area) => (
              <Card key={area.id_area} className="space-y-3 p-4">
                <div className="font-semibold">{area.nombre}</div>
                <div className="text-xs text-muted-foreground">{area.departamentos.length} departamento(s)</div>
                <Button
                  className="w-full bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                  onClick={() => onConfirmArea(area.id_area)}
                >
                  Confirmar
                </Button>
              </Card>
            ))}
          </div>
        </Card>
      ) : null}

      {showDepartmentCards ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xl font-satoshi font-semibold">
              Selecciona un departamento
              {/*selectedArea ? ` en ${selectedArea.nombre}` : ""*/} 
            </div>
            {requiresAreaSelection ? (
              <Button
                variant="outline"
                className="cursor-pointer bg-white text-slate-900 border border-slate-300 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                onClick={() => {
                  setSelectedAreaId(null);
                  setSelectedDepartamentoId(null);
                }}
              >
                Cambiar area
              </Button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {departmentsForSelection.map((dep) => (
              <Card key={dep.id_departamento} className="space-y-3 p-4">
                <div className="font-semibold">{dep.nombre}</div>
                <Button
                  className="w-full bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                  onClick={() => onConfirmDepartamento(dep.id_departamento)}
                >
                  Confirmar
                </Button>
              </Card>
            ))}
          </div>
        </Card>
      ) : null}

      {selectedDepartamentoId ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-2">
              <div className="space-y-0.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Departamento
                </div>
                <div className="text-sm font-semibold">
                  {selectedDepartamento?.nombre ?? `Departamento #${selectedDepartamentoId}`}
                </div>
              </div>
              <div className="space-y-0.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Area</div>
                <div className="text-sm font-semibold">
                  {selectedArea?.nombre ?? selectedDepartamento?.area_nombre ?? "-"}
                </div>
              </div>
            </div>
            {!scope.singleDepartamento ? (
              <Button
                variant="outline"
                className="cursor-pointer bg-white text-slate-900 border border-slate-300 hover:border-blue-300 hover:bg-blue-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                onClick={() => {
                  setSelectedDepartamentoId(null);
                }}
              >
                Cambiar departamento
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {selectedDepartamentoId ? (
        groupsLoading ? (
          <Card className="p-6">Cargando grupos...</Card>
        ) : generos.length === 0 ? (
          <EmptyState
            title="Aun no hay grupos en este departamento"
            description="Crea un grupo para que n8n empiece a generar contenido."
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {generos.map((g) => (
              <Card key={g.id} className="min-w-0 p-4 flex h-full flex-col">
                <div className="font-semibold break-words">{g.tema}</div>

                <div className="mt-1 min-h-[2.8rem] text-sm text-muted-foreground line-clamp-2 break-words">
                  {g.descripcion || "Sin descripcion"}
                </div>

                <div className="mt-3 text-xs text-muted-foreground break-words">
                  {g.frecuencia} | {g.cantidad} | {g.idioma} | utilizado: {g.utilizado}
                </div>

                <div className="mt-auto pt-4 flex flex-col gap-2">
                  <Button
                    className="w-full bg-white cursor-pointer text-red-700 border border-red-200 hover:border-red-300 hover:bg-red-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                    variant="destructive"
                    onClick={() => onDelete(g.id)}
                  >
                    Eliminar
                  </Button>

                  <Button
                    className="w-full bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                    asChild
                  >
                    <Link href={`/noticias/genero/${g.id}`}>Ver noticias</Link>
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
