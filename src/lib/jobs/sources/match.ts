import { normalizeText } from "@/lib/text";
import { tokens } from "../score";
import type { SearchRequest } from "./types";

export function titleMatches(title: string, request: SearchRequest): boolean {
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) return false;
  const normalizedQuery = normalizeText(request.query);
  if (normalizedQuery && normalizedTitle.includes(normalizedQuery)) return true;
  const mentionsIncludedTitle = request.intent.includedTitles.some((pattern) =>
    normalizedTitle.includes(normalizeText(pattern)),
  );
  if (mentionsIncludedTitle) return true;
  return tokens(request.query).some((token) => normalizedTitle.includes(token));
}
