import { configuredRobotsAllow } from "./config";
import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { Agent } from "undici";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MS_PER_MINUTE = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_REQUESTS_PER_HOST = 2;
const MIN_GAP_BETWEEN_REQUESTS_PER_HOST_MS = 500;
const MAX_ATTEMPTS = 3;
const THROTTLED_RETRY_BACKOFF_MS = 2_000;
const NETWORK_RETRY_BACKOFF_MS = 1_000;
const THROTTLING_STATUSES = new Set([429, 503]);
const ROBOTS_TTL_MS = 60 * MS_PER_MINUTE;
const CACHE_DIR = path.join(process.cwd(), ".cache", "http");
const DEV_CACHE_TTL_MS = 30 * MS_PER_MINUTE;
const DEFAULT_CACHE_TTL_MS = process.env.NODE_ENV === "production" ? 0 : DEV_CACHE_TTL_MS;
const MIN_MAIN_TEXT_LENGTH = 200;

const DEFAULT_ACCEPT = "text/html,application/json;q=0.9,application/xhtml+xml,*/*;q=0.8";
const ACCEPT_LANGUAGE = "cs,en-US,en;q=0.9";

const NON_CONTENT_SELECTOR =
  "script, style, noscript, svg, nav, footer, header, form, button, [role='dialog'], .modal, [class*='cookie' i], [id*='cookie' i]";
const BLOCK_ELEMENT_SELECTOR = "p, li, div, h1, h2, h3, h4, h5, h6, tr, section, article";
const MAIN_CONTENT_CANDIDATES =
  "main, article, [role='main'], [class*='descr' i], [class*='detail' i], [class*='content' i], [id*='content' i]";

const agent = new Agent({ connect: { timeout: CONNECT_TIMEOUT_MS } });

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

export class RobotsBlockedError extends Error {
  constructor(public readonly url: string) {
    super(`robots.txt disallows ${url} (set ROBOTS_ALLOW=<host>/<path> to opt in)`);
    this.name = "RobotsBlockedError";
  }
}

export interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  cacheTtlMs?: number;
}

export interface TextResponse {
  status: number;
  text: string;
  url: string;
  fromCache: boolean;
}

interface HostQueue {
  inFlight: number;
  nextRequestAllowedAt: number;
  waiting: Array<() => void>;
}

interface RobotsRule {
  allow: boolean;
  pattern: RegExp;
  specificity: number;
}

interface RobotsRules {
  fetchedAt: number;
  rules: RobotsRule[];
}

interface RobotsOverride {
  host: string;
  pathPrefix: string;
}

interface FetchedPage {
  status: number;
  url: string;
  text: string;
}

interface CacheEntry extends FetchedPage {
  storedAt: number;
}

const queueByHost = new Map<string, HostQueue>();
const robotsByOrigin = new Map<string, Promise<RobotsRules>>();

const cacheIsBestEffort = () => {};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithAgent(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    // @ts-expect-error undici dispatcher is not in the fetch type definitions
    dispatcher: agent,
  });
}

function queueFor(host: string): HostQueue {
  let queue = queueByHost.get(host);
  if (!queue) {
    queue = { inFlight: 0, nextRequestAllowedAt: 0, waiting: [] };
    queueByHost.set(host, queue);
  }
  return queue;
}

async function politelyForHost<T>(host: string, request: () => Promise<T>): Promise<T> {
  const queue = queueFor(host);
  while (queue.inFlight >= MAX_CONCURRENT_REQUESTS_PER_HOST) {
    await new Promise<void>((resolve) => queue.waiting.push(resolve));
  }
  queue.inFlight++;
  try {
    const waitMs = queue.nextRequestAllowedAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    queue.nextRequestAllowedAt = Date.now() + MIN_GAP_BETWEEN_REQUESTS_PER_HOST_MS;
    return await request();
  } finally {
    queue.inFlight--;
    queue.waiting.shift()?.();
  }
}

