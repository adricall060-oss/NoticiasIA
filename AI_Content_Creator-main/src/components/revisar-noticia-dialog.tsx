/* eslint-disable @next/next/no-img-element */
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Bold, Crop, Eraser, Heading1, Heading2, Italic, Link2, List, Ruler, SunMedium } from "lucide-react";
import type { Noticia } from "@/lib/types";
import { api } from "@/lib/api";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

type TabKey = "contenido" | "imagen" | "publicar";
type ImageToolKey = "crop" | "light" | "size";
type CropResizeHandle = "right" | "bottom" | "corner";

const DEFAULT_OUTPUT_WIDTH = 1280;
const DEFAULT_OUTPUT_HEIGHT = 720;
const MAX_STORED_DATA_URL_LENGTH = 64_000;

function normalizeImageUrlInput(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:image/")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (/^www\./i.test(value)) return `https://${value}`;
  return value;
}

function toEditorImageSource(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  if (value.startsWith("/api/image-proxy?")) return value;
  if (/^https?:\/\//i.test(value)) {
    const qs = new URLSearchParams({ url: value });
    return `/api/image-proxy?${qs.toString()}`;
  }
  return value;
}

function toPreviewImageSource(raw: string) {
  return toEditorImageSource(raw);
}

function renderInlineMarkdown(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|_([^_]+)_)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let idx = 0;

  while ((m = pattern.exec(value)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(<span key={`${keyPrefix}-t-${idx++}`}>{value.slice(lastIndex, m.index)}</span>);
    }

    const [full, , linkText, linkUrl, boldText, italicText] = m;
    if (linkText && linkUrl) {
      nodes.push(
        <a
          key={`${keyPrefix}-a-${idx++}`}
          href={linkUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2"
        >
          {linkText}
        </a>
      );
    } else if (boldText) {
      nodes.push(<strong key={`${keyPrefix}-b-${idx++}`}>{boldText}</strong>);
    } else if (italicText) {
      nodes.push(<em key={`${keyPrefix}-i-${idx++}`}>{italicText}</em>);
    } else {
      nodes.push(<span key={`${keyPrefix}-u-${idx++}`}>{full}</span>);
    }

    lastIndex = m.index + full.length;
  }

  if (lastIndex < value.length) {
    nodes.push(<span key={`${keyPrefix}-tail`}>{value.slice(lastIndex)}</span>);
  }

  return nodes;
}

function renderBodyRich(value: string) {
  const lines = value.split("\n");
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];
  let idx = 0;

  const flushList = () => {
    if (!listItems.length) return;
    const current = listItems;
    listItems = [];
    nodes.push(
      <ul key={`ul-${idx++}`} className="ml-5 list-disc space-y-1">
        {current.map((item, itemIdx) => (
          <li key={`li-${idx}-${itemIdx}`}>{renderInlineMarkdown(item, `li-${idx}-${itemIdx}`)}</li>
        ))}
      </ul>
    );
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("- ")) {
      listItems.push(line.replace(/^\s*-\s+/, ""));
      continue;
    }

    flushList();

    if (line.startsWith("# ")) {
      nodes.push(
        <h3 key={`h1-${idx++}`} className="text-xl font-semibold leading-snug">
          {renderInlineMarkdown(line.slice(2), `h1-${idx}`)}
        </h3>
      );
      continue;
    }

    if (line.startsWith("## ")) {
      nodes.push(
        <h4 key={`h2-${idx++}`} className="text-lg font-semibold leading-snug">
          {renderInlineMarkdown(line.slice(3), `h2-${idx}`)}
        </h4>
      );
      continue;
    }

    if (!line.trim()) {
      nodes.push(<div key={`sp-${idx++}`} className="h-2" />);
      continue;
    }

    nodes.push(
      <p key={`p-${idx++}`} className="whitespace-pre-wrap">
        {renderInlineMarkdown(line, `p-${idx}`)}
      </p>
    );
  }

  flushList();
  return nodes;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

type CanvasExportResult = {
  dataUrl: string;
  width: number;
  height: number;
  quality: number;
  reduced: boolean;
};

