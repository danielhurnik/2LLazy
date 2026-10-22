import type { JobSource as JobSourceEnum } from "@prisma/client";
import type { CrossListing } from "@/types";

export interface GroupPosting {
  id: string;
  source: JobSourceEnum;
  sourceUrl: string;
}

const WWW_PREFIX = /^www\./;
const SOURCES_SPANNING_MANY_SITES = new Set<JobSourceEnum>(["WEB", "ATS"]);

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "");
  } catch {
    return undefined;
  }
}

export function boardLabel(source: JobSourceEnum, url: string, labels: Map<JobSourceEnum, string>): string {
  if (source === "WEB") return hostOf(url) ?? labels.get(source) ?? source;
  return labels.get(source) ?? source;
}

function isOnAnotherBoard(posting: GroupPosting, other: GroupPosting): boolean {
  if (other.source !== posting.source) return true;
  return SOURCES_SPANNING_MANY_SITES.has(other.source) && hostOf(other.sourceUrl) !== hostOf(posting.sourceUrl);
}

export function alsoOnEntries(posting: GroupPosting, others: GroupPosting[], labels: Map<JobSourceEnum, string>): CrossListing[] | undefined {
  const elsewhere = others.filter((other) => isOnAnotherBoard(posting, other));
  if (elsewhere.length === 0) return undefined;
  return elsewhere.map((other) => ({ source: other.source, label: boardLabel(other.source, other.sourceUrl, labels), url: other.sourceUrl }));
}

export function alreadyAppliedMessage(boardName: string): string {
  return `You already applied to this job via ${boardName}.`;
}
