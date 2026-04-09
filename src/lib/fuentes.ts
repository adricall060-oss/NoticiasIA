export const HANDLE_ERROR_MESSAGE =
  "Introduce un @handle valido con caracteres a-z, 0-9 y separadores _ - .";

export const CHANNEL_ID_ERROR_MESSAGE =
  "Introduce un channel id valido con caracteres a-z, 0-9 y separadores _ -";

const HANDLE_REGEX = /^@[A-Za-z0-9._-]+$/;
const CHANNEL_ID_REGEX = /^UC[A-Za-z0-9_-]+$/;

export type FuenteValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateFuenteInput(rawValue: string): FuenteValidationResult {
  const value = String(rawValue ?? "").trim();
  if (!value) return { ok: true, value: "" };

  if (value.startsWith("@")) {
    if (!HANDLE_REGEX.test(value)) return { ok: false, error: HANDLE_ERROR_MESSAGE };
    return { ok: true, value };
  }

  if (value.toUpperCase().startsWith("UC")) {
    if (!CHANNEL_ID_REGEX.test(value)) return { ok: false, error: CHANNEL_ID_ERROR_MESSAGE };
    return { ok: true, value };
  }

  return { ok: true, value };
}
