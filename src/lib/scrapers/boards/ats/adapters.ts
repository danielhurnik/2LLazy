/**
 * One adapter per applicant-tracking system.
 *
 * All six expose public, unauthenticated JSON, but no two agree on anything:
 * different field names, different date formats, different ideas of what a
 * "location" is, and different opinions on whether the list endpoint includes
 * the job description at all. Each adapter's job is to flatten that into
 * `AtsPosting` and never throw — an employer whose board has moved or closed
 * must cost nothing more than a warning.
 *
 * Endpoint shapes are documented publicly by each vendor; see the links on each
 * adapter. Every response is validated defensively rather than trusted, because
 * these are third-party APIs that change without notice.
 */
import { fetchJson } from "../../fetcher";
import { htmlToText, isRecord, str, strList, toDate, formatSalaryRange, num } from "../shared";
import type { AtsAdapter, AtsPosting, Employer } from "./types";

/** Requests per employer; every adapter stays well inside this. */
const MAX_POSTINGS_PER_EMPLOYER = 200;

function warn(platform: string, employer: Employer, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[ats:${platform}] ${employer.slug}: ${message}`);
}

/**
 * Greenhouse HTML-escapes the whole description into a JSON string, so it
 * arrives as `&lt;p&gt;…`. Decode before converting to text or the user sees
 * markup.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Joins the location fragments an ATS scatters across several fields.
 *
 * Drops a fragment already covered by one we kept: Greenhouse commonly reports
 * both `location.name` "Prague, Czechia" and an office named "Prague", and
 * concatenating them blindly gives "Prague, Czechia, Prague".
 */
function joinLocation(...parts: Array<string | undefined | null>): string {
  const kept: string[] = [];

  for (const raw of parts) {
    const part = (raw ?? "").trim();
    if (!part) continue;
    const lower = part.toLowerCase();
    if (kept.some((existing) => {
      const other = existing.toLowerCase();
      return other === lower || other.includes(lower) || lower.includes(other);
    })) {
      continue;
    }
    kept.push(part);
  }

  return kept.join(", ");
}

// ── Greenhouse ────────────────────────────────────────────────────────────────
// https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true

export const greenhouseAdapter: AtsAdapter = {
  platform: "greenhouse",
  displayName: "Greenhouse",
  homepage: "https://www.greenhouse.io",
  async fetchPostings(employer, signal) {
    try {
      const data = await fetchJson<unknown>(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(employer.slug)}/jobs?content=true`,
        { signal, retries: 2 },
      );
      if (!isRecord(data) || !Array.isArray(data.jobs)) return [];

      return data.jobs.slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((raw): AtsPosting[] => {
        if (!isRecord(raw)) return [];
        const title = str(raw.title);
        const url = str(raw.absolute_url);
        if (!title || !url) return [];

        const location = isRecord(raw.location) ? str(raw.location.name) : str(raw.location);
        const offices = Array.isArray(raw.offices)
          ? raw.offices.filter(isRecord).map((office) => str(office.name))
          : [];
        const departments = Array.isArray(raw.departments)
          ? raw.departments.filter(isRecord).map((d) => str(d.name))
          : [];

        return [{
          title,
          url,
          location: joinLocation(location, ...offices),
          description: htmlToText(decodeEntities(str(raw.content))),
          postedAt: toDate(raw.updated_at),
          department: departments[0] || undefined,
          remote: /remote/i.test(`${location} ${offices.join(" ")}`),
        }];
      });
    } catch (err) {
      warn("greenhouse", employer, err);
      return [];
    }
  },
};

// ── Lever ─────────────────────────────────────────────────────────────────────
// https://api.lever.co/v0/postings/{slug}?mode=json

