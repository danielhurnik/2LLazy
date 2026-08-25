"use client";

import { useMemo } from "react";
import { Autocomplete, Box, TextField } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

export interface CountryOption {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: string;
  name: string;
}

/**
 * Bootstrap list so the selector is usable on first paint, before
 * `/api/boards` or the scrape `meta` event tells us what the server supports.
 *
 * Deliberately hard-coded here instead of imported from `@/lib/geo`: that module
 * is server-side and pulling it into a client component would ship the whole
 * country table (and its scraper dependencies) to the browser.
 */
export const COMMON_COUNTRIES: CountryOption[] = [
  { code: "AE", name: "United Arab Emirates" },
  { code: "AR", name: "Argentina" },
  { code: "AT", name: "Austria" },
  { code: "AU", name: "Australia" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "BR", name: "Brazil" },
  { code: "CA", name: "Canada" },
  { code: "CH", name: "Switzerland" },
  { code: "CZ", name: "Czechia" },
  { code: "DE", name: "Germany" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "ES", name: "Spain" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "GB", name: "United Kingdom" },
  { code: "GR", name: "Greece" },
  { code: "HR", name: "Croatia" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IL", name: "Israel" },
  { code: "IN", name: "India" },
  { code: "IT", name: "Italy" },
  { code: "JP", name: "Japan" },
  { code: "LT", name: "Lithuania" },
  { code: "LV", name: "Latvia" },
  { code: "MX", name: "Mexico" },
  { code: "NL", name: "Netherlands" },
  { code: "NO", name: "Norway" },
  { code: "NZ", name: "New Zealand" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SE", name: "Sweden" },
  { code: "SG", name: "Singapore" },
  { code: "SI", name: "Slovenia" },
  { code: "SK", name: "Slovakia" },
  { code: "TR", name: "Türkiye" },
  { code: "UA", name: "Ukraine" },
  { code: "US", name: "United States" },
  { code: "ZA", name: "South Africa" },
];

/**
 * Flag for an alpha-2 code via regional-indicator maths (A → 🇦, B → 🇧, …).
 * Returns "" for anything that is not two ASCII letters, so a malformed code
 * degrades to plain text rather than mojibake.
 */
export function flagEmoji(code: string): string {
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(
    ...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  );
}

/**
 * Merge server-reported countries into the bootstrap list.
 * Server names win, so a locally stale label is corrected as soon as the API
 * answers, and codes we have never heard of still show up (sorted by name).
 */
export function mergeCountries(extra: CountryOption[] = []): CountryOption[] {
  const byCode = new Map<string, CountryOption>();
  for (const c of COMMON_COUNTRIES) byCode.set(c.code.toUpperCase(), c);
  for (const c of extra) {
    const code = c.code?.trim().toUpperCase();
    if (!code) continue;
    byCode.set(code, { code, name: c.name?.trim() || byCode.get(code)?.name || code });
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "🇩🇪 Germany" for display, falling back to the bare code when unknown. */
export function countryLabel(code: string, countries: CountryOption[] = COMMON_COUNTRIES): string {
  const cc = code?.trim().toUpperCase() ?? "";
  if (!cc) return "";
  const name = countries.find((c) => c.code === cc)?.name ?? cc;
  const flag = flagEmoji(cc);
  return flag ? `${flag} ${name}` : name;
}

interface CountrySelectProps {
  /** Selected ISO 3166-1 alpha-2 code, or "" for none. */
  value: string;
  onChange: (code: string) => void;
  /** Extra countries reported by the server; merged with {@link COMMON_COUNTRIES}. */
  countries?: CountryOption[];
  label?: string;
  disabled?: boolean;
  size?: "small" | "medium";
  /** Allow clearing back to "" (server-side detection). */
  clearable?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * Country picker used by the search page and the job filters.
 *
 * Takes its option list as a prop rather than importing the geo tables so the
 * client bundle stays small and the server stays the single source of truth.
 */
export function CountrySelect({
  value,
  onChange,
  countries,
  label = "Country",
  disabled,
  size = "small",
  clearable = false,
  sx,
}: CountrySelectProps) {
  const options = useMemo(() => mergeCountries(countries), [countries]);

  // A code the server sent but we have no name for still needs to render.
  const selected = useMemo(() => {
    const cc = value?.trim().toUpperCase() ?? "";
    if (!cc) return null;
    return options.find((o) => o.code === cc) ?? { code: cc, name: cc };
  }, [value, options]);

  return (
    <Autocomplete
      options={options}
      value={selected}
      onChange={(_, option) => onChange(option?.code ?? "")}
      isOptionEqualToValue={(a, b) => a.code === b.code}
      getOptionLabel={(o) => o.name}
      disabled={disabled}
      size={size}
      disableClearable={!clearable}
      autoHighlight
      sx={{ minWidth: 190, ...sx }}
      renderOption={(props, option) => {
        const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
        return (
          <Box component="li" key={key} {...rest} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Box component="span" sx={{ fontSize: "1.05rem", lineHeight: 1 }}>
              {flagEmoji(option.code)}
            </Box>
            <Box component="span" sx={{ flexGrow: 1, minWidth: 0 }}>
              {option.name}
            </Box>
            <Box component="span" sx={{ opacity: 0.45, fontSize: "0.75rem" }}>
              {option.code}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          InputProps={{
            ...params.InputProps,
            startAdornment: selected ? (
              <Box component="span" sx={{ pl: 0.75, fontSize: "1.05rem", lineHeight: 1 }}>
                {flagEmoji(selected.code)}
              </Box>
            ) : null,
          }}
        />
      )}
    />
  );
}
