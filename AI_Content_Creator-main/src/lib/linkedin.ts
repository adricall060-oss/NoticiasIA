import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { readFile } from "fs/promises";
import { extname, resolve as resolvePath } from "path";
import { db } from "@/lib/db";

type LinkedInTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  scope?: unknown;
};

type LinkedInMemberResponse = {
  id?: unknown;
};

type LinkedInUserInfoResponse = {
  sub?: unknown;
};

type LinkedInImageInitializeUploadResponse = {
  value?: {
    uploadUrl?: unknown;
    image?: unknown;
  };
};

type LinkedInSocialActionsResponse = {
  likesSummary?: {
    totalLikes?: unknown;
  };
  commentsSummary?: {
    totalFirstLevelComments?: unknown;
  };
};

type LinkedInMemberPostAnalyticsResponse = {
  elements?: Array<{
    count?: unknown;
  }>;
};

type LinkedInConnectionRow = RowDataPacket & {
  id_linkedin_conexion: number;
  id_cliente: number;
  id_usuario_conectado: number | null;
  linkedin_member_id: string | null;
  author_urn: string;
  access_token: string;
  refresh_token: string | null;
  access_token_expires_at: Date | string | null;
  refresh_token_expires_at: Date | string | null;
  scopes: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

export type LinkedInConnection = {
  idCliente: number;
  idUsuarioConectado: number | null;
  linkedinMemberId: string | null;
  authorUrn: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string | null;
  source: "db" | "env";
};

export type LinkedInConnectionStatus = {
  connected: boolean;
  source: "db" | "env" | null;
  authorUrn: string | null;
  memberId: string | null;
  expiresAt: string | null;
  scopes: string | null;
};

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_MEMBER_URL = "https://api.linkedin.com/v2/me";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts";
const LINKEDIN_IMAGES_URL = "https://api.linkedin.com/rest/images";
const LINKEDIN_SOCIAL_ACTIONS_URL = "https://api.linkedin.com/rest/socialActions";
const LINKEDIN_MEMBER_POST_ANALYTICS_URL = "https://api.linkedin.com/rest/memberCreatorPostAnalytics";

let hasConnectionTableCache: boolean | null = null;

function parseDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toIsoOrNull(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toSafeString(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toPositiveSeconds(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

async function parseJsonSafe<T>(response: Response) {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function parseScopes(raw: string) {
  return raw
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function canonicalLinkedInScope(raw: string) {
  const scope = raw.trim();
  const lower = scope.toLowerCase();
  if (!lower) return "";
  if (lower === "r_liteprofile" || lower === "profile") return "profile";
  if (lower === "openid") return "openid";
  if (lower === "w_member_social") return "w_member_social";
  if (lower === "r_member_postanalytics") return "r_member_postAnalytics";
  return scope;
}

function normalizeLinkedInScopes(scopes: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of scopes) {
    const mapped = canonicalLinkedInScope(raw);
    const dedupeKey = mapped.toLowerCase();
    if (!mapped || seen.has(dedupeKey)) continue;

    // OpenID requires the "openid" scope when requesting profile claims.
    if (mapped === "profile" && !seen.has("openid")) {
      seen.add("openid");
      normalized.push("openid");
    }

    seen.add(dedupeKey);
    normalized.push(mapped);
  }

  if (!seen.has("w_member_social")) {
    normalized.push("w_member_social");
  }

  return normalized;
}

function getLinkedInScopes() {
  const configured = toSafeString(process.env.LINKEDIN_SCOPES);
  const raw = configured ? parseScopes(configured) : ["openid", "profile", "w_member_social"];
  return normalizeLinkedInScopes(raw);
}

function toYearMonthUtc(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function previousMonthYearMonthUtc(base: Date) {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return toYearMonthUtc(d);
}

function normalizeLinkedInVersion(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return "";
  const ym = digits.slice(0, 6);
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(4, 6));
  if (!Number.isInteger(year) || year < 2000 || year > 2999) return "";
  if (!Number.isInteger(month) || month < 1 || month > 12) return "";
  return ym;
}

function getLinkedInVersionCandidates() {
  const now = new Date();
  const fallback = previousMonthYearMonthUtc(now);

  const configuredRaw = toSafeString(process.env.LINKEDIN_API_VERSION);
  const configured = configuredRaw ? normalizeLinkedInVersion(configuredRaw) : "";
  if (configured) {
    return configured === fallback ? [configured] : [configured, fallback];
  }

  const current = toYearMonthUtc(now);
  return current === fallback ? [current] : [current, fallback];
}

function getClientId() {
  const value = toSafeString(process.env.LINKEDIN_CLIENT_ID);
  if (!value) {
    throw new Error("LINKEDIN_CLIENT_ID no configurado.");
  }
  return value;
}

function getClientSecret() {
  const value = toSafeString(process.env.LINKEDIN_CLIENT_SECRET);
  if (!value) {
    throw new Error("LINKEDIN_CLIENT_SECRET no configurado.");
  }
  return value;
}

function addSeconds(date: Date, seconds: number | null) {
  if (!seconds) return null;
  return new Date(date.getTime() + seconds * 1000);
}

function ensurePersonUrn(memberId: string) {
  const id = toSafeString(memberId);
  if (!id) throw new Error("No se pudo resolver el memberId de LinkedIn.");
  return `urn:li:person:${id}`;
}

function normalizeAuthorUrn(value: string, fallbackMemberId: string | null) {
  const candidate = toSafeString(value);
  if (candidate.startsWith("urn:li:person:") || candidate.startsWith("urn:li:organization:")) {
    return candidate;
  }
  if (candidate) return ensurePersonUrn(candidate);
  if (fallbackMemberId) return ensurePersonUrn(fallbackMemberId);
  throw new Error("No se pudo resolver author URN para LinkedIn.");
}

function toUnicodeBold(value: string) {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x41 && code <= 0x5a) {
      out += String.fromCodePoint(0x1d400 + (code - 0x41));
      continue;
    }
    if (code >= 0x61 && code <= 0x7a) {
      out += String.fromCodePoint(0x1d41a + (code - 0x61));
      continue;
    }
    if (code >= 0x30 && code <= 0x39) {
      out += String.fromCodePoint(0x1d7ce + (code - 0x30));
      continue;
    }
    out += char;
  }
  return out;
}

function normalizeMarkdownForLinkedIn(value: string) {
  let text = value.replace(/\r\n/g, "\n");
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s*-\s+/gm, "- ");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, "$1 ($2)");
  text = text.replace(/\*\*([^*\n][^*]*?)\*\*/g, (_m, group: string) => toUnicodeBold(group));
  text = text.replace(/_([^_\n]+)_/g, "$1");
  return text;
}

const LITTLE_TEXT_RESERVED = /([|{}@\[\]\(\)<>#\\*_~])/g;

function escapeLittleText(value: string) {
  return value.replace(LITTLE_TEXT_RESERVED, "\\$1");
}

function composeCommentary(title: string, body: string) {
  const parts = [toSafeString(title), toSafeString(body)]
    .filter(Boolean)
    .map(normalizeMarkdownForLinkedIn);
  const text = parts.join("\n\n").trim();
  if (!text) throw new Error("No hay contenido para publicar en LinkedIn.");
  // "little" text requires escaping reserved chars (e.g. *, _, #, @, ...).
  const escaped = escapeLittleText(text);
  const clipped = Array.from(escaped).slice(0, 2800).join("");
  return clipped.endsWith("\\") ? clipped.slice(0, -1) : clipped;
}

function isExpired(date: Date | null, skewSeconds = 120) {
  if (!date) return false;
  return date.getTime() <= Date.now() + skewSeconds * 1000;
}

async function hasConnectionTable() {
  if (hasConnectionTableCache === true) return true;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 AS found
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'IN_LINKEDIN_CONEXION'
       LIMIT 1`
    );
    hasConnectionTableCache = rows.length > 0 ? true : null;
  } catch {
    hasConnectionTableCache = null;
  }
  return hasConnectionTableCache === true;
}

function normalizeConnectionRow(row: LinkedInConnectionRow): LinkedInConnection {
  return {
    idCliente: Number(row.id_cliente),
    idUsuarioConectado:
      row.id_usuario_conectado === null || row.id_usuario_conectado === undefined
        ? null
        : Number(row.id_usuario_conectado),
    linkedinMemberId: row.linkedin_member_id ?? null,
    authorUrn: String(row.author_urn),
    accessToken: String(row.access_token),
    refreshToken: row.refresh_token ?? null,
    accessTokenExpiresAt: parseDate(row.access_token_expires_at),
    refreshTokenExpiresAt: parseDate(row.refresh_token_expires_at),
    scopes: row.scopes ?? null,
    source: "db",
  };
}

function getEnvConnection(idCliente: number): LinkedInConnection | null {
  const accessToken = toSafeString(process.env.LINKEDIN_ACCESS_TOKEN);
  const authorUrn = toSafeString(process.env.LINKEDIN_AUTHOR_URN);
  if (!accessToken || !authorUrn) return null;
  return {
    idCliente,
    idUsuarioConectado: null,
    linkedinMemberId: null,
    authorUrn,
    accessToken,
    refreshToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scopes: null,
    source: "env",
  };
}

async function getDbConnection(idCliente: number) {
  if (!(await hasConnectionTable())) return null;
  const [rows] = await db.execute<LinkedInConnectionRow[]>(
    `SELECT id_linkedin_conexion, id_cliente, id_usuario_conectado, linkedin_member_id, author_urn,
            access_token, refresh_token, access_token_expires_at, refresh_token_expires_at, scopes,
            created_at, updated_at
     FROM IN_LINKEDIN_CONEXION
     WHERE id_cliente = ?
     LIMIT 1`,
    [idCliente]
  );
  return rows.length ? normalizeConnectionRow(rows[0]) : null;
}

async function persistDbConnection(params: {
  idCliente: number;
  idUsuarioConectado: number | null;
  linkedinMemberId: string | null;
  authorUrn: string;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string | null;
}) {
  if (!(await hasConnectionTable())) {
    throw new Error(
      "Falta tabla IN_LINKEDIN_CONEXION. Ejecuta schemas/sql/007_create_linkedin_connection.sql."
    );
  }

  await db.execute<ResultSetHeader>(
    `INSERT INTO IN_LINKEDIN_CONEXION
     (id_cliente, id_usuario_conectado, linkedin_member_id, author_urn, access_token, refresh_token,
      access_token_expires_at, refresh_token_expires_at, scopes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       id_usuario_conectado = VALUES(id_usuario_conectado),
       linkedin_member_id = VALUES(linkedin_member_id),
       author_urn = VALUES(author_urn),
       access_token = VALUES(access_token),
       refresh_token = VALUES(refresh_token),
       access_token_expires_at = VALUES(access_token_expires_at),
       refresh_token_expires_at = VALUES(refresh_token_expires_at),
       scopes = VALUES(scopes)`,
    [
      params.idCliente,
      params.idUsuarioConectado,
      params.linkedinMemberId,
      params.authorUrn,
      params.accessToken,
      params.refreshToken,
      params.accessTokenExpiresAt,
      params.refreshTokenExpiresAt,
      params.scopes,
    ]
  );
}

async function updateDbTokens(params: {
  idCliente: number;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string | null;
}) {
  if (!(await hasConnectionTable())) return;
  await db.execute(
    `UPDATE IN_LINKEDIN_CONEXION
     SET access_token = ?,
         refresh_token = ?,
         access_token_expires_at = ?,
         refresh_token_expires_at = ?,
         scopes = COALESCE(?, scopes)
     WHERE id_cliente = ?`,
    [
      params.accessToken,
      params.refreshToken,
      params.accessTokenExpiresAt,
      params.refreshTokenExpiresAt,
      params.scopes,
      params.idCliente,
    ]
  );
}

async function refreshAccessTokenIfNeeded(connection: LinkedInConnection) {
  if (!isExpired(connection.accessTokenExpiresAt) || connection.source !== "db") {
    return connection;
  }

  const refreshToken = toSafeString(connection.refreshToken ?? "");
  if (!refreshToken) {
    throw new Error("Token de LinkedIn caducado y no hay refresh_token disponible.");
  }

  const refreshed = await refreshLinkedInAccessToken(refreshToken);
  const updated: LinkedInConnection = {
    ...connection,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
    refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt ?? connection.refreshTokenExpiresAt,
    scopes: refreshed.scopes ?? connection.scopes,
  };

  await updateDbTokens({
    idCliente: connection.idCliente,
    accessToken: updated.accessToken,
    refreshToken: updated.refreshToken,
    accessTokenExpiresAt: updated.accessTokenExpiresAt,
    refreshTokenExpiresAt: updated.refreshTokenExpiresAt,
    scopes: updated.scopes,
  });

  return updated;
}

type LinkedInPostMedia = {
  id: string;
  title?: string;
  altText?: string;
};

type LinkedInPreparedImage = {
  bytes: Uint8Array;
  mimeType: string;
};

type LinkedInMemberAnalyticsQueryType = "IMPRESSION" | "REACTION" | "COMMENT" | "RESHARE";

export type LinkedInPostStats = {
  postUrn: string;
  metrics: Record<string, number>;
  source: "member_analytics" | "social_actions" | "mixed";
  warnings: string[];
};

const SUPPORTED_LINKEDIN_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);

function normalizeImageMimeType(value: string) {
  const mime = toSafeString(value).toLowerCase().split(";")[0];
  if (mime === "image/jpg" || mime === "image/pjpeg") return "image/jpeg";
  if (SUPPORTED_LINKEDIN_IMAGE_MIME_TYPES.has(mime)) return mime;
  return "";
}

function mimeTypeFromFilePath(filePath: string) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  return "";
}

function toPublicLocalPath(imageUrl: string) {
  const raw = toSafeString(imageUrl).replace(/\\/g, "/");
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("./")) return `/${raw.slice(2)}`;
  if (raw.startsWith("uploads/")) return `/${raw}`;
  return "";
}

async function resolveLocalPublicImageSource(imageUrl: string): Promise<LinkedInPreparedImage | null> {
  const publicLocalPath = toPublicLocalPath(imageUrl);
  if (!publicLocalPath) return null;

  const normalizedPath = publicLocalPath
    .split("/")
    .filter((part) => part.length > 0)
    .join("/");
  if (!normalizedPath || normalizedPath.includes("..")) {
    throw new Error("Ruta local de imagen invalida.");
  }

  const publicDir = resolvePath(process.cwd(), "public");
  const filePath = resolvePath(publicDir, normalizedPath);
  if (!filePath.toLowerCase().startsWith(publicDir.toLowerCase())) {
    throw new Error("Ruta local de imagen fuera de /public no permitida.");
  }

  const mimeType = normalizeImageMimeType(mimeTypeFromFilePath(filePath));
  if (!mimeType) {
    throw new Error("La imagen para LinkedIn debe ser JPEG, PNG o GIF.");
  }

  let fileBuffer: Buffer;
  try {
    fileBuffer = await readFile(filePath);
  } catch {
    throw new Error(`No se pudo leer la imagen local para LinkedIn: ${publicLocalPath}`);
  }

  const bytes = Uint8Array.from(fileBuffer);
  if (!bytes.length) {
    throw new Error("La imagen local para LinkedIn esta vacia.");
  }

  return {
    bytes,
    mimeType,
  };
}

function decodeDataUrlImageSource(imageUrl: string): LinkedInPreparedImage | null {
  const m = imageUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!m) return null;

  const mimeType = normalizeImageMimeType(m[1]);
  if (!mimeType) {
    throw new Error("La imagen para LinkedIn debe ser JPEG, PNG o GIF.");
  }

  const base64 = m[2].replace(/\s+/g, "");
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  if (!bytes.length) {
    throw new Error("No se pudo decodificar la imagen en base64 para LinkedIn.");
  }

  return {
    bytes,
    mimeType,
  };
}

async function resolveImagePayload(imageUrl: string): Promise<LinkedInPreparedImage> {
  const asDataUrl = decodeDataUrlImageSource(imageUrl);
  if (asDataUrl) return asDataUrl;

  const asLocalPublicImage = await resolveLocalPublicImageSource(imageUrl);
  if (asLocalPublicImage) return asLocalPublicImage;

  if (!/^https?:\/\//i.test(imageUrl)) {
    throw new Error("Formato de imagen no valido para LinkedIn. Usa URL http(s) o data:image.");
  }

  const res = await fetch(imageUrl, { cache: "no-store" });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`No se pudo descargar la imagen para LinkedIn (${res.status}): ${text}`);
  }

  const mimeType = normalizeImageMimeType(res.headers.get("content-type") ?? "");
  if (!mimeType) {
    throw new Error("LinkedIn solo acepta imagen JPEG, PNG o GIF.");
  }

  const arrayBuffer = await res.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  if (!bytes.length) {
    throw new Error("La imagen descargada para LinkedIn esta vacia.");
  }

  return {
    bytes,
    mimeType,
  };
}

function extractLinkedInErrorCode(rawText: string) {
  if (!rawText) return "";
  try {
    const parsed = JSON.parse(rawText) as { code?: unknown } | null;
    return parsed && typeof parsed === "object" ? toSafeString(parsed.code) : "";
  } catch {
    return "";
  }
}

function canFallbackVersion(status: number, errorCode: string, index: number, total: number) {
  return status === 426 && errorCode.toUpperCase() === "NONEXISTENT_VERSION" && index < total - 1;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeLinkedInPostUrn(value: string) {
  const raw = toSafeString(value);
  if (!raw) return "";

  const candidates = [raw, safeDecodeURIComponent(raw)];
  for (const candidate of candidates) {
    const m = candidate.match(/urn:li:(?:share|ugcPost):\d+/i);
    if (m) return m[0];

    // LinkedIn feed URLs often expose urn:li:activity:<id>.
    // For API analytics/socialActions we can try the equivalent share URN.
    const activity = candidate.match(/urn:li:activity:(\d+)/i);
    if (activity?.[1]) return `urn:li:share:${activity[1]}`;

    // Also support public post URLs such as:
    // https://www.linkedin.com/posts/...-activity-1234567890-...
    // https://www.linkedin.com/posts/...-ugcpost-1234567890-...
    const activitySlug = candidate.match(/(?:^|[/?#&:_-])activity(?:%3A|:|-)(\d{6,})/i);
    if (activitySlug?.[1]) return `urn:li:share:${activitySlug[1]}`;

    const ugcSlug = candidate.match(/(?:^|[/?#&:_-])ugcpost(?:%3A|:|-)(\d{6,})/i);
    if (ugcSlug?.[1]) return `urn:li:ugcPost:${ugcSlug[1]}`;
  }
  return "";
}

function resolvePostEntity(postUrn: string) {
  if (/^urn:li:share:/i.test(postUrn)) {
    return `share:${encodeURIComponent(postUrn)}`;
  }
  if (/^urn:li:ugcpost:/i.test(postUrn)) {
    return `ugc:${encodeURIComponent(postUrn)}`;
  }
  return "";
}

function toNonNegativeNumber(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function isMemberPostAnalyticsDenied(message: string) {
  return /partnerApiMemberCreatorPostAnalytics\.FINDER-entity/i.test(message);
}

async function fetchLinkedInJsonWithVersionFallback<T>(params: { accessToken: string; url: string }) {
  const versions = getLinkedInVersionCandidates();
  let lastStatus = 0;
  let lastText = "";

  for (let i = 0; i < versions.length; i += 1) {
    const version = versions[i];
    const response = await fetch(params.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
        "Linkedin-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      cache: "no-store",
    });
    const rawText = (await response.text().catch(() => "")).slice(0, 2000);

    if (response.ok) {
      if (!rawText) return {} as T;
      try {
        return JSON.parse(rawText) as T;
      } catch {
        return {} as T;
      }
    }

    lastStatus = response.status;
    lastText = rawText;
    const code = extractLinkedInErrorCode(rawText);
    if (canFallbackVersion(response.status, code, i, versions.length)) {
      continue;
    }
    throw new Error(`LinkedIn API ${response.status}: ${rawText || "respuesta no valida"}`);
  }

  throw new Error(`LinkedIn API ${lastStatus}: ${lastText || "respuesta no valida"}`);
}

async function fetchLinkedInSocialActionsSummary(params: { accessToken: string; postUrn: string }) {
  const url = `${LINKEDIN_SOCIAL_ACTIONS_URL}/${encodeURIComponent(params.postUrn)}`;
  const data = await fetchLinkedInJsonWithVersionFallback<LinkedInSocialActionsResponse>({
    accessToken: params.accessToken,
    url,
  });

  return {
    reactions: toNonNegativeNumber(data?.likesSummary?.totalLikes),
    comments: toNonNegativeNumber(data?.commentsSummary?.totalFirstLevelComments),
  };
}

async function fetchLinkedInMemberAnalyticsCount(params: {
  accessToken: string;
  postUrn: string;
  queryType: LinkedInMemberAnalyticsQueryType;
}) {
  const entity = resolvePostEntity(params.postUrn);
  if (!entity) return null;

  const url =
    `${LINKEDIN_MEMBER_POST_ANALYTICS_URL}` +
    `?q=entity&entity=(${entity})&queryType=${params.queryType}&aggregation=TOTAL`;

  const data = await fetchLinkedInJsonWithVersionFallback<LinkedInMemberPostAnalyticsResponse>({
    accessToken: params.accessToken,
    url,
  });

  const elements = Array.isArray(data?.elements) ? data.elements : [];
  if (!elements.length) return 0;
  return elements.reduce((acc, item) => {
    const c = toNonNegativeNumber(item?.count);
    return acc + (c ?? 0);
  }, 0);
}

async function collectLinkedInPostStats(connection: LinkedInConnection, postRef: string): Promise<LinkedInPostStats> {
  const postUrn = normalizeLinkedInPostUrn(postRef);
  if (!postUrn) {
    throw new Error("No se pudo resolver el URN del post de LinkedIn.");
  }

  const warnings: string[] = [];
  const metrics: Record<string, number> = {};
  let usedAnalytics = false;
  let usedSocial = false;

  const analyticsPlan: Array<{ queryType: LinkedInMemberAnalyticsQueryType; metricCode: string }> = [
    { queryType: "IMPRESSION", metricCode: "IMPRESIONES" },
    { queryType: "REACTION", metricCode: "REACCIONES" },
    { queryType: "COMMENT", metricCode: "COMENTARIOS" },
    { queryType: "RESHARE", metricCode: "COMPARTIDOS" },
  ];

  for (const item of analyticsPlan) {
    try {
      const count = await fetchLinkedInMemberAnalyticsCount({
        accessToken: connection.accessToken,
        postUrn,
        queryType: item.queryType,
      });
      if (count !== null) {
        metrics[item.metricCode] = count;
        usedAnalytics = true;
      }
    } catch (e: unknown) {
      warnings.push(`Analytics ${item.queryType}: ${errorMessage(e)}`);
    }
  }

  const needsSocialFallback = metrics.REACCIONES === undefined || metrics.COMENTARIOS === undefined;
  if (needsSocialFallback) {
    try {
      const summary = await fetchLinkedInSocialActionsSummary({
        accessToken: connection.accessToken,
        postUrn,
      });
      if (metrics.REACCIONES === undefined && summary.reactions !== null) {
        metrics.REACCIONES = summary.reactions;
      }
      if (metrics.COMENTARIOS === undefined && summary.comments !== null) {
        metrics.COMENTARIOS = summary.comments;
      }
      usedSocial = true;
    } catch (e: unknown) {
      warnings.push(`SocialActions: ${errorMessage(e)}`);
    }
  }

  if (!Object.keys(metrics).length) {
    if (warnings.some(isMemberPostAnalyticsDenied)) {
      throw new Error(
        "LinkedIn no permite leer IMPRESIONES porque esta aplicacion no esta autorizada " +
          "para r_member_postAnalytics (Community Management API)."
      );
    }
    throw new Error(
      warnings[0] ?? "LinkedIn no devolvio metricas para este post. Revisa permisos/scopes del token."
    );
  }

  const source = usedAnalytics && usedSocial ? "mixed" : usedAnalytics ? "member_analytics" : "social_actions";
  return {
    postUrn,
    metrics,
    source,
    warnings,
  };
}

async function initializeLinkedInImageUpload(params: { accessToken: string; ownerUrn: string }) {
  const bodyPayload = JSON.stringify({
    initializeUploadRequest: {
      owner: params.ownerUrn,
    },
  });
  const versions = getLinkedInVersionCandidates();
  let lastStatus = 0;
  let lastText = "";

  for (let i = 0; i < versions.length; i += 1) {
    const version = versions[i];
    const response = await fetch(`${LINKEDIN_IMAGES_URL}?action=initializeUpload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
        "Linkedin-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: bodyPayload,
      cache: "no-store",
    });

    const rawText = (await response.text().catch(() => "")).slice(0, 1000);
    if (response.ok) {
      let parsed: LinkedInImageInitializeUploadResponse | null = null;
      if (rawText) {
        try {
          parsed = JSON.parse(rawText) as LinkedInImageInitializeUploadResponse;
        } catch {
          parsed = null;
        }
      }
      const uploadUrl = toSafeString(parsed?.value?.uploadUrl);
      const imageUrn = toSafeString(parsed?.value?.image);
      if (!uploadUrl || !imageUrn) {
        throw new Error("LinkedIn no devolvio uploadUrl o image URN para la imagen.");
      }
      return {
        uploadUrl,
        imageUrn,
      };
    }

    lastStatus = response.status;
    lastText = rawText;
    const errorCode = extractLinkedInErrorCode(rawText);
    if (canFallbackVersion(response.status, errorCode, i, versions.length)) {
      continue;
    }
    throw new Error(`LinkedIn API ${response.status}: ${rawText || "respuesta no valida"}`);
  }

  throw new Error(`LinkedIn API ${lastStatus}: ${lastText || "respuesta no valida"}`);
}

async function uploadBinaryToLinkedIn(params: {
  uploadUrl: string;
  accessToken: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const send = async (withAuth: boolean) => {
    const headers: Record<string, string> = {
      "Content-Type": params.mimeType,
    };
    if (withAuth) {
      headers.Authorization = `Bearer ${params.accessToken}`;
    }
    return fetch(params.uploadUrl, {
      method: "PUT",
      headers,
      body: Buffer.from(params.bytes),
      cache: "no-store",
    });
  };

  let response = await send(true);
  if (!response.ok && (response.status === 401 || response.status === 403)) {
    response = await send(false);
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`LinkedIn image upload fallo (${response.status}): ${text || "respuesta no valida"}`);
  }
}

async function resolveLinkedInPostMedia(params: {
  accessToken: string;
  authorUrn: string;
  imageUrl: string;
  title: string;
}): Promise<LinkedInPostMedia> {
  const image = await resolveImagePayload(params.imageUrl);
  const initialized = await initializeLinkedInImageUpload({
    accessToken: params.accessToken,
    ownerUrn: params.authorUrn,
  });
  await uploadBinaryToLinkedIn({
    uploadUrl: initialized.uploadUrl,
    accessToken: params.accessToken,
    mimeType: image.mimeType,
    bytes: image.bytes,
  });

  const title = toSafeString(params.title).slice(0, 200) || "Imagen";
  return {
    id: initialized.imageUrn,
    title,
    altText: title,
  };
}

async function postToLinkedIn(params: {
  accessToken: string;
  authorUrn: string;
  commentary: string;
  media?: LinkedInPostMedia | null;
}) {
  const payload: Record<string, unknown> = {
    author: params.authorUrn,
    commentary: params.commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (params.media?.id) {
    payload.content = {
      media: {
        id: params.media.id,
        title: params.media.title,
        altText: params.media.altText,
      },
    };
  }

  const bodyPayload = JSON.stringify(payload);

  const versions = getLinkedInVersionCandidates();
  let lastStatus = 0;
  let lastText = "";

  for (let i = 0; i < versions.length; i += 1) {
    const version = versions[i];
    const response = await fetch(LINKEDIN_POSTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
        "Linkedin-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: bodyPayload,
      cache: "no-store",
    });

    const rawText = (await response.text().catch(() => "")).slice(0, 1000);

    if (response.ok) {
      let data: Record<string, unknown> | null = null;
      if (rawText) {
        try {
          const parsed = JSON.parse(rawText) as unknown;
          if (parsed && typeof parsed === "object") {
            data = parsed as Record<string, unknown>;
          }
        } catch {
          data = null;
        }
      }
      const urnFromHeader = toSafeString(response.headers.get("x-restli-id"));
      const urnFromBody = data ? toSafeString(data.id) : "";
      const postUrn = urnFromHeader || urnFromBody || null;
      return {
        postUrn,
      };
    }

    lastStatus = response.status;
    lastText = rawText;
    const errorCode = extractLinkedInErrorCode(rawText);
    if (canFallbackVersion(response.status, errorCode, i, versions.length)) {
      continue;
    }
    throw new Error(`LinkedIn API ${response.status}: ${rawText || "respuesta no valida"}`);
  }

  throw new Error(`LinkedIn API ${lastStatus}: ${lastText || "respuesta no valida"}`);
}

async function fetchMemberId(accessToken: string) {
  const meRes = await fetch(LINKEDIN_MEMBER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    cache: "no-store",
  });

  if (meRes.ok) {
    const meData = (await parseJsonSafe<LinkedInMemberResponse>(meRes)) ?? {};
    const id = toSafeString(meData.id);
    if (id) return id;
  }

  const userInfoRes = await fetch(LINKEDIN_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!userInfoRes.ok) {
    const text = (await userInfoRes.text().catch(() => "")).slice(0, 300);
    throw new Error(`No se pudo resolver perfil de LinkedIn (${userInfoRes.status}): ${text}`);
  }

  const info = (await parseJsonSafe<LinkedInUserInfoResponse>(userInfoRes)) ?? {};
  const sub = toSafeString(info.sub);
  if (!sub) throw new Error("LinkedIn no devolvio sub/id del usuario autenticado.");
  return sub;
}

