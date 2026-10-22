import type { CheerioAPI } from "cheerio";
import { htmlToText } from "../http";
import { isRecord } from "@/lib/guards";

export interface JsonLdJobPosting {
  title: string;
  company: string;
  location: string;
  description: string;
  remote: boolean;
  postedAt?: Date;
  salary?: string;
  validThrough?: Date;
  email?: string;
}

const JSON_LD_SELECTOR = "script[type='application/ld+json']";
const JOB_POSTING_TYPE = "JobPosting";
const TELECOMMUTE = "TELECOMMUTE";
const MAILTO_PREFIX = /^mailto:/i;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const finiteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function date(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function nameOf(value: unknown): string {
  if (isRecord(value)) return text(value.name);
  return text(value);
}

function hasType(node: Record<string, unknown>, type: string): boolean {
  const declared = node["@type"];
  return Array.isArray(declared) ? declared.includes(type) : declared === type;
}

function nodesIn(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.flatMap(nodesIn);
  if (!isRecord(data)) return [];
  const graph = Array.isArray(data["@graph"]) ? data["@graph"].flatMap(nodesIn) : [];
  return [data, ...graph];
}

function addressText(address: unknown): string {
  if (!isRecord(address)) return text(address);
  return [text(address.addressLocality), text(address.addressRegion), nameOf(address.addressCountry)]
    .filter(Boolean)
    .join(", ");
}

function locationText(jobLocation: unknown): string {
  const places = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  const parts = places.map((place) => (isRecord(place) ? addressText(place.address) || text(place.name) : text(place)));
  return Array.from(new Set(parts.filter(Boolean))).join("; ");
}

function salaryText(baseSalary: unknown): string | undefined {
  if (!isRecord(baseSalary)) return undefined;
  const currency = text(baseSalary.currency);
  const value = isRecord(baseSalary.value) ? baseSalary.value : baseSalary;
  const low = finiteNumber(value.minValue);
  const high = finiteNumber(value.maxValue);
  const single = finiteNumber(value.value);
  const figures =
    low !== undefined && high !== undefined ? `${low} - ${high}` : single !== undefined ? String(single) : low !== undefined ? String(low) : undefined;
  if (!figures) return undefined;
  const unit = text(value.unitText).toLowerCase();
  return [figures, currency, unit ? `/ ${unit}` : ""].filter(Boolean).join(" ");
}

function emailOf(value: unknown): string {
  return isRecord(value) ? text(value.email).replace(MAILTO_PREFIX, "") : "";
}

function contactEmailOf(node: Record<string, unknown>): string | undefined {
  const organization: Record<string, unknown> = isRecord(node.hiringOrganization) ? node.hiringOrganization : {};
  const contactPoints = Array.isArray(organization.contactPoint) ? organization.contactPoint : [organization.contactPoint];
  return [emailOf(node.applicationContact), emailOf(organization), ...contactPoints.map(emailOf)].find(Boolean) || undefined;
}

function toJobPosting(node: Record<string, unknown>): JsonLdJobPosting | null {
  const title = text(node.title) || text(node.name);
  if (!title) return null;
  const location = locationText(node.jobLocation);
  const remote = text(node.jobLocationType).toUpperCase() === TELECOMMUTE;
  return {
    title,
    company: nameOf(node.hiringOrganization),
    location,
    description: htmlToText(text(node.description)),
    remote,
    postedAt: date(node.datePosted),
    salary: salaryText(node.baseSalary),
    validThrough: date(node.validThrough),
    email: contactEmailOf(node),
  };
}

function parseJsonLd(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function jobPostingsIn($: CheerioAPI): JsonLdJobPosting[] {
  const postings: JsonLdJobPosting[] = [];
  $(JSON_LD_SELECTOR).each((_, element) => {
    for (const node of nodesIn(parseJsonLd($(element).text()))) {
      if (!hasType(node, JOB_POSTING_TYPE)) continue;
      const posting = toJobPosting(node);
      if (posting) postings.push(posting);
    }
  });
  return postings;
}
