"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Frecuencia } from "@/lib/types";
import { validateFuenteInput } from "@/lib/fuentes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type GeneroDialogProps = {
  onCreated: () => void;
  idDepartamento: number | null;
};

export function GeneroDialog({ onCreated, idDepartamento }: GeneroDialogProps) {
  const [open, setOpen] = useState(false);

  const [tema, setTema] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [frecuencia, setFrecuencia] = useState<Frecuencia>("semanal");
  const [hora, setHora] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [idioma, setIdioma] = useState("Espanol");

  const [usarFuentes, setUsarFuentes] = useState<"no" | "si">("no");
  const [fuentes, setFuentes] = useState<string[]>([]);
  const [fuenteDraft, setFuenteDraft] = useState("");
  const [fuenteError, setFuenteError] = useState<string | null>(null);

  const canSave = useMemo(
    () => tema.trim().length > 0 && cantidad > 0 && Number.isSafeInteger(idDepartamento ?? NaN),
    [cantidad, idDepartamento, tema]
  );

  function addFuente() {
    const value = fuenteDraft.trim();
    if (!value) return;

    const validation = validateFuenteInput(value);
    if (!validation.ok) {
      setFuenteError(validation.error);
      return;
    }

    setFuenteError(null);
    setFuentes((prev) => Array.from(new Set([...prev, validation.value])));
    setFuenteDraft("");
  }

  function removeFuente(value: string) {
    setFuenteError(null);
    setFuentes((prev) => prev.filter((item) => item !== value));
  }

  async function onSubmit() {
    if (!canSave || !idDepartamento) return;

    let sources: string[] = [];
    if (usarFuentes === "si") {
      const tail = fuenteDraft.trim();
      const candidates = tail ? [...fuentes, tail] : [...fuentes];
      const normalized: string[] = [];

      for (const candidate of candidates) {
        const validation = validateFuenteInput(candidate);
        if (!validation.ok) {
          setFuenteError(validation.error);
          return;
        }
        if (validation.value) normalized.push(validation.value);
      }

      sources = Array.from(new Set(normalized));
    }
    setFuenteError(null);

    await api.createGenero({
      tema: tema.trim(),
      descripcion: descripcion.trim() || null,
      frecuencia,
      hora: hora.trim() || null,
      cantidad,
      idioma,
      sources,
      utilizado: "No",
      id_departamento: idDepartamento,
    });

    setOpen(false);
    setTema("");
    setDescripcion("");
    setFrecuencia("semanal");
    setHora("");
    setCantidad(1);
    setIdioma("Espanol");
    setUsarFuentes("no");
    setFuentes([]);
    setFuenteDraft("");
    setFuenteError(null);
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className="bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 shadow-sm"
          disabled={!idDepartamento}
          title={idDepartamento ? "Crear grupo" : "Selecciona un departamento"}
        >
          Crear grupo
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl text-blue-700 font-satoshi font-black">Crear grupo</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium">Titulo</div>
            <Input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ej: IA en marketing" />
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">Descripcion</div>
            <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Opcional" />
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">Frecuencia</div>
              <Select value={frecuencia} onValueChange={(v) => setFrecuencia(v as Frecuencia)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="diario">Diario</SelectItem>
                  <SelectItem value="semanal">Semanal</SelectItem>
                  <SelectItem value="mensual">Mensual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Hora</div>
              <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Cantidad</div>
              <Input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">Idioma</div>
              <Select value={idioma} onValueChange={setIdioma}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Espanol">Espanol</SelectItem>
                  <SelectItem value="Catalan">Catalan</SelectItem>
                  <SelectItem value="Euskera">Euskera</SelectItem>
                  <SelectItem value="Gallego">Gallego</SelectItem>
                  <SelectItem value="Ingles">Ingles</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Fuentes</div>
                <div className="text-sm text-muted-foreground">Quieres anadir fuentes?</div>
              </div>

              <Select
                value={usarFuentes}
                onValueChange={(v) => {
                  const val = v as "no" | "si";
                  setUsarFuentes(val);
                  setFuenteError(null);
                  if (val === "no") {
                    setFuentes([]);
                    setFuenteDraft("");
                  }
                }}
              >
                <SelectTrigger className="w-full md:w-40">
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="si">Si</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {usarFuentes === "si" ? (
              <>
                <div className="text-sm text-muted-foreground">
                  Puedes dejarlo vacio, poner <b>@handle</b> o texto de busqueda.
                </div>

                <div className="flex gap-2">
                  <Input
                    value={fuenteDraft}
                    onChange={(e) => {
                      setFuenteDraft(e.target.value);
                      if (fuenteError) setFuenteError(null);
                    }}
                    placeholder="@canal o 'tendencias IA 2026'"
                  />
                  <Button type="button" variant="secondary" onClick={addFuente}>
                    Anadir
                  </Button>
                </div>

                {fuenteError ? <div className="text-sm text-destructive">{fuenteError}</div> : null}

                {fuentes.length > 0 ? (
                  <div className="space-y-2 pt-2">
                    {fuentes.map((f) => (
                      <div key={f} className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
                        <span className="truncate">{f}</span>
                        <button className="text-destructive hover:underline" onClick={() => removeFuente(f)}>
                          eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              className="cursor-pointer transition-all duration-200 hover:-translate-y-0.5 shadow-sm"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              className="bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 shadow-sm"
              disabled={!canSave}
              onClick={onSubmit}
            >
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