function normalizeTokenResponse(raw: LinkedInTokenResponse) {
  const now = new Date();
  const accessToken = toSafeString(raw.access_token);
  const refreshToken = toSafeString(raw.refresh_token) || null;
  const expiresIn = toPositiveSeconds(raw.expires_in);
  const refreshExpiresIn = toPositiveSeconds(raw.refresh_token_expires_in);
  const scopes = toSafeString(raw.scope) || null;
  if (!accessToken) throw new Error("LinkedIn no devolvio access_token.");

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: addSeconds(now, expiresIn),
    refreshTokenExpiresAt: addSeconds(now, refreshExpiresIn),
    scopes,
  };
}

export function buildLinkedInAuthUrl(params: { redirectUri: string; state: string }) {
  const search = new URLSearchParams({
    response_type: "code",
    client_id: getClientId(),
    redirect_uri: params.redirectUri,
    state: params.state,
    scope: getLinkedInScopes().join(" "),
  });
  return `${LINKEDIN_AUTH_URL}?${search.toString()}`;
}

export async function exchangeLinkedInCodeForToken(params: { code: string; redirectUri: string }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: getClientId(),
    client_secret: getClientSecret(),
  });

  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 500);
    throw new Error(`LinkedIn token exchange fallo (${res.status}): ${text}`);
  }

  const json = (await parseJsonSafe<LinkedInTokenResponse>(res)) ?? {};
  return normalizeTokenResponse(json);
}

