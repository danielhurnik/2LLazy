/**
 * Jooble — a job aggregator with a separate site per country.
 *
 * This is the single most valuable board for country coverage: one scraper and
 * one domain table gives a searchable local board in nearly sixty countries,
 * including many where nobody has written a dedicated board yet. When a user's
 * country is not in the table the search falls back to the international site
 * rather than returning nothing.
 *
 * Jooble renders results client-side, so it needs a browser.
 */
import { pwFetch } from "../playwright-browser";
import { acceptLanguageFor, runHtmlBoard } from "./helpers";
import type { BoardDefinition, CountryCode } from "../types";

/**
 * ISO 3166-1 alpha-2 → Jooble host. `jooble.org` with no subdomain is the US
 * site, which also serves as the fallback for unmapped countries.
 */
export const JOOBLE_DOMAINS: Record<string, string> = {
  US: "jooble.org",
  CZ: "cz.jooble.org", SK: "sk.jooble.org", PL: "pl.jooble.org", DE: "de.jooble.org",
  AT: "at.jooble.org", CH: "ch.jooble.org", GB: "uk.jooble.org", IE: "ie.jooble.org",
  NL: "nl.jooble.org", BE: "be.jooble.org", FR: "fr.jooble.org", ES: "es.jooble.org",
  IT: "it.jooble.org", PT: "pt.jooble.org", RO: "ro.jooble.org", HU: "hu.jooble.org",
  BG: "bg.jooble.org", HR: "hr.jooble.org", RS: "rs.jooble.org", GR: "gr.jooble.org",
  SE: "se.jooble.org", NO: "no.jooble.org", DK: "dk.jooble.org", FI: "fi.jooble.org",
  EE: "ee.jooble.org", LV: "lv.jooble.org", LT: "lt.jooble.org", UA: "ua.jooble.org",
  TR: "tr.jooble.org", IL: "il.jooble.org", AE: "ae.jooble.org", SA: "sa.jooble.org",
  IN: "in.jooble.org", PK: "pk.jooble.org", BD: "bd.jooble.org", SG: "sg.jooble.org",
  MY: "my.jooble.org", PH: "ph.jooble.org", ID: "id.jooble.org", TH: "th.jooble.org",
  VN: "vn.jooble.org", JP: "jp.jooble.org", KR: "kr.jooble.org", HK: "hk.jooble.org",
  TW: "tw.jooble.org", AU: "au.jooble.org", NZ: "nz.jooble.org", ZA: "za.jooble.org",
  NG: "ng.jooble.org", KE: "ke.jooble.org", EG: "eg.jooble.org", MA: "ma.jooble.org",
  BR: "br.jooble.org", AR: "ar.jooble.org", CL: "cl.jooble.org", CO: "co.jooble.org",
  MX: "mx.jooble.org", PE: "pe.jooble.org", UY: "uy.jooble.org", CA: "ca.jooble.org",
};

/** Host for a country, falling back to the international site. */
export function joobleHost(country: CountryCode): string {
  return JOOBLE_DOMAINS[(country ?? "").toUpperCase()] ?? JOOBLE_DOMAINS.US;
}

export const joobleBoard: BoardDefinition = {
  id: "jooble",
  name: "Jooble",
  source: "JOOBLE",
  homepage: "https://jooble.org",
  countries: Object.keys(JOOBLE_DOMAINS),
  remoteOnly: false,
  requiresBrowser: true,
  note: "Aggregator with a local site in ~60 countries",
  scrape: (q) => {
    const host = joobleHost(q.country);
    const acceptLanguage = acceptLanguageFor(q.country);

    return runHtmlBoard({
      id: "jooble",
      source: "JOOBLE",
      country: q.country,
      maxPages: q.deepSearch ? 3 : 1,
      deepSearch: q.deepSearch,
      signal: q.signal,
      defaultLocation: q.city || "",
      buildUrl: (page) => {
        const params = new URLSearchParams({ ukw: q.query });
        if (q.city) params.set("l", q.city);
        if (q.remoteOnly) params.set("rgns", "remote");
        if (page > 1) params.set("p", String(page));
        return `https://${host}/SearchResult?${params.toString()}`;
      },
      fetchList: (url) =>
        pwFetch(url, {
          waitSelector: "[class*='job-item'], [class*='vacancy'], article[class*='job']",
          signal: q.signal,
          acceptLanguage,
        }),
      fetchDetail: (url) => pwFetch(url, { signal: q.signal, acceptLanguage }),
      select: {
        urlPattern: /jooble\.org\/(desc|jdp|away)\//i,
        cardSelector: "[class*='job-item'], article[class*='job']",
      },
      concurrency: 6,
    });
  },
};