function exportCanvasUnderLimit(sourceCanvas: HTMLCanvasElement, maxLength: number): CanvasExportResult {
  const temp = document.createElement("canvas");
  const tctx = temp.getContext("2d");
  if (!tctx) throw new Error("No se pudo preparar el editor de imagen.");

  let scale = 1;
  let quality = 0.9;
  let best: CanvasExportResult | null = null;

  for (let scaleAttempt = 0; scaleAttempt < 8; scaleAttempt += 1) {
    const width = Math.max(240, Math.round(sourceCanvas.width * scale));
    const height = Math.max(240, Math.round(sourceCanvas.height * scale));
    temp.width = width;
    temp.height = height;

    tctx.clearRect(0, 0, width, height);
    tctx.drawImage(sourceCanvas, 0, 0, width, height);

    quality = 0.9;
    for (let qualityAttempt = 0; qualityAttempt < 8; qualityAttempt += 1) {
      const dataUrl = temp.toDataURL("image/jpeg", quality);
      const candidate: CanvasExportResult = {
        dataUrl,
        width,
        height,
        quality,
        reduced: width !== sourceCanvas.width || height !== sourceCanvas.height || quality !== 0.9,
      };

      if (!best || candidate.dataUrl.length < best.dataUrl.length) {
        best = candidate;
      }

      if (dataUrl.length <= maxLength) {
        return candidate;
      }
      quality = Math.max(0.35, quality - 0.1);
    }

    scale *= 0.85;
  }

  if (best && best.dataUrl.length <= maxLength) return best;
  throw new Error("La imagen editada sigue siendo demasiado grande para guardarla.");
}

function loadImageForEditor(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const isData = src.startsWith("data:image/");
    let retriedWithoutCors = false;

    const attemptLoad = (useCors: boolean) => {
      const img = new Image();
      if (useCors && !isData) {
        img.crossOrigin = "anonymous";
      }

      img.onload = () => resolve(img);
      img.onerror = () => {
        if (useCors && !isData && !retriedWithoutCors) {
          retriedWithoutCors = true;
          attemptLoad(false);
          return;
        }
        reject(new Error("No se pudo cargar la imagen para editar."));
      };
      img.src = src;
    };

    attemptLoad(!isData);
  });
}

async function renderEditedCanvasFromSource(
  src: string,
  settings: {
    width: number;
    height: number;
    zoom: number;
    brightness: number;
    contrast: number;
    offsetX: number;
    offsetY: number;
  }
): Promise<HTMLCanvasElement> {
  const img = await loadImageForEditor(src);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar el editor de imagen.");

  const cw = settings.width;
  const ch = settings.height;
  canvas.width = cw;
  canvas.height = ch;

  ctx.save();
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  ctx.filter = `brightness(${settings.brightness}%) contrast(${settings.contrast}%)`;

  const fitScale = Math.max(cw / img.width, ch / img.height);
  const drawW = img.width * fitScale * settings.zoom;
  const drawH = img.height * fitScale * settings.zoom;
  const x = (cw - drawW) / 2 + settings.offsetX;
  const y = (ch - drawH) / 2 + settings.offsetY;

  ctx.drawImage(img, x, y, drawW, drawH);
  ctx.restore();

  return canvas;
}