export async function refreshLinkedInAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: getClientId(),
    client_secret: getClientSecret(),
  });

  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 500);
    throw new Error(`LinkedIn refresh token fallo (${res.status}): ${text}`);
  }

  const json = (await parseJsonSafe<LinkedInTokenResponse>(res)) ?? {};
  return normalizeTokenResponse(json);
}

export async function saveLinkedInOAuthConnection(params: {
  idCliente: number;
  idUsuarioConectado: number;
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string | null;
  authorUrn?: string | null;
}) {
  const memberId = await fetchMemberId(params.accessToken);
  const authorUrn = normalizeAuthorUrn(params.authorUrn ?? "", memberId);
  await persistDbConnection({
    idCliente: params.idCliente,
    idUsuarioConectado: params.idUsuarioConectado,
    linkedinMemberId: memberId,
    authorUrn,
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    accessTokenExpiresAt: params.accessTokenExpiresAt,
    refreshTokenExpiresAt: params.refreshTokenExpiresAt,
    scopes: params.scopes,
  });
  return {
    memberId,
    authorUrn,
  };
}

export async function getLinkedInConnection(idCliente: number) {
  const dbConnection = await getDbConnection(idCliente);
  if (dbConnection) return dbConnection;
  return getEnvConnection(idCliente);
}