export const leverAdapter: AtsAdapter = {
  platform: "lever",
  displayName: "Lever",
  homepage: "https://www.lever.co",
  async fetchPostings(employer, signal) {
    try {
      const data = await fetchJson<unknown>(
        `https://api.lever.co/v0/postings/${encodeURIComponent(employer.slug)}?mode=json&limit=${MAX_POSTINGS_PER_EMPLOYER}`,
        { signal, retries: 2 },
      );
      if (!Array.isArray(data)) return [];

      return data.slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((raw): AtsPosting[] => {
        if (!isRecord(raw)) return [];
        // Lever calls the job title `text`.
        const title = str(raw.text);
        const url = str(raw.hostedUrl) || str(raw.applyUrl);
        if (!title || !url) return [];

        const categories = isRecord(raw.categories) ? raw.categories : {};
        const description =
          str(raw.descriptionPlain) ||
          htmlToText(str(raw.description)) ||
          htmlToText(str(raw.additional));

        return [{
          title,
          url,
          location: joinLocation(str(categories.location), str(categories.allLocations)),
          description,
          // Lever dates are epoch milliseconds.
          postedAt: toDate(raw.createdAt),
          department: str(categories.department) || str(categories.team) || undefined,
          employmentType: str(categories.commitment) || undefined,
          remote: /remote/i.test(`${str(raw.workplaceType)} ${str(categories.location)}`),
        }];
      });
    } catch (err) {
      warn("lever", employer, err);
      return [];
    }
  },
};

// ── Ashby ─────────────────────────────────────────────────────────────────────
// https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true

export const ashbyAdapter: AtsAdapter = {
  platform: "ashby",
  displayName: "Ashby",
  homepage: "https://www.ashbyhq.com",
  async fetchPostings(employer, signal) {
    try {
      const data = await fetchJson<unknown>(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(employer.slug)}?includeCompensation=true`,
        { signal, retries: 2 },
      );
      if (!isRecord(data) || !Array.isArray(data.jobs)) return [];

      return data.jobs.slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((raw): AtsPosting[] => {
        if (!isRecord(raw)) return [];
        const title = str(raw.title);
        const url = str(raw.jobUrl) || str(raw.applyUrl);
        if (!title || !url) return [];

        return [{
          title,
          url,
          location: joinLocation(str(raw.location), ...strList(raw.secondaryLocations)),
          description: str(raw.descriptionPlain) || htmlToText(str(raw.descriptionHtml)),
          postedAt: toDate(raw.publishedAt) ?? toDate(raw.updatedAt),
          department: str(raw.department) || str(raw.team) || undefined,
          employmentType: str(raw.employmentType) || undefined,
          remote: raw.isRemote === true,
          salary: ashbySalary(raw.compensation),
        }];
      });
    } catch (err) {
      warn("ashby", employer, err);
      return [];
    }
  },
};

/** Ashby nests pay under compensation.summaryComponents when the board opts in. */
function ashbySalary(compensation: unknown): string | undefined {
  if (!isRecord(compensation)) return undefined;
  const summary = str(compensation.compensationTierSummary);
  if (summary) return summary;

  const components = Array.isArray(compensation.summaryComponents)
    ? compensation.summaryComponents.filter(isRecord)
    : [];
  const salary = components.find((component) => str(component.compensationType) === "Salary");
  if (!salary) return undefined;

  return (
    formatSalaryRange(
      num(salary.minValue),
      num(salary.maxValue),
      str(salary.currencyCode) || undefined,
      ashbyInterval(str(salary.interval)),
    ) || undefined
  );
}

/** Ashby names its pay interval differently from our formatter. */
function ashbyInterval(interval: string): "year" | "month" | "day" | "hour" | undefined {
  const value = interval.toUpperCase();
  if (value.includes("YEAR") || value.includes("ANNUAL")) return "year";
  if (value.includes("MONTH")) return "month";
  if (value.includes("DAY")) return "day";
  if (value.includes("HOUR")) return "hour";
  return undefined;
}

// ── SmartRecruiters ───────────────────────────────────────────────────────────
// https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100&offset=N

export const smartRecruitersAdapter: AtsAdapter = {
  platform: "smartrecruiters",
  displayName: "SmartRecruiters",
  homepage: "https://www.smartrecruiters.com",
  async fetchPostings(employer, signal) {
    const postings: AtsPosting[] = [];
    const pageSize = 100;

    try {
      for (let offset = 0; offset < MAX_POSTINGS_PER_EMPLOYER; offset += pageSize) {
        const data = await fetchJson<unknown>(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(employer.slug)}/postings` +
            `?limit=${pageSize}&offset=${offset}`,
          { signal, retries: 2 },
        );
        if (!isRecord(data) || !Array.isArray(data.content)) break;

        for (const raw of data.content) {
          if (!isRecord(raw)) continue;
          const title = str(raw.name);
          const id = str(raw.id) || str(raw.uuid);
          if (!title || !id) continue;

          const location = isRecord(raw.location) ? raw.location : {};
          postings.push({
            title,
            // The list endpoint omits the description; the public posting page
            // carries it as JSON-LD, and the extractor reads that if we ever
            // follow the link. Ranking works from the title meanwhile.
            url: `https://jobs.smartrecruiters.com/${encodeURIComponent(employer.slug)}/${encodeURIComponent(id)}`,
            location: joinLocation(str(location.city), str(location.region), str(location.country)),
            description: joinLocation(str(raw.industry && isRecord(raw.industry) ? raw.industry.label : ""),
              isRecord(raw.function) ? str(raw.function.label) : "",
              isRecord(raw.typeOfEmployment) ? str(raw.typeOfEmployment.label) : "",
              str(raw.experienceLevel && isRecord(raw.experienceLevel) ? raw.experienceLevel.label : "")),
            postedAt: toDate(raw.releasedDate) ?? toDate(raw.createdOn),
            remote: location.remote === true,
          });
        }

        const total = num(data.totalFound) ?? 0;
        if (offset + pageSize >= total || data.content.length < pageSize) break;
      }
    } catch (err) {
      warn("smartrecruiters", employer, err);
    }
    return postings.slice(0, MAX_POSTINGS_PER_EMPLOYER);
  },
};

