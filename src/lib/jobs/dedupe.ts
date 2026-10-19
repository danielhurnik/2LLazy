import { createHash } from "crypto";
import { normalizeText } from "@/lib/text";

export { normalizeText };

const CAMPAIGN_PARAM_PREFIX = "utm_";
const VISITOR_AND_SEARCH_SESSION_PARAMS = new Set([
  "searchid", "rps", "ref", "source", "src", "fbclid", "gclid", "msclkid",
  "mc_cid", "mc_eid", "_ga", "yclid", "igshid", "trk", "trackingid",
]);
const CONTENT_HASH_SAMPLE_LENGTH = 2000;

function identifiesPostingNotVisitor(paramName: string): boolean {
  const name = paramName.toLowerCase();
  return !name.startsWith(CAMPAIGN_PARAM_PREFIX) && !VISITOR_AND_SEARCH_SESSION_PARAMS.has(name);
}

export function canonicalUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim();
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const kept = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (identifiesPostingNotVisitor(key)) kept.append(key, value);
  }
  kept.sort();
  const query = kept.toString();
  url.search = query ? `?${query}` : "";
  return url.toString();
}

export function jobKey(job: { company: string; title: string; city?: string | null }): string {
  return [normalizeText(job.company), normalizeText(job.title), normalizeText(job.city ?? "")].join("|");
}

export function contentHash(text: string): string {
  return createHash("sha1").update(normalizeText(text).slice(0, CONTENT_HASH_SAMPLE_LENGTH)).digest("hex");
}

export function uniqueByUrl<T extends { url: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.url, item])).values());
}

export function dedupeRepeatedHalf(text: string | null | undefined): string {
  if (!text) return "";
  const half = Math.floor(text.length / 2);
  const firstHalf = text.slice(0, half);
  return firstHalf === text.slice(half) ? firstHalf : text;
}
