import { describe, expect, it } from "vitest";
import {
  DEFAULT_COUNTRY,
  acceptLanguageFor,
  countryFromAcceptLanguage,
  countryFromHeaders,
  countryFromLocationText,
  detectCountry,
  getCountry,
  listCountries,
  normaliseCountryCode,
} from "@/lib/geo";

describe("country dataset", () => {
  const countries = listCountries();

  it("covers a meaningful spread of job markets", () => {
    expect(countries.length).toBeGreaterThanOrEqual(60);
  });

  it("has well-formed, unique entries", () => {
    const codes = new Set<string>();
    for (const country of countries) {
      expect(country.code, country.name).toMatch(/^[A-Z]{2}$/);
      expect(codes.has(country.code), `duplicate ${country.code}`).toBe(false);
      codes.add(country.code);

      expect(country.name.length, country.code).toBeGreaterThan(1);
      expect(country.languages.length, country.code).toBeGreaterThan(0);
      expect(country.cities.length, country.code).toBeGreaterThan(0);
      expect(country.currency, country.code).toMatch(/^[A-Z]{3}$/);

      // Matching lowercases the haystack, so the data must already be folded.
      for (const city of country.cities) {
        expect(city, `${country.code}: ${city}`).toBe(city.toLowerCase());
      }
    }
  });

  it("is sorted by name", () => {
    const names = countries.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("has a default that exists in the dataset", () => {
    expect(getCountry(DEFAULT_COUNTRY)).not.toBeNull();
  });
});

describe("normaliseCountryCode", () => {
  it("accepts codes, English names and local aliases in any case", () => {
    expect(normaliseCountryCode("cz")).toBe("CZ");
    expect(normaliseCountryCode("CZ")).toBe("CZ");
    expect(normaliseCountryCode("Czechia")).toBe("CZ");
    expect(normaliseCountryCode("czech republic")).toBe("CZ");
    expect(normaliseCountryCode("Deutschland")).toBe("DE");
  });

  it("returns null for anything it cannot place", () => {
    expect(normaliseCountryCode("zz")).toBeNull();
    expect(normaliseCountryCode("")).toBeNull();
    expect(normaliseCountryCode(null)).toBeNull();
    expect(normaliseCountryCode("Atlantis")).toBeNull();
  });
});

describe("countryFromLocationText", () => {
  it("reads a country out of a job posting's location field", () => {
    expect(countryFromLocationText("Prague, Czech Republic")).toBe("CZ");
    expect(countryFromLocationText("Brno, Czechia")).toBe("CZ");
    expect(countryFromLocationText("London, UK")).toBe("GB");
    expect(countryFromLocationText("Berlin")).toBe("DE");
  });

  it("handles diacritics and local spellings", () => {
    expect(countryFromLocationText("Plzeň")).toBe("CZ");
    expect(countryFromLocationText("São Paulo")).toBe("BR");
  });

  it("declines to guess rather than guessing wrongly", () => {
    // "Remote" names no country, and inventing one would mislabel the posting.
    expect(countryFromLocationText("Remote")).toBeNull();
    expect(countryFromLocationText("Mars Base Alpha")).toBeNull();
    expect(countryFromLocationText("")).toBeNull();
    expect(countryFromLocationText(null)).toBeNull();
  });
});

describe("countryFromHeaders", () => {
  it("reads the common CDN geo headers", () => {
    expect(countryFromHeaders(new Headers({ "x-vercel-ip-country": "de" }))).toBe("DE");
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "PL" }))).toBe("PL");
  });

  it("decodes Netlify's base64 x-nf-geo payload", () => {
    const payload = Buffer.from(JSON.stringify({ country: { code: "SE" } })).toString("base64");
    expect(countryFromHeaders(new Headers({ "x-nf-geo": payload }))).toBe("SE");
  });

  it("falls through safely on a malformed x-nf-geo", () => {
    for (const value of [
      "not-base64!!",
      Buffer.from("not json").toString("base64"),
      Buffer.from(JSON.stringify({ nothing: true })).toString("base64"),
    ]) {
      expect(() => countryFromHeaders(new Headers({ "x-nf-geo": value }))).not.toThrow();
      expect(countryFromHeaders(new Headers({ "x-nf-geo": value }))).toBeNull();
    }
  });

  it("ignores Cloudflare's reserved placeholder values", () => {
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "T1" }))).toBeNull();
  });
});

describe("countryFromAcceptLanguage", () => {
  it("takes the region subtag", () => {
    expect(countryFromAcceptLanguage("cs-CZ,cs;q=0.9,en;q=0.8")).toBe("CZ");
  });

  it("respects q-value ordering rather than document order", () => {
    expect(countryFromAcceptLanguage("en-US;q=0.5,de-DE;q=0.9")).toBe("DE");
  });

  it("maps a bare language only when it is unambiguous", () => {
    expect(countryFromAcceptLanguage("cs")).toBe("CZ");
    expect(countryFromAcceptLanguage("pl")).toBe("PL");
    // English, Spanish, French and Portuguese are spoken across many countries;
    // guessing one would silently send the user to the wrong job market.
    expect(countryFromAcceptLanguage("en")).toBeNull();
    expect(countryFromAcceptLanguage("es")).toBeNull();
  });

  it("handles absent or junk headers", () => {
    expect(countryFromAcceptLanguage(null)).toBeNull();
    expect(countryFromAcceptLanguage("")).toBeNull();
    expect(countryFromAcceptLanguage(";;;")).toBeNull();
  });
});

describe("detectCountry", () => {
  it("follows the documented priority order", () => {
    const headers = new Headers({ "cf-ipcountry": "DE", "accept-language": "pl-PL" });

    expect(detectCountry({ explicit: "cz", profile: "SE", headers })).toMatchObject({
      country: "CZ",
      via: "explicit",
    });
    expect(detectCountry({ profile: "SE", headers })).toMatchObject({
      country: "SE",
      via: "profile",
    });
    expect(detectCountry({ headers })).toMatchObject({ country: "DE", via: "geo-header" });
    expect(detectCountry({ headers: new Headers({ "accept-language": "pl-PL" }) })).toMatchObject({
      country: "PL",
      via: "accept-language",
    });
    expect(detectCountry({})).toMatchObject({ country: DEFAULT_COUNTRY, via: "default" });
  });

  it("skips an unrecognisable value instead of failing", () => {
    expect(detectCountry({ explicit: "Atlantis", profile: "CZ" })).toMatchObject({
      country: "CZ",
      via: "profile",
    });
  });

  it("always returns a display name alongside the code", () => {
    const detected = detectCountry({ explicit: "BR" });
    expect(detected.countryName).toBe(getCountry("BR")!.name);
  });
});

describe("acceptLanguageFor", () => {
  it("builds a header that prefers the country's own language", () => {
    expect(acceptLanguageFor("CZ")).toMatch(/^cs/);
    expect(acceptLanguageFor("PL")).toMatch(/^pl/);
  });

  it("always keeps English as a fallback", () => {
    for (const code of ["CZ", "DE", "BR", "ZZ"]) {
      expect(acceptLanguageFor(code), code).toContain("en");
    }
  });
});
