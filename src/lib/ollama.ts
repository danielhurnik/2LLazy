import { z } from "zod";

const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "llama3";
const DEFAULT_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const OLLAMA_BUILTIN_NUM_CTX_THAT_SILENTLY_TRUNCATES = 4096;
const DEFAULT_NUM_CTX = OLLAMA_BUILTIN_NUM_CTX_THAT_SILENTLY_TRUNCATES * 2;

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

export interface OllamaChatOptions {
  model?: string;
  numCtx?: number;
  temperature?: number;
  keepAlive?: string;
  signal?: AbortSignal;
}

interface ChatResponse {
  message?: { content?: string };
  error?: string;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok || data.error) {
    throw new Error(`Ollama ${path} failed (${res.status}): ${data.error ?? res.statusText}`);
  }
  return data;
}

export async function ollamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ollamaChat(
  messages: OllamaMessage[],
  options: OllamaChatOptions & { format?: Record<string, unknown> } = {},
): Promise<string> {
  const data = await postJson<ChatResponse>(
    "/api/chat",
    {
      model: options.model ?? DEFAULT_MODEL,
      messages,
      stream: false,
      format: options.format,
      keep_alive: options.keepAlive,
      options: {
        num_ctx: options.numCtx ?? DEFAULT_NUM_CTX,
        temperature: options.temperature ?? 0,
      },
    },
    options.signal,
  );
  return data.message?.content ?? "";
}

export async function ollamaChatJson<T>(
  messages: OllamaMessage[],
  schema: z.ZodType<T>,
  options: OllamaChatOptions = {},
): Promise<T> {
  const content = await ollamaChat(messages, { ...options, format: z.toJSONSchema(schema) });
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Ollama returned non-JSON content: ${content.slice(0, 200)}`);
  }
  return schema.parse(parsed);
}

export async function ollamaEmbed(
  input: string | string[],
  model: string = DEFAULT_EMBED_MODEL,
): Promise<number[][]> {
  const data = await postJson<{ embeddings?: number[][] }>("/api/embed", { model, input });
  return data.embeddings ?? [];
}
