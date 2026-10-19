"use client";

import { useState } from "react";
import {
  FormControlLabel,
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
import { sourceLabel } from "@/types";
import { ui } from "@/theme/tokens";

export const ALL_OPTION = "ALL";

export interface JobFilters {
  source: string;
  position: string;
  hasSalary: boolean;
  workType: string;
  city: string;
  salaryMin: string;
  salaryMax: string;
}

export const DEFAULT_JOB_FILTERS: JobFilters = {
  source: ALL_OPTION,
  position: "",
  hasSalary: false,
  workType: ALL_OPTION,
  city: "",
  salaryMin: "",
  salaryMax: "",
};

interface JobFilterBarProps {
  sources: string[];
  filters: JobFilters;
  onChange: (filters: JobFilters) => void;
  variant?: "full" | "basic";
}

const WORK_TYPES = [
  { value: ALL_OPTION, label: "Any" },
  { value: "Remote", label: "Remote" },
  { value: "Hybrid", label: "Hybrid" },
  { value: "Onsite", label: "Onsite" },
];

const sourceOptionLabel = (source: string) =>
  source === ALL_OPTION ? "All boards" : sourceLabel(source);

interface CommitOnBlurTextFieldProps {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  width: number;
}

function CommitOnBlurTextField({ value, onCommit, placeholder, ariaLabel, width }: CommitOnBlurTextFieldProps) {
  const [draft, setDraft] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(value);
  }

  const commit = () => onCommit(draft);

  return (
    <TextField
      size="small"
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === "Enter" && commit()}
      inputProps={{ "aria-label": ariaLabel }}
      sx={{ width }}
    />
  );
}

interface PositionFilterFieldProps {
  value: string;
  onCommit: (position: string) => void;
}

export function PositionFilterField({ value, onCommit }: PositionFilterFieldProps) {
  return (
    <CommitOnBlurTextField
      value={value}
      onCommit={onCommit}
      placeholder="Filter by title or company"
      ariaLabel="Position / Company"
      width={220}
    />
  );
}

interface SourceFilterSelectProps {
  sources: string[];
  value: string;
  onChange: (source: string) => void;
}

export function SourceFilterSelect({ sources, value, onChange }: SourceFilterSelectProps) {
  return (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      SelectDisplayProps={{ "aria-label": "Job board" }}
      sx={{ minWidth: 150 }}
    >
      {[ALL_OPTION, ...sources].map((source) => (
        <MenuItem key={source} value={source}>
          {sourceOptionLabel(source)}
        </MenuItem>
      ))}
    </Select>
  );
}

interface HasSalarySwitchProps {
  checked: boolean;
  onChange: (hasSalary: boolean) => void;
}

export function HasSalarySwitch({ checked, onChange }: HasSalarySwitchProps) {
  return (
    <FormControlLabel
      control={
        <Switch
          size="small"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
      }
      label="Has salary"
      sx={{ ml: 0.5 }}
    />
  );
}

interface WorkTypeToggleProps {
  value: string;
  onChange: (workType: string) => void;
}

function WorkTypeToggle({ value, onChange }: WorkTypeToggleProps) {
  return (
    <ToggleButtonGroup
      value={value}
      exclusive
      size="small"
      onChange={(_event, workType: string | null) => {
        if (workType !== null) onChange(workType);
      }}
      aria-label="Work type"
    >
      {WORK_TYPES.map((workType) => (
        <ToggleButton key={workType.value} value={workType.value}>{workType.label}</ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

interface SalaryRangeFieldsProps {
  salaryMin: string;
  salaryMax: string;
  onSalaryMinChange: (salaryMin: string) => void;
  onSalaryMaxChange: (salaryMax: string) => void;
}

function SalaryRangeFields({ salaryMin, salaryMax, onSalaryMinChange, onSalaryMaxChange }: SalaryRangeFieldsProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.75}>
      <TextField
        size="small"
        type="number"
        placeholder="Min"
        value={salaryMin}
        onChange={(event) => onSalaryMinChange(event.target.value)}
        inputProps={{ "aria-label": "Minimum monthly salary in CZK" }}
        sx={{ width: 92 }}
      />
      <Typography sx={{ color: ui.textFaint }}>–</Typography>
      <TextField
        size="small"
        type="number"
        placeholder="Max"
        value={salaryMax}
        onChange={(event) => onSalaryMaxChange(event.target.value)}
        inputProps={{ "aria-label": "Maximum monthly salary in CZK" }}
        InputProps={{ endAdornment: <InputAdornment position="end">Kč</InputAdornment> }}
        sx={{ width: 118 }}
      />
    </Stack>
  );
}

export function JobFilterBar({ sources, filters, onChange, variant = "full" }: JobFilterBarProps) {
  const updateFilter = <K extends keyof JobFilters>(key: K, value: JobFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const isFullVariant = variant === "full";

  return (
    <Stack direction="row" sx={{ mb: 2, flexWrap: "wrap", alignItems: "center", gap: 1 }}>
      <PositionFilterField
        value={filters.position}
        onCommit={(position) => updateFilter("position", position)}
      />

      {isFullVariant && (
        <CommitOnBlurTextField
          value={filters.city}
          onCommit={(city) => updateFilter("city", city)}
          placeholder="City"
          ariaLabel="City"
          width={120}
        />
      )}

      <SourceFilterSelect
        sources={sources}
        value={filters.source}
        onChange={(source) => updateFilter("source", source)}
      />

      {isFullVariant && (
        <WorkTypeToggle
          value={filters.workType}
          onChange={(workType) => updateFilter("workType", workType)}
        />
      )}

      {isFullVariant && (
        <SalaryRangeFields
          salaryMin={filters.salaryMin}
          salaryMax={filters.salaryMax}
          onSalaryMinChange={(salaryMin) => updateFilter("salaryMin", salaryMin)}
          onSalaryMaxChange={(salaryMax) => updateFilter("salaryMax", salaryMax)}
        />
      )}

      <HasSalarySwitch
        checked={filters.hasSalary}
        onChange={(hasSalary) => updateFilter("hasSalary", hasSalary)}
      />
    </Stack>
  );
}
