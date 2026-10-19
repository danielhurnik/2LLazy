import { pausedForMinutes } from "./breaker";
import { cocumaSource } from "./sources/cocuma";
import { jobsczSource } from "./sources/jobscz";
import { jobstackSource } from "./sources/jobstack";
import { joobleSource } from "./sources/jooble";
import { nofluffjobsSource } from "./sources/nofluffjobs";
import { skilletoSource } from "./sources/skilleto";
import { startupjobsSource } from "./sources/startupjobs";
import type { CountryCode, JobSource } from "./sources/types";

const ALL_SOURCES: JobSource[] = [
  nofluffjobsSource,
  jobsczSource,
  joobleSource,
  startupjobsSource,
  cocumaSource,
  skilletoSource,
  jobstackSource,
];

const UNAVAILABLE_REASONS: Record<string, string> = {
  nofluffjobs: "NoFluffJobs skipped: its JSON API is disallowed by robots.txt (opt in with ROBOTS_ALLOW=nofluffjobs.com/api/)",
  jooble: "Jooble skipped: set JOOBLE_API_KEY (free key from jooble.org/api/about)",
  startupjobs: "StartupJobs skipped: needs PLAYWRIGHT_ENABLED=true",
  skilleto: "Skilleto skipped: needs PLAYWRIGHT_ENABLED=true",
};

export interface SourceSelection {
  sources: JobSource[];
  skipped: string[];
}

function unavailableReason(source: JobSource): string {
  return UNAVAILABLE_REASONS[source.id] ?? `${source.label} skipped: not available`;
}

function pausedReason(source: JobSource, minutes: number): string {
  return `${source.label} paused after repeated failures (retrying in ${minutes} min)`;
}

function whySourceCannotRun(source: JobSource): string | null {
  if (source.isAvailable && !source.isAvailable()) return unavailableReason(source);
  const pausedMinutes = pausedForMinutes(source.id);
  return pausedMinutes > 0 ? pausedReason(source, pausedMinutes) : null;
}

export function sourcesFor(country: CountryCode): SourceSelection {
  const sources: JobSource[] = [];
  const skipped: string[] = [];
  for (const source of ALL_SOURCES.filter((candidate) => candidate.countries.includes(country))) {
    const reason = whySourceCannotRun(source);
    if (reason) skipped.push(reason);
    else sources.push(source);
  }
  return { sources, skipped };
}
