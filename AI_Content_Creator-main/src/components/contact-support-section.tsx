"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";

const PHONE_PREFIXES = [
  { code: "ES", label: "+34" },
  { code: "US", label: "+1" },
  { code: "MX", label: "+52" },
  { code: "AR", label: "+54" },
  { code: "CO", label: "+57" },
  { code: "CL", label: "+56" },
  { code: "PE", label: "+51" },
];

const ISSUE_TYPES = [
  { value: "soporte_login", label: "Soporte acceso / login" },
  { value: "soporte_generacion", label: "Soporte generacion (n8n)" },
  { value: "soporte_editor", label: "Soporte editor de noticias" },
  { value: "soporte_publicacion", label: "Soporte publicacion" },
  { value: "sugerencia_mejora", label: "Sugerencia de mejora" },
  { value: "sugerencia_ux", label: "Sugerencia de experiencia (UX)" },
  { value: "otro", label: "Otro soporte / sugerencia" },
];

type SupportFormState = {
  firstName: string;
  lastName: string;
  email: string;
  phonePrefix: string;
  phone: string;
  issueType: string;
  message: string;
  privacy: boolean;
};

const INITIAL_STATE: SupportFormState = {
  firstName: "",
  lastName: "",
  email: "",
  phonePrefix: "ES",
  phone: "",
  issueType: "soporte_login",
  message: "",
  privacy: false,
};

type ContactSupportSectionProps = {
  idDepartamento?: number | null;
};

export function ContactSupportSection({ idDepartamento = null }: ContactSupportSectionProps) {
  const [form, setForm] = useState<SupportFormState>(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function updateForm<K extends keyof SupportFormState>(key: K, value: SupportFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.message.trim()) {
      setError("Completa nombre, apellido, email y mensaje.");
      return;
    }
    if (!form.privacy) {
      setError("Debes aceptar la politica de privacidad para enviar la incidencia.");
      return;
    }

    setLoading(true);
    try {
      await api.createSupportTicket({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phonePrefix: form.phonePrefix,
        phone: form.phone,
        issueType: form.issueType,
        message: form.message,
        privacyAccepted: form.privacy,
        departamentoId: idDepartamento,
      });
      setSuccess("Incidencia enviada correctamente. Nuestro equipo te contactara.");
      setForm(INITIAL_STATE);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la incidencia.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-sky-100/70 bg-gradient-to-br from-card to-sky-50/50 p-4 shadow-sm sm:p-5">
        <div className="mb-4">
          <h2 className="text-2xl font-semibold">Soporte y sugerencias</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Cuentanos dudas, problemas o ideas de mejora para la app y te ayudamos a gestionarlo.
          </p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-black">Nombre</label>
              <Input
                value={form.firstName}
                onChange={(e) => updateForm("firstName", e.target.value)}
                placeholder="Tu nombre"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-black">Apellido</label>
              <Input
                value={form.lastName}
                onChange={(e) => updateForm("lastName", e.target.value)}
                placeholder="Tu apellido"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-black">Email</label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => updateForm("email", e.target.value)}
                placeholder="tu@empresa.com"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-black">Categoria de soporte / sugerencia</label>
              <Select value={form.issueType} onValueChange={(value) => updateForm("issueType", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  {ISSUE_TYPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-black">Telefono (opcional)</label>
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <Select value={form.phonePrefix} onValueChange={(value) => updateForm("phonePrefix", value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Prefijo" />
                </SelectTrigger>
                <SelectContent>
                  {PHONE_PREFIXES.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.code} {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={form.phone}
                onChange={(e) => updateForm("phone", e.target.value)}
                placeholder="600 000 000"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-black">Mensaje</label>
            <Textarea
              value={form.message}
              onChange={(e) => updateForm("message", e.target.value)}
              placeholder="Describe el problema, pasos para reproducirlo y el resultado esperado."
              rows={5}
              required
            />
          </div>

          <label className="flex items-start gap-2 text-xs text-black">
            <input
              type="checkbox"
              checked={form.privacy}
              onChange={(e) => updateForm("privacy", e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input"
            />
            <span>Acepto la politica de privacidad para gestionar esta incidencia.</span>
          </label>

          {error ? (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          ) : null}
          {success ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              {success}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={loading}
              className="bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              <Send className="h-4 w-4" />
              {loading ? "Enviando..." : "Enviar incidencia"}
            </Button>
          </div>
        </form>
    </Card>
  );
}