export async function getLinkedInConnectionStatus(idCliente: number): Promise<LinkedInConnectionStatus> {
  const connection = await getLinkedInConnection(idCliente);
  if (!connection) {
    return {
      connected: false,
      source: null,
      authorUrn: null,
      memberId: null,
      expiresAt: null,
      scopes: null,
    };
  }

  return {
    connected: true,
    source: connection.source,
    authorUrn: connection.authorUrn,
    memberId: connection.linkedinMemberId,
    expiresAt: toIsoOrNull(connection.accessTokenExpiresAt),
    scopes: connection.scopes,
  };
}

export async function disconnectLinkedInConnection(idCliente: number) {
  if (!(await hasConnectionTable())) return false;
  const [result] = await db.execute<ResultSetHeader>(
    `DELETE FROM IN_LINKEDIN_CONEXION
     WHERE id_cliente = ?`,
    [idCliente]
  );
  return Number(result.affectedRows ?? 0) > 0;
}

export async function fetchLinkedInPostStats(params: {
  idCliente: number;
  postRef: string;
}): Promise<LinkedInPostStats> {
  const connection = await getLinkedInConnection(params.idCliente);
  if (!connection) {
    throw new Error("No hay cuenta de LinkedIn conectada para este cliente.");
  }

  let usableConnection = await refreshAccessTokenIfNeeded(connection);

  const run = async (c: LinkedInConnection) => collectLinkedInPostStats(c, params.postRef);

  try {
    return await run(usableConnection);
  } catch (e: unknown) {
    const message = errorMessage(e);
    const canRetry =
      /401|invalid token|expired|unauthorized|oauth/i.test(message) &&
      usableConnection.source === "db" &&
      toSafeString(usableConnection.refreshToken ?? "").length > 0;

    if (!canRetry) throw e;

    usableConnection = await refreshAccessTokenIfNeeded({
      ...usableConnection,
      accessTokenExpiresAt: new Date(0),
    });
    return run(usableConnection);
  }
}

