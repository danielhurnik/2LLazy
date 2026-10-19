"use server";

import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth/sessionManager";
import { buildSearchProfile, searchProfileFor, type SearchProfile } from "@/lib/jobs/profile";

export interface SearchProfileResult {
  profile: SearchProfile | null;
  error?: string;
}

export async function loadSearchProfile(): Promise<SearchProfileResult> {
  const userId = await requireUserId();
  return { profile: await searchProfileFor(userId) };
}

export async function rebuildSearchProfile(): Promise<SearchProfileResult> {
  const userId = await requireUserId();
  try {
    const profile = await buildSearchProfile(userId);
    revalidatePath("/settings");
    return { profile };
  } catch (err) {
    return { profile: null, error: err instanceof Error ? err.message : String(err) };
  }
}