// ── Recruitee ─────────────────────────────────────────────────────────────────
// https://{slug}.recruitee.com/api/offers/

export const recruiteeAdapter: AtsAdapter = {
  platform: "recruitee",
  displayName: "Recruitee",
  homepage: "https://recruitee.com",
  async fetchPostings(employer, signal) {
    try {
      const data = await fetchJson<unknown>(
        `https://${encodeURIComponent(employer.slug)}.recruitee.com/api/offers/`,
        { signal, retries: 2 },
      );
      if (!isRecord(data) || !Array.isArray(data.offers)) return [];

      return data.offers.slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((raw): AtsPosting[] => {
        if (!isRecord(raw)) return [];
        const title = str(raw.title);
        const url = str(raw.careers_url) || str(raw.careers_apply_url);
        if (!title || !url) return [];

        return [{
          title,
          url,
          location: joinLocation(str(raw.city), str(raw.state_name), str(raw.country)),
          description: htmlToText(`${str(raw.description)}\n${str(raw.requirements)}`),
          postedAt: toDate(raw.published_at) ?? toDate(raw.created_at),
          department: str(raw.department) || undefined,
          employmentType: str(raw.employment_type_code) || undefined,
          remote: raw.remote === true || /remote/i.test(str(raw.location)),
        }];
      });
    } catch (err) {
      warn("recruitee", employer, err);
      return [];
    }
  },
};

// ── Workable ──────────────────────────────────────────────────────────────────
// https://apply.workable.com/api/v1/widget/accounts/{slug}

export const workableAdapter: AtsAdapter = {
  platform: "workable",
  displayName: "Workable",
  homepage: "https://www.workable.com",
  async fetchPostings(employer, signal) {
    try {
      const data = await fetchJson<unknown>(
        `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(employer.slug)}`,
        { signal, retries: 2 },
      );
      if (!isRecord(data) || !Array.isArray(data.jobs)) return [];

      return data.jobs.slice(0, MAX_POSTINGS_PER_EMPLOYER).flatMap((raw): AtsPosting[] => {
        if (!isRecord(raw)) return [];
        const title = str(raw.title);
        const url = str(raw.url) || str(raw.shortlink) || str(raw.application_url);
        if (!title || !url) return [];

        return [{
          title,
          url,
          location: joinLocation(str(raw.city), str(raw.state), str(raw.country)),
          // The widget endpoint gives a summary, not the full posting.
          description: htmlToText(str(raw.description) || str(raw.requirements)),
          postedAt: toDate(raw.published_on) ?? toDate(raw.created_at),
          department: str(raw.department) || undefined,
          employmentType: str(raw.employment_type) || undefined,
          remote: raw.telecommuting === true,
        }];
      });
    } catch (err) {
      warn("workable", employer, err);
      return [];
    }
  },
};

export const ATS_ADAPTERS: AtsAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  smartRecruitersAdapter,
  recruiteeAdapter,
  workableAdapter,
];

export function adapterFor(platform: string): AtsAdapter | null {
  return ATS_ADAPTERS.find((adapter) => adapter.platform === platform) ?? null;
}