export async function publishTenantNewsToLinkedIn(params: {
  idCliente: number;
  title: string;
  body: string;
  imageUrl?: string | null;
}) {
  const connection = await getLinkedInConnection(params.idCliente);
  if (!connection) {
    throw new Error("No hay cuenta de LinkedIn conectada para este cliente.");
  }

  const commentary = composeCommentary(params.title, params.body);
  const imageUrl = toSafeString(params.imageUrl ?? "");
  let usableConnection = await refreshAccessTokenIfNeeded(connection);

  const publish = async (c: LinkedInConnection) => {
    const media = imageUrl
      ? await resolveLinkedInPostMedia({
          accessToken: c.accessToken,
          authorUrn: c.authorUrn,
          imageUrl,
          title: params.title,
        })
      : null;
    return postToLinkedIn({
      accessToken: c.accessToken,
      authorUrn: c.authorUrn,
      commentary,
      media,
    });
  };

  try {
    return await publish(usableConnection);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const canRetry =
      /401|invalid token|expired|unauthorized|oauth/i.test(message) &&
      usableConnection.source === "db" &&
      toSafeString(usableConnection.refreshToken ?? "").length > 0;

    if (!canRetry) throw e;

    usableConnection = await refreshAccessTokenIfNeeded({
      ...usableConnection,
      accessTokenExpiresAt: new Date(0),
    });
    return publish(usableConnection);
  }
}
