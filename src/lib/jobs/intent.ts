import { lookupIntent, type QueryIntent } from "@/lib/queryIntent";

export function resolveIntent(query: string): QueryIntent {
  return lookupIntent(query);
}
