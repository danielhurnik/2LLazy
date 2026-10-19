import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { sseChunk, type SSEEvent } from "@/lib/jobs/events";
import { resolveIntent } from "@/lib/jobs/intent";
import { runSearch } from "@/lib/jobs/pipeline";
import { sourcesFor } from "@/lib/jobs/registry";
import { DEFAULT_COUNTRY, isSupportedCountry, type CountryCode, type SearchRequest } from "@/lib/jobs/sources/types";
import { isRecord, type JsonRecord } from "@/lib/guards";

export const runtime = "nodejs";
export const maxDuration = 300;

const MIN_MS_BETWEEN_SEARCHES_PER_CLIENT = 10_000;
const SEARCH_SITE = "Search";
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const lastSearchAtByClient = new Map<string, number>();

const ignoreFailure = () => {};

const jsonError = (error: string, status: number) => new Response(JSON.stringify({ error }), { status });

function stringField(body: JsonRecord, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function numberField(body: JsonRecord, key: string): number | null {
  const value = body[key];
  return typeof value === "number" ? value : null;
}

function parseCountry(value: unknown): CountryCode {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return isSupportedCountry(code) ? code : DEFAULT_COUNTRY;
}

function clientIdentifier(req: NextRequest): string {
  return req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(client: string): boolean {
  const now = Date.now();
  const lastSearchAt = lastSearchAtByClient.get(client) ?? 0;
  if (now - lastSearchAt < MIN_MS_BETWEEN_SEARCHES_PER_CLIENT) return true;
  lastSearchAtByClient.set(client, now);
  return false;
}

function parseSearchRequest(body: JsonRecord): SearchRequest | null {
  const query = stringField(body, "query").trim();
  if (!query) return null;
  return {
    query,
    skillLevel: stringField(body, "skillLevel"),
    deepSearch: body.deepSearch === true,
    city: stringField(body, "city").trim(),
    country: parseCountry(body.country),
    intent: resolveIntent(query),
    salaryMin: numberField(body, "salaryMin"),
    salaryMax: numberField(body, "salaryMax"),
  };
}

function streamSearch(userId: string, request: SearchRequest, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const send = async (event: SSEEvent) => {
    await writer.write(encoder.encode(sseChunk(event)));
  };

  void (async () => {
    try {
      const { sources, skipped } = sourcesFor(request.country);
      for (const reason of skipped) await send({ type: "sourceSkipped", site: SEARCH_SITE, message: reason });
      await runSearch({ userId, request, sources, emit: send, signal });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await send({ type: "error", site: SEARCH_SITE, message }).catch(ignoreFailure);
    } finally {
      await writer.close().catch(ignoreFailure);
    }
  })();

  return new Response(readable, { headers: SSE_HEADERS });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return jsonError("Unauthorized", 401);

  if (isRateLimited(clientIdentifier(req))) return jsonError("Too many requests", 429);

  const body: unknown = await req.json().catch(() => null);
  const request = parseSearchRequest(isRecord(body) ? body : {});
  if (!request) return new Response("Missing query", { status: 400 });

  return streamSearch(userId, request, req.signal);
}
