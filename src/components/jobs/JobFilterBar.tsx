"use client";

import { useState } from "react";
import {
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  InputAdornment,
} from "@mui/material";
import { countryLabel, type CountryOption } from "./CountrySelect";

export interface JobFilters {
  source: string;
  position: string;
  hasSalary: boolean;
  workType: string;
  city: string;
  salaryMin: string;
  salaryMax: string;
  /**
   * ISO 3166-1 alpha-2 code, or "ALL". Optional so callers that build filters
   * from URL params (e.g. the favourites page) do not have to enumerate it.
   */
  country?: string;
  /** Keep only postings whose work type is Remote. */
  remoteOnly?: boolean;
}

export const DEFAULT_JOB_FILTERS: JobFilters = {
  source: "ALL",
  position: "",
  hasSalary: false,
  workType: "ALL",
  city: "",
  salaryMin: "",
  salaryMax: "",
  country: "ALL",
  remoteOnly: false,
};

interface JobFilterBarProps {
  sources: string[];
  filters: JobFilters;
  onChange: (filters: JobFilters) => void;
  /** Country codes present in the current result set; the filter hides when empty. */
  countries?: string[];
  /** Names for those codes, when the server has reported them. */
  countryNames?: CountryOption[];
  /** Currency shown on the salary inputs, e.g. "CZK". Omitted when mixed/unknown. */
  currency?: string;
}

export function JobFilterBar({
  sources,
  filters,
  onChange,
  countries = [],
  countryNames,
  currency,
}: JobFilterBarProps) {
  const set = <K extends keyof JobFilters>(key: K, value: JobFilters[K]) =>
    onChange({ ...filters, [key]: value });

  // Text filters commit on blur/Enter, not on every keystroke, so they keep a
  // local draft. When the parent replaces the filters (new search, URL change)
  // the draft is re-derived during render — comparing against the last props we
  // saw — instead of in an effect, which would cause a cascading re-render.
  const [draft, setDraft] = useState({ position: filters.position, city: filters.city });
  const [lastProps, setLastProps] = useState({ position: filters.position, city: filters.city });
  if (lastProps.position !== filters.position || lastProps.city !== filters.city) {
    setLastProps({ position: filters.position, city: filters.city });
    setDraft({ position: filters.position, city: filters.city });
  }

  const commitPosition = () => set("position", draft.position);
  const commitCity = () => set("city", draft.city);

  const allSources = ["ALL", ...sources];
  const salaryAdornment = currency
    ? { startAdornment: <InputAdornment position="start">{currency}</InputAdornment> }
    : undefined;

  return (
    <Box sx={{ mb: 2.5 }}>
      <Stack spacing={1.5}>
        {/* Row 1: text filters */}
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
          <TextField
            label="Position / Company"
            size="small"
            value={draft.position}
            onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value }))}
            onBlur={commitPosition}
            onKeyDown={(e) => e.key === "Enter" && commitPosition()}
            sx={{ minWidth: 200 }}
            placeholder="Search title or company…"
          />

          <TextField
            label="City"
            size="small"
            value={draft.city}
            onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))}
            onBlur={commitCity}
            onKeyDown={(e) => e.key === "Enter" && commitCity()}
            sx={{ minWidth: 150 }}
            placeholder="e.g. Berlin, Praha…"
          />

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="job-filter-source-label">Site</InputLabel>
            <Select
              labelId="job-filter-source-label"
              value={filters.source}
              label="Site"
              onChange={(e) => set("source", e.target.value)}
            >
              {allSources.map((src) => (
                <MenuItem key={src} value={src}>
                  {src === "ALL" ? "All Sites" : src}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {countries.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="job-filter-country-label">Country</InputLabel>
              <Select
                labelId="job-filter-country-label"
                value={filters.country ?? "ALL"}
                label="Country"
                onChange={(e) => set("country", e.target.value)}
              >
                <MenuItem value="ALL">All countries</MenuItem>
                {countries.map((code) => (
                  <MenuItem key={code} value={code}>
                    {countryLabel(code, countryNames)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={filters.hasSalary}
                onChange={(e) => set("hasSalary", e.target.checked)}
              />
            }
            label={<Typography variant="body2" color="text.secondary">Has Salary</Typography>}
            sx={{ ml: 0, gap: 0.5 }}
          />

          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={filters.remoteOnly ?? false}
                onChange={(e) => set("remoteOnly", e.target.checked)}
              />
            }
            label={<Typography variant="body2" color="text.secondary">Remote only</Typography>}
            sx={{ ml: 0, gap: 0.5 }}
          />
        </Stack>

        {/* Row 2: work type + salary range */}
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
          <ToggleButtonGroup
            value={filters.workType}
            exclusive
            size="small"
            onChange={(_, v) => { if (v !== null) set("workType", v); }}
            aria-label="Work type filter"
          >
            <ToggleButton value="ALL" sx={{ textTransform: "none", px: 1.5 }}>All</ToggleButton>
            <ToggleButton value="Remote" sx={{ textTransform: "none", px: 1.5 }}>Remote</ToggleButton>
            <ToggleButton value="Hybrid" sx={{ textTransform: "none", px: 1.5 }}>Hybrid</ToggleButton>
            <ToggleButton value="Onsite" sx={{ textTransform: "none", px: 1.5 }}>Onsite</ToggleButton>
          </ToggleButtonGroup>

          <TextField
            label="Min Salary"
            size="small"
            type="number"
            value={filters.salaryMin}
            onChange={(e) => set("salaryMin", e.target.value)}
            sx={{ width: 130 }}
            InputProps={salaryAdornment}
          />
          <TextField
            label="Max Salary"
            size="small"
            type="number"
            value={filters.salaryMax}
            onChange={(e) => set("salaryMax", e.target.value)}
            sx={{ width: 130 }}
            InputProps={salaryAdornment}
          />
        </Stack>
      </Stack>
    </Box>
  );
}
