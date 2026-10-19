import sourcesCz from "../../../config/sources.cz.json";
import type { CountryCode } from "./sources/types";

export const ATS_KINDS = ["greenhouse", "lever", "ashby", "smartrecruiters", "recruitee", "workable"] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

export interface Employer {
  ats: AtsKind;
  slug: string;
  name: string;
}

export interface SourcesConfig {
  robotsAllow: string[];
  employers: Employer[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isAtsKind = (value: unknown): value is AtsKind => typeof value === "string" && ATS_KINDS.some((kind) => kind === value);

function asEmployer(raw: unknown, index: number): Employer {
  if (!isRecord(raw) || !isAtsKind(raw.ats) || typeof raw.slug !== "string" || typeof raw.name !== "string") {
    throw new Error(`config/sources.*.json: employers[${index}] needs ats, slug and name`);
  }
  return { ats: raw.ats, slug: raw.slug, name: raw.name };
}

function asSourcesConfig(raw: unknown): SourcesConfig {
  if (!isRecord(raw)) throw new Error("config/sources.*.json must be an object");
  const robotsAllow = Array.isArray(raw.robotsAllow)
    ? raw.robotsAllow.filter((entry): entry is string => typeof entry === "string")
    : [];
  const employers = Array.isArray(raw.employers) ? raw.employers.map(asEmployer) : [];
  return { robotsAllow, employers };
}

const CONFIG_BY_COUNTRY: Record<CountryCode, SourcesConfig> = { CZ: asSourcesConfig(sourcesCz) };

export function sourcesConfigFor(country: CountryCode): SourcesConfig {
  return CONFIG_BY_COUNTRY[country];
}

export function configuredRobotsAllow(): string[] {
  return Object.values(CONFIG_BY_COUNTRY).flatMap((config) => config.robotsAllow);
}
