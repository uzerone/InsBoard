import { type ParseResult, errorResponse } from "../http/errors.js";

const MAX_CLIENT_REQUEST_ID_LENGTH = 120;

export function parseClientRequestId(value: unknown): ParseResult<string | undefined> {
  if (value === undefined) {
    return {
      ok: true,
      value: undefined
    };
  }

  if (typeof value !== "string") {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Client request ID must be a string.")
    };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return {
      ok: true,
      value: undefined
    };
  }

  if (trimmed.length > MAX_CLIENT_REQUEST_ID_LENGTH || !/^[a-zA-Z0-9:_-]+$/u.test(trimmed)) {
    return {
      ok: false,
      error: errorResponse("invalid_request", "Client request ID format is unsupported.")
    };
  }

  return {
    ok: true,
    value: trimmed
  };
}

export function parsePositiveIntegerValue(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
