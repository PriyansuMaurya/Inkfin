/**
 * Runtime parsing helpers for values arriving over IPC.
 *
 * Everything the native bridge returns is treated as untrusted input: each
 * field is checked before use rather than cast, so a malformed payload fails
 * loudly instead of producing a broken document.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

export function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readStringArray(source: Record<string, unknown>, key: string): string[] | null {
  const value = source[key];
  if (!Array.isArray(value)) {
    return null;
  }
  return value.every((entry) => typeof entry === 'string') ? (value as string[]) : null;
}

/** Narrow an optional string field, treating a wrong type as absent. */
export function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  return readString(source, key) ?? undefined;
}

/** Narrow an optional number field, treating a wrong type as absent. */
export function optionalNumber(source: Record<string, unknown>, key: string): number | undefined {
  return readNumber(source, key) ?? undefined;
}
