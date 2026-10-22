import type { JobSource as JobSourceEnum } from "@prisma/client";
import type { CrossListing } from "@/types";

export interface GroupPosting {
  id: string;
  source: JobSourceEnum;
  sourceUrl: string;
}

const WWW_PREFIX = /^www\./;

function hostLabel(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "");
  } catch {
    return undefined;
  }
}

export function boardLabel(source: JobSourceEnum, url: string, labels: Map<JobSourceEnum, string>): string {
  if (source === "WEB") return hostLabel(url) ?? labels.get(source) ?? source;
  return labels.get(source) ?? source;
}

export function alsoOnEntries(others: GroupPosting[], labels: Map<JobSourceEnum, string>): CrossListing[] | undefined {
  if (others.length === 0) return undefined;
  return others.map((other) => ({ source: other.source, label: boardLabel(other.source, other.sourceUrl, labels), url: other.sourceUrl }));
}
