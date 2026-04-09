export type Frecuencia = "diario" | "semanal" | "mensual";

export type Genero = {
  id: number;
  empresa_num: number;
  tema: string;
  descripcion?: string | null;
  frecuencia: Frecuencia;
  cantidad: number;
  idioma: string;
  sources: string[];
  utilizado: "Si" | "No";
};

export type NoticiaEstadoCodigo =
  | "PENDIENTE"
  | "CUERPO_OK"
  | "IMG_OK"
  | "PUBLICADO"
  | "RETIRADO"
  | (string & {});

export type NoticiaPublicado = boolean | "Si" | "No";

export type Noticia = {
  // ✅ DTO NUEVO (/api/news)
  id: number;
  id_grupo: number;

  titulo: string | null;
  cuerpo: string | null;
  imagen_url: string | null;

  estado_codigo: NoticiaEstadoCodigo;
  estado_nombre: string;

  publicado: NoticiaPublicado;
  fecha_publicacion: string | null;

  url_publicada?: string | null;

  // ✅ LEGACY opcional (por compatibilidad mientras migras pantallas)
  empresa_num?: number;
  planificacion_id?: number | null;

  titulo_generado?: string | null;
  cuerpo_generado?: string | null;
  imagen_url_generada?: string | null;

  titulo_confirmado?: string | null;
  cuerpo_confirmado?: string | null;
  imagen_url_confirmada?: string | null;

  noticia_revisada?: "Nuevo" | "Revisada";
  imagen_revisada?: "Nuevo" | "Aprobada" | "Reemplazar";
};

export type Me = {
  email: string;
  dni: string;
  codigo_cliente: string;
  id_cliente?: number | null;
  role?: "admin" | "member";
  tipo_usuario?: string | null;
  alcance?: "DEPARTAMENTOS_ASIGNADOS" | "TENANT_COMPLETO";
  empresa_nombre: string | null;
  nombre?: string | null;
  apellidos?: string | null;
  displayName?: string | null;
  departamento_nombre?: string | null;
  departamentos: Array<{ id_departamento: number; nombre: string }>;
};

export type ScopeDepartamento = {
  id_departamento: number;
  nombre: string;
  id_area: number;
  area_nombre: string;
};

export type ScopeArea = {
  id_area: number;
  nombre: string;
  departamentos: Array<{
    id_departamento: number;
    nombre: string;
  }>;
};

export type OrganizationScope = {
  areas: ScopeArea[];
  departamentos: ScopeDepartamento[];
  singleDepartamento: boolean;
};

export type SupportTicketCategory =
  | "ACCESO_LOGIN"
  | "N8N"
  | "NOTICIAS"
  | "PUBLICACION"
  | "MEJORA"
  | "UX"
  | "OTRO"
  | (string & {});

export type SupportTicket = {
  id_contacto: number;
  id_usuario: number | null;
  id_departamento: number | null;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string | null;
  categoria: SupportTicketCategory;
  mensaje: string;
  created_at: string;
  updated_at: string;
  departamento_nombre: string | null;
  usuario_nombre: string | null;
};

export type KpiDailySummary = {
  metrica_codigo: string;
  acumulado_actual: number;
  delta_periodo: number;
  latest_date: string;
};

export type KpiDailySeriesRow = {
  fecha: string;
  id_grupo: number | null;
  canal_codigo: string;
  metrica_codigo: string;
  acumulado_total: number;
  delta_total: number;
};

export type KpiDailyPayload = {
  from: string;
  to: string;
  days: number;
  channel: string | null;
  channels: string[];
  summary: KpiDailySummary[];
  series: KpiDailySeriesRow[];
  sync?: {
    attempted: boolean;
    totalCandidates: number;
    synced: number;
    failed: number;
    skippedNoRef: number;
    skippedRecent: number;
    skippedNoMetrics: number;
    insertedMetricas: number;
    warnings: string[];
  } | null;
};

export type LinkedInConnectionStatus = {
  connected: boolean;
  source: "db" | "env" | null;
  authorUrn: string | null;
  memberId: string | null;
  expiresAt: string | null;
  scopes: string | null;
};
