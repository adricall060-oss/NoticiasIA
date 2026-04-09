import type {
  Genero,
  Noticia,
  Me,
  KpiDailyPayload,
  LinkedInConnectionStatus,
  OrganizationScope,
  SupportTicket,
} from "./types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Error de servidor");
  return data as T;
}

export const api = {
  // Auth
  me: () => json<{ ok: true; data: Me }>("/api/me"),
  login: (payload: { email: string; password: string; turnstileToken: string }) =>
    json<{ ok: true }>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  signup: (payload: {
    email: string;
    password: string;
    dni: string;
    nombre: string;
    apellidos: string;
    codigo_cliente: string;
  }) => json<{ ok: true }>("/api/auth/signup", { method: "POST", body: JSON.stringify(payload) }),
  logout: () => json<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  // Grupos
  getGeneros: (id_departamento?: number) =>
    json<{ ok: true; data: Genero[] }>(
      id_departamento && Number.isFinite(id_departamento)
        ? `/api/genres?id_departamento=${encodeURIComponent(String(id_departamento))}`
        : "/api/genres"
    ),
  createGenero: (
    payload: Omit<Genero, "id" | "empresa_num"> & {
      hora?: string | null;
      id_departamento?: number;
      departamentoId?: number;
    }
  ) => json<{ ok: true }>("/api/genres", { method: "POST", body: JSON.stringify(payload) }),
  deleteGenero: (id: string | number) =>
    json<{ ok: true }>(`/api/genres/${encodeURIComponent(String(id))}`, { method: "DELETE" }),
  getOrganizationScope: () =>
    json<{ ok: true; data: OrganizationScope }>("/api/organization/scope"),

  // Noticias
  getNoticias: (generoId?: number) =>
    json<{ ok: true; data: Noticia[] }>(generoId ? `/api/news?generoId=${generoId}` : "/api/news"),

  confirmContent: (id: number, payload: { titulo_confirmado: string; cuerpo_confirmado: string }) =>
    json<{ ok: true }>(`/api/news/${id}/confirm-content`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  confirmImage: (id: number, payload: { imagen_url_confirmada: string }) =>
    json<{ ok: true }>(`/api/news/${id}/confirm-image`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  uploadImageDataUrl: (payload: { data_url: string }) =>
    json<{ ok: true; data: { url: string } }>("/api/images/upload", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  captureNewsStats: (
    id: number,
    payload: {
      channel?: string;
      fecha_captura?: string;
      origen?: string;
      metrics?: Record<string, number>;
      valores?: Array<{ codigo: string; valor_acumulado: number }>;
    }
  ) =>
    json<{ ok: true; id_publicacion?: number; insertedMetricas?: number }>(`/api/news/${id}/stats`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  linkLinkedInPostRef: (id: number, payload: { postRef: string }) =>
    json<{
      ok: true;
      postRef: string;
      id_publicacion: number | null;
      captured: boolean;
      insertedMetricas: number;
      warnings: string[];
    }>(`/api/news/${id}/linkedin-ref`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getKpiDaily: (params?: {
    days?: number;
    canal?: string;
    sync?: boolean;
    syncLimit?: number;
    syncMinMinutes?: number;
    forceSync?: boolean;
  }) => {
    const query = new URLSearchParams();
    if (params?.days) query.set("days", String(params.days));
    if (params?.canal) query.set("canal", params.canal);
    if (params?.sync !== undefined) query.set("sync", params.sync ? "1" : "0");
    if (params?.syncLimit !== undefined) query.set("syncLimit", String(params.syncLimit));
    if (params?.syncMinMinutes !== undefined) query.set("syncMinMinutes", String(params.syncMinMinutes));
    if (params?.forceSync !== undefined) query.set("forceSync", params.forceSync ? "1" : "0");
    const qs = query.toString();
    return json<{ ok: true; data: KpiDailyPayload }>(`/api/kpi/daily${qs ? `?${qs}` : ""}`);
  },
  getKpiMetricCodes: () => json<{ ok: true; data: string[] }>("/api/kpi/metrics"),

  createSupportTicket: (payload: {
    firstName: string;
    lastName: string;
    email: string;
    phonePrefix?: string;
    phone?: string;
    issueType: string;
    message: string;
    privacyAccepted: boolean;
    departamentoId?: number | null;
  }) =>
    json<{ ok: true; id?: number }>("/api/support", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getSupportTickets: () => json<{ ok: true; data: SupportTicket[] }>("/api/support"),

  publish: (id: number) => json<{ ok: true }>(`/api/news/${id}/publish`, { method: "POST" }),
  withdraw: (id: number) => json<{ ok: true }>(`/api/news/${id}/withdraw`, { method: "POST" }),

  // LinkedIn
  getLinkedInStatus: () => json<{ ok: true; data: LinkedInConnectionStatus }>("/api/linkedin/status"),
  disconnectLinkedIn: () => json<{ ok: true; disconnected: boolean }>("/api/linkedin/disconnect", { method: "POST" }),
};