function robotsAreIgnored(): boolean {
  return process.env.ROBOTS_POLICY === "ignore";
}

function robotsOverrides(): RobotsOverride[] {
  return [...configuredRobotsAllow(), ...(process.env.ROBOTS_ALLOW ?? "").split(",")]
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => {
      const slash = entry.indexOf("/");
      return slash === -1
        ? { host: entry, pathPrefix: "/" }
        : { host: entry.slice(0, slash), pathPrefix: entry.slice(slash) };
    });
}

function isOptedIn(host: string, pathAndQuery: string): boolean {
  return robotsOverrides().some(
    (override) =>
      (host === override.host || host.endsWith(`.${override.host}`)) && pathAndQuery.startsWith(override.pathPrefix),
  );
}

function compileRobotsPattern(raw: string): RegExp {
  const escaped = raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const anchoredAtEnd = escaped.endsWith("\\$") ? `${escaped.slice(0, -2)}$` : escaped;
  return new RegExp(`^${anchoredAtEnd}`);
}

function parseRobots(text: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  let groupAppliesToUs = false;
  let previousLineWasUserAgent = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      const startsNewGroup = !previousLineWasUserAgent;
      if (startsNewGroup) groupAppliesToUs = false;
      if (value === "*") groupAppliesToUs = true;
      previousLineWasUserAgent = true;
      continue;
    }
    previousLineWasUserAgent = false;
    if ((key === "allow" || key === "disallow") && groupAppliesToUs && value) {
      rules.push({ allow: key === "allow", pattern: compileRobotsPattern(value), specificity: value.length });
    }
  }
  return rules;
}

function noRobotsRules(): RobotsRules {
  return { fetchedAt: Date.now(), rules: [] };
}

async function downloadRobots(origin: string): Promise<RobotsRules> {
  try {
    const res = await fetchWithAgent(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return noRobotsRules();
    return { fetchedAt: Date.now(), rules: parseRobots(await res.text()) };
  } catch {
    return noRobotsRules();
  }
}

async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsByOrigin.get(origin);
  if (cached) {
    const rules = await cached;
    if (Date.now() - rules.fetchedAt < ROBOTS_TTL_MS) return rules;
  }
  const download = downloadRobots(origin);
  robotsByOrigin.set(origin, download);
  return download;
}

function mostSpecificRule(rules: RobotsRule[], pathAndQuery: string): RobotsRule | null {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!rule.pattern.test(pathAndQuery)) continue;
    const isMoreSpecific = !best || rule.specificity > best.specificity;
    const allowWinsTie = best !== null && rule.specificity === best.specificity && rule.allow;
    if (isMoreSpecific || allowWinsTie) best = rule;
  }
  return best;
}

export async function robotsAllows(url: string): Promise<boolean> {
  if (robotsAreIgnored()) return true;
  const target = new URL(url);
  const pathAndQuery = target.pathname + target.search;
  if (isOptedIn(target.hostname.toLowerCase(), pathAndQuery)) return true;
  const { rules } = await robotsFor(target.origin);
  return mostSpecificRule(rules, pathAndQuery)?.allow ?? true;
}

function cacheKey(method: string, url: string, body?: string): string {
  return createHash("sha1").update(`${method} ${url}\n${body ?? ""}`).digest("hex");
}

function cacheFile(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCacheEntry(value: unknown): value is CacheEntry {
  return (
    isRecord(value) &&
    typeof value.storedAt === "number" &&
    typeof value.status === "number" &&
    typeof value.url === "string" &&
    typeof value.text === "string"
  );
}

async function readCache(key: string, ttlMs: number): Promise<CacheEntry | null> {
  if (ttlMs <= 0) return null;
  try {
    const entry: unknown = JSON.parse(await readFile(cacheFile(key), "utf8"));
    return isCacheEntry(entry) && Date.now() - entry.storedAt < ttlMs ? entry : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, entry: CacheEntry): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true })
    .then(() => writeFile(cacheFile(key), JSON.stringify(entry), "utf8"))
    .catch(cacheIsBestEffort);
}