export function RevisarNoticiaDialog({
  noticia,
  open,
  onOpenChange,
  onChanged,
}: {
  noticia: Noticia | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const blueButtonClass =
    "bg-blue-700 cursor-pointer text-white hover:bg-blue-700/95 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm";
  const dangerButtonClass =
    "bg-white cursor-pointer text-red-700 border border-red-200 hover:border-red-300 hover:bg-red-50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm";
  const activeTabClass =
    "data-[state=active]:bg-blue-700 data-[state=active]:text-white data-[state=active]:hover:bg-blue-700/95 data-[state=active]:font-semibold enabled:hover:font-semibold";

  const [tab, setTab] = useState<TabKey>("contenido");
  const [loading, setLoading] = useState(false);

  const [titulo, setTitulo] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [imgUrl, setImgUrl] = useState("");

  const [editorSource, setEditorSource] = useState("");
  const [editorZoom, setEditorZoom] = useState(1);
  const [editorBrightness, setEditorBrightness] = useState(100);
  const [editorContrast, setEditorContrast] = useState(100);
  const [editorOffsetX, setEditorOffsetX] = useState(0);
  const [editorOffsetY, setEditorOffsetY] = useState(0);
  const [editorOutputWidth, setEditorOutputWidth] = useState(DEFAULT_OUTPUT_WIDTH);
  const [editorOutputHeight, setEditorOutputHeight] = useState(DEFAULT_OUTPUT_HEIGHT);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isResizingCrop, setIsResizingCrop] = useState<CropResizeHandle | null>(null);
  const [activeImageTool, setActiveImageTool] = useState<ImageToolKey>("crop");

  const cuerpoRef = useRef<HTMLTextAreaElement | null>(null);
  const editorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageDragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const cropResizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const [unlockedImagen, setUnlockedImagen] = useState(false);
  const [unlockedPublicar, setUnlockedPublicar] = useState(false);

  const estado = String(noticia?.estado_codigo ?? "PENDIENTE").toUpperCase();
  const published = estado === "PUBLICADO";

  useEffect(() => {
    if (!open || !noticia) return;

    setTab("contenido");

    const initialTitulo = noticia.titulo ?? "";
    const initialCuerpo = noticia.cuerpo ?? "";
    const initialImage = noticia.imagen_url ?? "";

    setTitulo(initialTitulo);
    setCuerpo(initialCuerpo);
      setImgUrl(normalizeImageUrlInput(initialImage));
    setEditorZoom(1);
    setEditorBrightness(100);
    setEditorContrast(100);
    setEditorOffsetX(0);
    setEditorOffsetY(0);
    setEditorOutputWidth(DEFAULT_OUTPUT_WIDTH);
    setEditorOutputHeight(DEFAULT_OUTPUT_HEIGHT);
    setActiveImageTool("crop");
    setEditorError(null);
    setEditorDirty(false);

    const canImagen = estado === "CUERPO_OK" || estado === "IMG_OK";
    const canPublicar = estado === "IMG_OK";

    setUnlockedImagen(canImagen);
    setUnlockedPublicar(canPublicar);
  }, [open, noticia, estado]);

  useEffect(() => {
    setEditorSource(toEditorImageSource(imgUrl));
    setEditorDirty(false);
  }, [imgUrl]);

  useEffect(() => {
    const canvas = editorCanvasRef.current;
    const src = editorSource.trim();
    if (!canvas || !src) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let canceled = false;
    void loadImageForEditor(src)
      .then((img) => {
        if (canceled) return;
        const cw = editorOutputWidth;
        const ch = editorOutputHeight;
        canvas.width = cw;
        canvas.height = ch;

        ctx.save();
        ctx.clearRect(0, 0, cw, ch);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, cw, ch);
        ctx.filter = `brightness(${editorBrightness}%) contrast(${editorContrast}%)`;

        const fitScale = Math.max(cw / img.width, ch / img.height);
        const drawW = img.width * fitScale * editorZoom;
        const drawH = img.height * fitScale * editorZoom;
        const x = (cw - drawW) / 2 + editorOffsetX;
        const y = (ch - drawH) / 2 + editorOffsetY;

        ctx.drawImage(img, x, y, drawW, drawH);
        ctx.restore();
        setEditorError(null);
      })
      .catch(() => {
        if (canceled) return;
        setEditorError("No se pudo cargar la imagen para editar.");
      });

    return () => {
      canceled = true;
    };
  }, [
    editorSource,
    editorZoom,
    editorBrightness,
    editorContrast,
    editorOffsetX,
    editorOffsetY,
    editorOutputWidth,
    editorOutputHeight,
  ]);

  const canGoImagen = useMemo(() => unlockedImagen, [unlockedImagen]);
  const canGoPublicar = useMemo(() => unlockedPublicar, [unlockedPublicar]);

  const disableImagen = !canGoImagen && tab !== "imagen";
  const disablePublicar = !canGoPublicar && tab !== "publicar";

  const cropViewport = useMemo(() => {
    const maxWidth = 820;
    const maxHeight = 460;
    const scale = Math.min(maxWidth / editorOutputWidth, maxHeight / editorOutputHeight, 1);
    return {
      scale,
      width: Math.max(180, Math.round(editorOutputWidth * scale)),
      height: Math.max(180, Math.round(editorOutputHeight * scale)),
    };
  }, [editorOutputWidth, editorOutputHeight]);

  function applyWrap(marker: string) {
    const textarea = cuerpoRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const hasSelection = end > start;
    const selectedText = cuerpo.slice(start, end);
    const markerLen = marker.length;
    const canUnwrap =
      hasSelection &&
      selectedText.startsWith(marker) &&
      selectedText.endsWith(marker) &&
      selectedText.length > markerLen * 2;
    const replacement = !hasSelection
      ? `${marker}${marker}`
      : canUnwrap
        ? selectedText.slice(markerLen, -markerLen)
        : `${marker}${selectedText}${marker}`;

    const next = `${cuerpo.slice(0, start)}${replacement}${cuerpo.slice(end)}`;
    setCuerpo(next);

    requestAnimationFrame(() => {
      textarea.focus();
      if (!hasSelection) {
        const cursor = start + markerLen;
        textarea.setSelectionRange(cursor, cursor);
        return;
      }

      if (canUnwrap) {
        textarea.setSelectionRange(start, start + replacement.length);
        return;
      }

      textarea.setSelectionRange(start + markerLen, end + markerLen);
    });
  }

  function applyHeading(level: 1 | 2) {
    const textarea = cuerpoRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const lineStart = cuerpo.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIndex = cuerpo.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? cuerpo.length : lineEndIndex;
    const block = cuerpo.slice(lineStart, lineEnd);
    const prefix = level === 1 ? "# " : "## ";
    const replacement = block
      .split("\n")
      .map((line) => {
        const clean = line.replace(/^\s*#{1,6}\s+/, "");
        return clean.trim() ? `${prefix}${clean}` : clean;
      })
      .join("\n");

    const next = `${cuerpo.slice(0, lineStart)}${replacement}${cuerpo.slice(lineEnd)}`;
    setCuerpo(next);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + replacement.length);
    });
  }

  function toggleList() {
    const textarea = cuerpoRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const lineStart = cuerpo.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIndex = cuerpo.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? cuerpo.length : lineEndIndex;
    const block = cuerpo.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const allListed = lines.filter((l) => l.trim().length > 0).every((l) => /^\s*-\s+/.test(l));
    const replacement = lines
      .map((line) => {
        if (!line.trim()) return line;
        return allListed ? line.replace(/^\s*-\s+/, "") : `- ${line.replace(/^\s*-\s+/, "")}`;
      })
      .join("\n");

    const next = `${cuerpo.slice(0, lineStart)}${replacement}${cuerpo.slice(lineEnd)}`;
    setCuerpo(next);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + replacement.length);
    });
  }

  function applyLink() {
    const textarea = cuerpoRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const hasSelection = end > start;
    const selectedText = hasSelection ? cuerpo.slice(start, end) : "texto";
    const rawUrl = window.prompt("URL del enlace (https://...):", "https://");
    if (!rawUrl) return;
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const replacement = `[${selectedText}](${url})`;
    const next = `${cuerpo.slice(0, start)}${replacement}${cuerpo.slice(end)}`;
    setCuerpo(next);

    requestAnimationFrame(() => {
      textarea.focus();
      if (!hasSelection) {
        textarea.setSelectionRange(start + 1, start + 1 + selectedText.length);
        return;
      }
      textarea.setSelectionRange(start, start + replacement.length);
    });
  }

  function clearFormatting() {
    const textarea = cuerpoRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const hasSelection = end > start;
    const target = hasSelection ? cuerpo.slice(start, end) : cuerpo;
    const cleaned = target
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/^\s*-\s+/gm, "");

    const next = hasSelection
      ? `${cuerpo.slice(0, start)}${cleaned}${cuerpo.slice(end)}`
      : cleaned;
    setCuerpo(next);

    requestAnimationFrame(() => {
      textarea.focus();
      if (!hasSelection) {
        textarea.setSelectionRange(0, 0);
        return;
      }
      textarea.setSelectionRange(start, start + cleaned.length);
    });
  }

  async function confirmContenido() {
    if (!noticia) return;
    setLoading(true);
    try {
      await api.confirmContent(noticia.id, { titulo_confirmado: titulo, cuerpo_confirmado: cuerpo });
      setUnlockedImagen(true);
      setTab("imagen");
      onChanged();
    } finally {
      setLoading(false);
    }
  }

  async function onImageFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setEditorError("El archivo debe ser una imagen.");
      return;
    }
    if (file.size > 5_000_000) {
      setEditorError("La imagen supera 5MB. Usa una imagen mas ligera.");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl.startsWith("data:image/")) {
        setEditorError("No se pudo procesar la imagen.");
        return;
      }
      setImgUrl(dataUrl);
      setEditorSource(toEditorImageSource(dataUrl));
      setEditorZoom(1);
      setEditorBrightness(100);
      setEditorContrast(100);
      setEditorOffsetX(0);
      setEditorOffsetY(0);
      setEditorOutputWidth(DEFAULT_OUTPUT_WIDTH);
      setEditorOutputHeight(DEFAULT_OUTPUT_HEIGHT);
      setEditorError(null);
      setEditorDirty(false);
    } catch {
      setEditorError("No se pudo leer la imagen seleccionada.");
    }
  }

  function resetImageEditor() {
    setEditorZoom(1);
    setEditorBrightness(100);
    setEditorContrast(100);
    setEditorOffsetX(0);
    setEditorOffsetY(0);
    setEditorOutputWidth(DEFAULT_OUTPUT_WIDTH);
    setEditorOutputHeight(DEFAULT_OUTPUT_HEIGHT);
    setIsDraggingImage(false);
    setIsResizingCrop(null);
    imageDragStartRef.current = null;
    cropResizeStartRef.current = null;
    setEditorDirty(false);
    setEditorError(null);
  }

  function getCanvasPointer(e: ReactMouseEvent<HTMLCanvasElement>) {
    const canvas = editorCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function onCanvasMouseDown(e: ReactMouseEvent<HTMLCanvasElement>) {
    const p = getCanvasPointer(e);
    if (!p) return;
    e.preventDefault();
    imageDragStartRef.current = {
      x: p.x,
      y: p.y,
      offsetX: editorOffsetX,
      offsetY: editorOffsetY,
    };
    setIsDraggingImage(true);
  }

  function onCanvasMouseMove(e: ReactMouseEvent<HTMLCanvasElement>) {
    const start = imageDragStartRef.current;
    if (!start) return;
    const p = getCanvasPointer(e);
    if (!p) return;
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    setEditorOffsetX(Math.round(start.offsetX + dx));
    setEditorOffsetY(Math.round(start.offsetY + dy));
    setEditorDirty(true);
  }

  function onCanvasMouseUp() {
    imageDragStartRef.current = null;
    setIsDraggingImage(false);
  }

  function onResizeHandleDown(handle: CropResizeHandle, e: ReactMouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    cropResizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: editorOutputWidth,
      height: editorOutputHeight,
    };
    setIsResizingCrop(handle);
  }

  useEffect(() => {
    if (!isResizingCrop) return;

    const onMove = (e: MouseEvent) => {
      const start = cropResizeStartRef.current;
      if (!start) return;

      const dxPx = (e.clientX - start.x) / cropViewport.scale;
      const dyPx = (e.clientY - start.y) / cropViewport.scale;
      const nextW =
        isResizingCrop === "right" || isResizingCrop === "corner"
          ? Math.min(4000, Math.max(200, Math.round(start.width + dxPx)))
          : start.width;
      const nextH =
        isResizingCrop === "bottom" || isResizingCrop === "corner"
          ? Math.min(4000, Math.max(200, Math.round(start.height + dyPx)))
          : start.height;

      setEditorOutputWidth(nextW);
      setEditorOutputHeight(nextH);
      setEditorDirty(true);
    };

    const onUp = () => {
      setIsResizingCrop(null);
      cropResizeStartRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizingCrop, cropViewport.scale]);

  async function applyImageEdits() {
    const src = editorSource.trim();
    if (!src) return;
    try {
      const editedCanvas = await renderEditedCanvasFromSource(src, {
        width: editorOutputWidth,
        height: editorOutputHeight,
        zoom: editorZoom,
        brightness: editorBrightness,
        contrast: editorContrast,
        offsetX: editorOffsetX,
        offsetY: editorOffsetY,
      });
      const exported = exportCanvasUnderLimit(editedCanvas, MAX_STORED_DATA_URL_LENGTH);
      setImgUrl(exported.dataUrl);
      setEditorSource(exported.dataUrl);
      setEditorOutputWidth(exported.width);
      setEditorOutputHeight(exported.height);
      setEditorZoom(1);
      setEditorBrightness(100);
      setEditorContrast(100);
      setEditorOffsetX(0);
      setEditorOffsetY(0);
      setEditorDirty(false);
      setEditorError(null);
      if (exported.reduced) {
        setEditorError(
          `Se optimizo la imagen a ${exported.width}x${exported.height} (calidad ${Math.round(
            exported.quality * 100
          )}%) para que pueda guardarse.`
        );
      }
    } catch {
      setEditorError("No se pudo exportar la imagen editada. Reduce ancho/alto o usa una imagen mas ligera.");
    }
  }

  async function persistImageForStorage(image: string) {
    const value = image.trim();
    if (!value.startsWith("data:image/")) return value;

    const res = await api.uploadImageDataUrl({ data_url: value });
    return String(res.data?.url ?? "").trim();
  }

  async function confirmImagen() {
    if (!noticia) return;
    setLoading(true);
    try {
      let finalImage = imgUrl.trim();
      if (editorSource.trim() && editorDirty) {
        try {
          const editedCanvas = await renderEditedCanvasFromSource(editorSource.trim(), {
            width: editorOutputWidth,
            height: editorOutputHeight,
            zoom: editorZoom,
            brightness: editorBrightness,
            contrast: editorContrast,
            offsetX: editorOffsetX,
            offsetY: editorOffsetY,
          });
          const exported = exportCanvasUnderLimit(editedCanvas, MAX_STORED_DATA_URL_LENGTH);
          finalImage = exported.dataUrl;
          setEditorOutputWidth(exported.width);
          setEditorOutputHeight(exported.height);
          setEditorDirty(false);
        } catch {
          setEditorError("No se pudo exportar la imagen editada. Reduce ancho/alto o usa una imagen mas ligera.");
          return;
        }
      }

      try {
        finalImage = await persistImageForStorage(finalImage);
      } catch (error: unknown) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "No se pudo guardar la imagen editada.";
        setEditorError(message);
        return;
      }

      if (!finalImage) {
        setEditorError("No se pudo guardar la imagen.");
        return;
      }

      await api.confirmImage(noticia.id, { imagen_url_confirmada: finalImage });
      setImgUrl(normalizeImageUrlInput(finalImage));
      setUnlockedPublicar(true);
      setTab("publicar");
      onChanged();
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!noticia) return;
    setLoading(true);
    try {
      await api.publish(noticia.id);
      onChanged();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  async function withdraw() {
    if (!noticia) return;
    setLoading(true);
    try {
      await api.withdraw(noticia.id);

      setTab("contenido");
      setUnlockedImagen(false);
      setUnlockedPublicar(false);

      onChanged();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  if (!noticia) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] w-[calc(100%-1rem)] max-h-[92vh] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-4 py-3 sm:px-6">
          <DialogTitle className="flex items-center justify-between gap-3">
            <span className="truncate">Revisar noticia</span>
          </DialogTitle>
        </DialogHeader>

        {published ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">Preview (LinkedIn)</div>
                <div className="mt-2 text-lg font-semibold break-words [overflow-wrap:anywhere]">{titulo}</div>
                <div className="mt-2 max-w-full">
                  <div className="space-y-2 text-[15px] leading-7 text-foreground/90">{renderBodyRich(cuerpo)}</div>
                </div>
                {imgUrl ? (
                  <img
                    src={toPreviewImageSource(imgUrl)}
                    alt="Imagen"
                    className="mx-auto max-h-[45dvh] w-auto max-w-full h-auto rounded-lg border"
                  />
                ) : null}

                {noticia.url_publicada ? (
                  <div className="mt-2 text-xs">
                    <a className="underline" href={noticia.url_publicada} target="_blank" rel="noreferrer">
                      Ver publicacion
                    </a>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-t bg-background px-4 py-3 sm:px-6">
              <div className="flex flex-wrap justify-end gap-2">
                <Button className={dangerButtonClass} disabled={loading} onClick={withdraw}>
                  Retirar
                </Button>
                <Button className={blueButtonClass} onClick={() => onOpenChange(false)}>
                  Confirmar
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <Tabs
              className="min-h-0"
              value={tab}
              onValueChange={(v) => {
                const next = v as TabKey;
                if (next === "imagen" && !canGoImagen) return;
                if (next === "publicar" && !canGoPublicar) return;
                setTab(next);
              }}
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="contenido" className={activeTabClass}>
                  1. Contenido
                </TabsTrigger>
                <TabsTrigger value="imagen" disabled={disableImagen} className={activeTabClass}>
                  2. Imagen
                </TabsTrigger>
                <TabsTrigger value="publicar" disabled={disablePublicar} className={activeTabClass}>
                  3. Publicar
                </TabsTrigger>
              </TabsList>

              <TabsContent value="contenido" className="min-w-0 space-y-3 overflow-x-hidden pt-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Titulo</div>
                  <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Contenido</div>
                  <div className="rounded-md border bg-muted/30 p-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Button type="button" variant="ghost" size="xs" onClick={() => applyHeading(1)} disabled={loading}>
                        <Heading1 />
                      </Button>
                      <Button type="button" variant="ghost" size="xs" onClick={() => applyHeading(2)} disabled={loading}>
                        <Heading2 />
                      </Button>
                      <Button type="button" variant="ghost" size="xs" onClick={toggleList} disabled={loading}>
                        <List />
                      </Button>
                      <Button type="button" variant="ghost" size="xs" onClick={() => applyWrap("**")} disabled={loading}>
                        <Bold />
                      </Button>
                      <Button type="button" variant="ghost" size="xs" onClick={() => applyWrap("_")} disabled={loading}>
                        <Italic />
                      </Button>
                      <Button type="button" variant="ghost" size="xs" onClick={applyLink} disabled={loading}>
                        <Link2 />
                      </Button>
                      <Button type="button" variant="ghost" size="xs" onClick={clearFormatting} disabled={loading}>
                        <Eraser />
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">Atajos: Ctrl/Cmd+B negrita, Ctrl/Cmd+I cursiva.</div>
                  <Textarea
                    ref={cuerpoRef}
                    value={cuerpo}
                    onChange={(e) => setCuerpo(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                        e.preventDefault();
                        applyWrap("**");
                      }
                      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
                        e.preventDefault();
                        applyWrap("_");
                      }
                    }}
                    className="min-h-[220px] text-[15px] leading-7"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Vista previa de formato</div>
                  <div className="rounded-lg border p-3">
                    <div className="space-y-2 text-[15px] leading-7 text-foreground/90">{renderBodyRich(cuerpo)}</div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    className={blueButtonClass}
                    disabled={loading || !titulo.trim() || !cuerpo.trim()}
                    onClick={confirmContenido}
                  >
                    Confirmar contenido
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="imagen" className="min-w-0 space-y-3 overflow-x-hidden pt-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">URL de la imagen</div>
                  <Input
                    value={imgUrl}
                    onChange={(e) => {
                      const normalized = normalizeImageUrlInput(e.target.value);
                      setImgUrl(normalized);
                      setEditorSource(toEditorImageSource(normalized));
                      setEditorZoom(1);
                      setEditorBrightness(100);
                      setEditorContrast(100);
                      setEditorOffsetX(0);
                      setEditorOffsetY(0);
                      setEditorOutputWidth(DEFAULT_OUTPUT_WIDTH);
                      setEditorOutputHeight(DEFAULT_OUTPUT_HEIGHT);
                      setEditorDirty(false);
                    }}
                    placeholder="https://..."
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-sm font-medium">Subir imagen desde tu equipo</div>
                  <Input type="file" accept="image/*" onChange={onImageFileChange} />
                </div>

                {editorSource ? (
                  <div className="space-y-3 rounded-lg border p-3">
                    <div className="rounded-md bg-zinc-900 px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant={activeImageTool === "crop" ? "secondary" : "ghost"}
                          size="icon-sm"
                          onClick={() => setActiveImageTool("crop")}
                          className={activeImageTool === "crop" ? "" : "text-zinc-200 hover:text-zinc-50"}
                          title="Recorte"
                        >
                          <Crop />
                        </Button>
                        <Button
                          type="button"
                          variant={activeImageTool === "light" ? "secondary" : "ghost"}
                          size="icon-sm"
                          onClick={() => setActiveImageTool("light")}
                          className={activeImageTool === "light" ? "" : "text-zinc-200 hover:text-zinc-50"}
                          title="Luz"
                        >
                          <SunMedium />
                        </Button>
                        <Button
                          type="button"
                          variant={activeImageTool === "size" ? "secondary" : "ghost"}
                          size="icon-sm"
                          onClick={() => setActiveImageTool("size")}
                          className={activeImageTool === "size" ? "" : "text-zinc-200 hover:text-zinc-50"}
                          title="Tamano"
                        >
                          <Ruler />
                        </Button>
                      </div>
                    </div>

                    {activeImageTool === "crop" ? (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-sm">
                          <div className="text-xs text-muted-foreground">Zoom ({editorZoom.toFixed(2)}x)</div>
                          <input
                            type="range"
                            min={1}
                            max={4}
                            step={0.05}
                            value={editorZoom}
                            onChange={(e) => {
                              setEditorZoom(Number(e.target.value));
                              setEditorDirty(true);
                            }}
                            className="w-full"
                          />
                        </label>
                        <div className="text-xs text-muted-foreground self-end md:text-right">
                          Arrastra dentro del lienzo para encuadrar. Usa las barras blancas para cambiar ancho/alto.
                        </div>
                      </div>
                    ) : null}

                    {activeImageTool === "light" ? (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-sm">
                          <div className="text-xs text-muted-foreground">Brillo ({editorBrightness}%)</div>
                          <input
                            type="range"
                            min={50}
                            max={150}
                            step={1}
                            value={editorBrightness}
                            onChange={(e) => {
                              setEditorBrightness(Number(e.target.value));
                              setEditorDirty(true);
                            }}
                            className="w-full"
                          />
                        </label>
                        <label className="space-y-1 text-sm">
                          <div className="text-xs text-muted-foreground">Contraste ({editorContrast}%)</div>
                          <input
                            type="range"
                            min={50}
                            max={150}
                            step={1}
                            value={editorContrast}
                            onChange={(e) => {
                              setEditorContrast(Number(e.target.value));
                              setEditorDirty(true);
                            }}
                            className="w-full"
                          />
                        </label>
                      </div>
                    ) : null}

                    {activeImageTool === "size" ? (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-sm">
                          <div className="text-xs text-muted-foreground">Ancho final (px)</div>
                          <Input
                            type="number"
                            min={200}
                            max={4000}
                            value={editorOutputWidth}
                            onChange={(e) => {
                              setEditorOutputWidth(
                                Math.min(4000, Math.max(200, Number(e.target.value) || DEFAULT_OUTPUT_WIDTH))
                              );
                              setEditorDirty(true);
                            }}
                          />
                        </label>
                        <label className="space-y-1 text-sm">
                          <div className="text-xs text-muted-foreground">Alto final (px)</div>
                          <Input
                            type="number"
                            min={200}
                            max={4000}
                            value={editorOutputHeight}
                            onChange={(e) => {
                              setEditorOutputHeight(
                                Math.min(4000, Math.max(200, Number(e.target.value) || DEFAULT_OUTPUT_HEIGHT))
                              );
                              setEditorDirty(true);
                            }}
                          />
                        </label>
                      </div>
                    ) : null}

                    <div className="overflow-auto rounded-lg border bg-zinc-900/90 p-3">
                      <div
                        className="relative mx-auto border border-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.25)]"
                        style={{ width: cropViewport.width, height: cropViewport.height }}
                      >
                        <canvas
                          ref={editorCanvasRef}
                          width={editorOutputWidth}
                          height={editorOutputHeight}
                          className="h-full w-full select-none"
                          style={{ cursor: isDraggingImage ? "grabbing" : "grab", touchAction: "none" }}
                          onMouseDown={onCanvasMouseDown}
                          onMouseMove={onCanvasMouseMove}
                          onMouseUp={onCanvasMouseUp}
                          onMouseLeave={onCanvasMouseUp}
                        />

                        <button
                          type="button"
                          aria-label="Redimensionar ancho"
                          className="absolute top-1/2 -right-2 h-14 w-3 -translate-y-1/2 rounded-sm bg-white shadow cursor-ew-resize"
                          onMouseDown={(e) => onResizeHandleDown("right", e)}
                        />
                        <button
                          type="button"
                          aria-label="Redimensionar alto"
                          className="absolute left-1/2 -bottom-2 h-3 w-14 -translate-x-1/2 rounded-sm bg-white shadow cursor-ns-resize"
                          onMouseDown={(e) => onResizeHandleDown("bottom", e)}
                        />
                        <button
                          type="button"
                          aria-label="Redimensionar ancho y alto"
                          className="absolute -right-2 -bottom-2 h-4 w-4 rounded-sm bg-white shadow cursor-nwse-resize"
                          onMouseDown={(e) => onResizeHandleDown("corner", e)}
                        />
                      </div>
                      <div className="mt-2 text-center text-xs text-zinc-300">
                        {editorOutputWidth} x {editorOutputHeight}px
                      </div>
                    </div>

                    {editorError ? <div className="text-xs text-destructive">{editorError}</div> : null}

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="outline" onClick={resetImageEditor} disabled={loading}>
                        Restablecer
                      </Button>
                      <Button type="button" variant="secondary" onClick={applyImageEdits} disabled={loading}>
                        Aplicar edicion
                      </Button>
                    </div>
                  </div>
                ) : null}

                {imgUrl ? (
                  <img
                    src={toPreviewImageSource(imgUrl)}
                    alt="Imagen"
                    className="mx-auto max-h-[50dvh] w-auto max-w-full h-auto rounded-lg border"
                  />
                ) : null}

                <div className="flex justify-end">
                  <Button className={blueButtonClass} disabled={loading || !imgUrl.trim()} onClick={confirmImagen}>
                    Confirmar imagen
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="publicar" className="min-w-0 space-y-3 overflow-x-hidden pt-4">
                <div className="rounded-lg border p-4">
                  <div className="text-sm text-muted-foreground">Preview (LinkedIn)</div>
                  <div className="mt-2 min-w-0 text-lg font-semibold break-all">{titulo}</div>
                  <div className="mt-2 min-w-0 max-w-full">
                    <div className="space-y-2 text-[15px] leading-7 text-foreground/90">{renderBodyRich(cuerpo)}</div>
                  </div>
                  {imgUrl ? (
                    <img
                      src={toPreviewImageSource(imgUrl)}
                      alt="Imagen"
                      className="mx-auto max-h-[50dvh] w-auto max-w-full h-auto rounded-lg border"
                    />
                  ) : null}
                </div>

                <Separator />

                <div className="flex justify-end">
                  <Button className={blueButtonClass} disabled={loading} onClick={publish}>
                    Publicar
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
