import { SSE_DATA_PREFIX } from "@/lib/readSseStream";
import type { JobItem } from "@/types";

export type SSEEvent =
  | { type: "progress"; site: string; message: string }
  | { type: "sourceSkipped"; site: string; message: string }
  | { type: "job"; data: JobItem }
  | { type: "scraperDone"; site: string; doneCount: number; total: number }
  | { type: "scrapersDone"; total: number }
  | { type: "complete"; total: number }
  | { type: "error"; site: string; message: string };

export type Emit = (event: SSEEvent) => Promise<void>;

const SSE_EVENT_TYPES: ReadonlySet<unknown> = new Set<SSEEvent["type"]>([
  "progress",
  "sourceSkipped",
  "job",
  "scraperDone",
  "scrapersDone",
  "complete",
  "error",
]);

export function sseChunk(event: SSEEvent): string {
  return `${SSE_DATA_PREFIX}${JSON.stringify(event)}\n\n`;
}

export function isSseEvent(value: unknown): value is SSEEvent {
  return typeof value === "object" && value !== null && "type" in value && SSE_EVENT_TYPES.has(value.type);
}
