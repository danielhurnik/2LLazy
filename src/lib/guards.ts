export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serialized(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.cause ? `${err.message} (cause: ${String(err.cause)})` : err.message;
  if (isRecord(err) && "message" in err) return String(err.message);
  return typeof err === "string" ? err : serialized(err);
}