function requestTimeoutOrUserAbort(userSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return userSignal ? AbortSignal.any([userSignal, timeout]) : timeout;
}

async function fetchWithRetries(url: string, method: string, opts: FetchOptions): Promise<FetchedPage> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    opts.signal?.throwIfAborted();
    const hasAttemptsLeft = attempt < MAX_ATTEMPTS;
    try {
      const res = await fetchWithAgent(url, {
        method,
        headers: { "User-Agent": USER_AGENT, Accept: DEFAULT_ACCEPT, "Accept-Language": ACCEPT_LANGUAGE, ...opts.headers },
        body: opts.body,
        redirect: "follow",
        signal: requestTimeoutOrUserAbort(opts.signal),
      });
      if (res.ok) return { status: res.status, url: res.url, text: await res.text() };
      if (THROTTLING_STATUSES.has(res.status) && hasAttemptsLeft) {
        await sleep(THROTTLED_RETRY_BACKOFF_MS * attempt);
        continue;
      }
      throw new HttpError(res.status, url);
    } catch (err) {
      lastError = err;
      if (err instanceof HttpError || opts.signal?.aborted) throw err;
      if (hasAttemptsLeft) await sleep(NETWORK_RETRY_BACKOFF_MS * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Fetch failed for ${url}: ${String(lastError)}`);
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<TextResponse> {
  const method = opts.method ?? "GET";
  const ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const key = cacheKey(method, url, opts.body);
  const cached = await readCache(key, ttlMs);
  if (cached) return { status: cached.status, text: cached.text, url: cached.url, fromCache: true };

  if (!(await robotsAllows(url))) throw new RobotsBlockedError(url);

  return politelyForHost(new URL(url).hostname, async () => {
    const page = await fetchWithRetries(url, method, opts);
    if (ttlMs > 0) await writeCache(key, { ...page, storedAt: Date.now() });
    return { ...page, fromCache: false };
  });
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const jsonContentType: Record<string, string> = opts.body ? { "Content-Type": "application/json" } : {};
  const res = await fetchText(url, {
    ...opts,
    headers: { Accept: "application/json", ...jsonContentType, ...opts.headers },
  });
  return JSON.parse(res.text) as T;
}

export async function fetchHtml(url: string, opts: FetchOptions = {}): Promise<{ $: cheerio.CheerioAPI; url: string }> {
  const res = await fetchText(url, opts);
  return { $: cheerio.load(res.text), url: res.url };
}

export function absoluteUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return url.protocol.startsWith("http") ? url.toString() : null;
  } catch {
    return null;
  }
}

function outsideNonContent($: cheerio.CheerioAPI, elements: cheerio.Cheerio<AnyNode>): cheerio.Cheerio<AnyNode> {
  return elements.filter((_, element) => $(element).closest(NON_CONTENT_SELECTOR).length === 0);
}

export function blockText($: cheerio.CheerioAPI, selector: string | cheerio.Cheerio<AnyNode>): string {
  const root = outsideNonContent($, typeof selector === "string" ? $(selector) : selector);
  const clone = root.clone();
  clone.find(NON_CONTENT_SELECTOR).remove();
  clone.find("br").replaceWith("\n");
  clone.find(BLOCK_ELEMENT_SELECTOR).each((_, element) => {
    $(element).append("\n");
  });
  return clone
    .text()
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function htmlToText(html: string | undefined | null): string {
  if (!html) return "";
  return blockText(cheerio.load(`<body>${html}</body>`), "body");
}

export function mainText($: cheerio.CheerioAPI): string {
  let longest = "";
  $(MAIN_CONTENT_CANDIDATES).each((_, element) => {
    const text = blockText($, $(element));
    if (text.length > longest.length) longest = text;
  });
  return longest.length >= MIN_MAIN_TEXT_LENGTH ? longest : blockText($, "body");
}
