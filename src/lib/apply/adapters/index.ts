import type { ApplyAdapter } from "../types";
import { startupjobsAdapter } from "./startupjobs";

export const ADAPTERS: ApplyAdapter[] = [startupjobsAdapter];

export function findAdapter(url: URL): ApplyAdapter | null {
  return ADAPTERS.find((adapter) => adapter.matches(url)) ?? null;
}
