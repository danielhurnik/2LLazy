import type { ApplyAdapter } from "../types";
import { jobsczAdapter } from "./jobscz";
import { startupjobsAdapter } from "./startupjobs";

export const ADAPTERS: ApplyAdapter[] = [startupjobsAdapter, jobsczAdapter];

export function findAdapter(url: URL): ApplyAdapter | null {
  return ADAPTERS.find((adapter) => adapter.matches(url)) ?? null;
}
