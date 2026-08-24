/**
 * Country data and country detection.
 *
 * Import from `@/lib/geo` rather than reaching into the individual modules —
 * `data.ts` is an implementation detail and may be reshaped.
 */
export type { CountryInfo } from "./countries";
export {
  DEFAULT_COUNTRY,
  acceptLanguageFor,
  countryFromLocationText,
  getCountry,
  listCountries,
  normaliseCountryCode,
} from "./countries";

export type { CountrySource, DetectInput, DetectedCountry } from "./detect";
export {
  LANGUAGE_TO_COUNTRY,
  countryFromAcceptLanguage,
  countryFromHeaders,
  detectCountry,
} from "./detect";
