"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  ButtonBase,
  Select,
  MenuItem,
  InputAdornment,
  Card,
  CardContent,
  LinearProgress,
  Stack,
  Skeleton,
  Switch,
  FormControlLabel,
  Tooltip,
} from "@mui/material";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import { JobCard } from "@/components/jobs/JobCard";
import { JobFilterBar, type JobFilters, DEFAULT_JOB_FILTERS } from "@/components/jobs/JobFilterBar";
import { ErrorAlertList } from "@/components/ui/ErrorAlertList";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkippedBoardsNote } from "@/components/jobs/SkippedBoardsNote";
import type { JobItem } from "@/types";
import { useScrapeProgress, PROGRESS_DONE_EMPTY, PROGRESS_STOPPED } from "@/context/ScrapeProgressContext";
import { COUNTRY_NAMES, isSupportedCountry, type CountryCode } from "@/lib/jobs/sources/types";
import { ui, fonts } from "@/theme/tokens";

const ANY_LEVEL = "Any";
const SKILL_LEVELS = ["Junior", "Mid", "Senior", "Lead", ANY_LEVEL];
const ALL_OPTION = "ALL";
const BOARDS = "startupjobs.cz · jobs.cz · nofluffjobs.com · cocuma.cz · jobstack.it · skilleto.cz · jooble.org";
const EXAMPLE_QUERIES = ["React developer", "Data engineer", "Java backend", "QA automation"];
const SEARCH_SESSION_KEY = "job_search_session";
const STORED_DESCRIPTION_LENGTH = 300;
const PROGRESS_PLACEHOLDER_PERCENT = 5;
const ARRIVAL_STAGGER_MS = 40;
const MAX_ARRIVAL_DELAY_MS = 400;
const SKELETON_CARD_COUNT = 3;
const SUPPORTED_COUNTRIES = Object.keys(COUNTRY_NAMES).filter(isSupportedCountry);

interface StoredSearchSession {
  jobs?: JobItem[];
  query?: string;
  city?: string;
  country?: string;
  skillLevel?: string;
  deepSearch?: boolean;
  progress?: string | null;
  errors?: string[];
}

interface FavouriteToggleResult {
  id: string;
  favourited: boolean;
}

const exampleLinkSx = {
  font: "inherit",
  verticalAlign: "baseline",
  color: ui.text,
  textDecoration: "underline",
  textDecorationColor: ui.lineStrong,
  textUnderlineOffset: 3,
  "&:hover": { textDecorationColor: ui.accent },
} as const;

const progressBarAnchorCardSx = { mb: 2, position: "relative" } as const;

const searchBarGridSx = {
  display: "grid",
  gap: 1,
  gridTemplateColumns: {
    xs: "repeat(2, minmax(0, 1fr))",
    sm: "88px minmax(0, 1fr) 130px",
    lg: "minmax(0, 1fr) 88px 160px 130px auto",
  },
  gridTemplateAreas: {
    xs: `"query query" "country city" "level search"`,
    sm: `"query query search" "country city level"`,
    lg: `"query country city level search"`,
  },
} as const;

const bottomEdgeProgressSx = (visible: boolean) => ({
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  bgcolor: "transparent",
  opacity: visible ? 1 : 0,
  transition: "opacity 0.3s ease",
});

const monoCaptionSx = (color: string) => ({ fontFamily: fonts.mono, fontSize: "0.75rem", color });

const skillLevelLabel = (level: string) => (level === ANY_LEVEL ? "Any level" : level);

function readSearchSession(): StoredSearchSession | null {
  try {
    const saved = sessionStorage.getItem(SEARCH_SESSION_KEY);
    return saved ? (JSON.parse(saved) as StoredSearchSession) : null;
  } catch {
    return null;
  }
}

function mergeIntoSearchSession(patch: StoredSearchSession) {
  try {
    sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify({ ...readSearchSession(), ...patch }));
  } catch {
    return;
  }
}

function salaryMidpoint(salary: string): number | null {
  const amounts =
    salary
      .match(/[\d\s]+/g)
      ?.map((n) => parseInt(n.replace(/\s/g, ""), 10))
      .filter((n) => !isNaN(n) && n > 0) ?? [];
  if (amounts.length === 0) return null;
  return amounts.reduce((sum, n) => sum + n, 0) / amounts.length;
}

function matchesSalaryRange(job: JobItem, { salaryMin, salaryMax }: JobFilters): boolean {
  if (!salaryMin && !salaryMax) return true;
  if (!job.salary) return false;
  const midpoint = salaryMidpoint(job.salary);
  if (midpoint === null) return true;
  if (salaryMin && midpoint < parseInt(salaryMin, 10)) return false;
  if (salaryMax && midpoint > parseInt(salaryMax, 10)) return false;
  return true;
}

function matchesFilters(job: JobItem, filters: JobFilters): boolean {
  if (filters.source !== ALL_OPTION && job.source !== filters.source) return false;
  if (filters.hasSalary && !job.salary) return false;
  if (filters.workType !== ALL_OPTION && job.workType && job.workType !== filters.workType) return false;
  if (filters.city.trim() && !job.location.toLowerCase().includes(filters.city.toLowerCase())) return false;
  if (!matchesSalaryRange(job, filters)) return false;
  if (filters.position.trim()) {
    const position = filters.position.toLowerCase();
    const matchesTitleOrCompany =
      job.title.toLowerCase().includes(position) || job.company.toLowerCase().includes(position);
    if (!matchesTitleOrCompany) return false;
  }
  return true;
}

const bySimilarityDescending = (a: JobItem, b: JobItem) => (b.similarity ?? 0) - (a.similarity ?? 0);

function listSeparator(index: number, length: number): string {
  if (index < length - 2) return ", ";
  if (index === length - 2) return " or ";
  return ".";
}

function describeSearchStatus(
  scraping: boolean,
  progress: string | null,
  sourceProgress: { done: number; total: number } | null,
  foundCount: number,
): string | null {
  if (!scraping) return progress === PROGRESS_STOPPED ? progress : null;
  const boardsPending = sourceProgress && sourceProgress.done < sourceProgress.total;
  return [
    progress,
    boardsPending && `${sourceProgress.done}/${sourceProgress.total} boards done`,
    foundCount > 0 && `${foundCount} found`,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function requestFavouriteToggle(jobId: string): Promise<FavouriteToggleResult> {
  const res = await fetch("/api/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation Fav($jobId: ID!) { toggleFavourite(jobId: $jobId) { id favourited } }`,
      variables: { jobId },
    }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data.toggleFavourite;
}

interface SearchClientProps {
  defaultCountry: CountryCode;
  defaultCity: string;
}

export function SearchClient({ defaultCountry, defaultCity }: SearchClientProps) {
  const queryInputRef = useRef<HTMLInputElement>(null);
  const cityInputRef = useRef<HTMLInputElement>(null);
  const [country, setCountry] = useState<CountryCode>(defaultCountry);
  const [skillLevel, setSkillLevel] = useState(ANY_LEVEL);
  const [deepSearch, setDeepSearch] = useState(false);
  const {
    scraping, scrapePercent, sourceProgress, skippedSources,
    progress, setProgress, jobs, setJobs, errors, setErrors,
    arrivalIndexRef, startSearch, stopSearch,
  } = useScrapeProgress();
  const [dismissedSkips, setDismissedSkips] = useState<string[] | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [filters, setFilters] = useState<JobFilters>(DEFAULT_JOB_FILTERS);

  useEffect(() => {
    const saved = readSearchSession();
    if (!saved) return;
    if (saved.query && queryInputRef.current) queryInputRef.current.value = saved.query;
    if (saved.city && cityInputRef.current) cityInputRef.current.value = saved.city;
    if (saved.country && isSupportedCountry(saved.country)) setCountry(saved.country);
    if (saved.skillLevel) setSkillLevel(saved.skillLevel);
    if (saved.deepSearch !== undefined) setDeepSearch(saved.deepSearch);
    const liveSearchStateExists = scraping || jobs.length > 0;
    if (liveSearchStateExists) return;
    if (saved.jobs?.length) {
      setJobs(saved.jobs.map((job) => ({ ...job, description: job.description ? job.description + "…" : "" })));
    }
    if (saved.progress === PROGRESS_DONE_EMPTY || saved.progress === PROGRESS_STOPPED) setProgress(saved.progress);
    if (saved.errors?.length) setErrors(saved.errors);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once on mount
  }, []);

  useEffect(() => {
    if (scraping || !jobs.length) return;
    mergeIntoSearchSession({
      jobs: jobs.map(({ description, ...rest }) => ({
        ...rest,
        description: description?.slice(0, STORED_DESCRIPTION_LENGTH) ?? "",
      })),
    });
  }, [jobs, scraping]);

  useEffect(() => {
    if (scraping) return;
    mergeIntoSearchSession({ skillLevel, deepSearch, progress, errors });
  }, [skillLevel, deepSearch, progress, errors, scraping]);

  const handleSearch = () => {
    const query = queryInputRef.current?.value.trim() ?? "";
    const city = cityInputRef.current?.value.trim() ?? "";
    if (scraping || !query) return;
    mergeIntoSearchSession({ query, city, country });
    setFilters(DEFAULT_JOB_FILTERS);
    void startSearch({ query, skillLevel, deepSearch, city, country });
  };

  const searchOnEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !scraping) handleSearch();
  };

  const searchFor = (query: string) => {
    if (queryInputRef.current) queryInputRef.current.value = query;
    handleSearch();
  };

  const handleToggleFavourite = async (job: JobItem) => {
    setTogglingId(job.id);
    try {
      const updated = await requestFavouriteToggle(job.id);
      setJobs((prev) => prev.map((j) => (j.id === updated.id ? { ...j, favourited: updated.favourited } : j)));
    } catch (err) {
      setErrors((prev) => [...prev, `Favourite failed: ${String(err)}`]);
    } finally {
      setTogglingId(null);
    }
  };

  const filteredJobs = jobs.filter((job) => matchesFilters(job, filters));
  const rankedJobs = [...filteredJobs].sort(bySimilarityDescending);
  const cachedCount = filteredJobs.filter((job) => job.isStale).length;
  const statusText = describeSearchStatus(scraping, progress, sourceProgress, jobs.length);
  const showExampleQueries = !scraping && jobs.length === 0 && !progress;
  const showNoMatches = !scraping && jobs.length === 0 && progress === PROGRESS_DONE_EMPTY;
  const showSkippedBoards = skippedSources.length > 0 && dismissedSkips !== skippedSources;

  const renderJobCard = (job: JobItem) => (
    <JobCard key={job.id} job={job} isToggling={togglingId === job.id} onToggleFavourite={handleToggleFavourite} />
  );

  return (
    <Box>
      <PageHeader title="Find jobs" meta={BOARDS} />

      <Card sx={progressBarAnchorCardSx}>
        <CardContent sx={{ p: "12px !important" }}>
          <Box sx={searchBarGridSx}>
            <TextField
              placeholder="Job title or stack, e.g. React developer"
              inputRef={queryInputRef}
              defaultValue=""
              onKeyDown={searchOnEnter}
              fullWidth
              size="small"
              sx={{ gridArea: "query" }}
              inputProps={{ "aria-label": "Job Position" }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon sx={{ fontSize: 18, color: ui.textFaint }} />
                  </InputAdornment>
                ),
              }}
            />
            <Select
              size="small"
              value={country}
              onChange={(e) => {
                if (isSupportedCountry(e.target.value)) setCountry(e.target.value);
              }}
              renderValue={(code) => code}
              SelectDisplayProps={{ "aria-label": "Country" }}
              sx={{ gridArea: "country" }}
            >
              {SUPPORTED_COUNTRIES.map((code) => (
                <MenuItem key={code} value={code} sx={{ gap: 1.5, justifyContent: "space-between" }}>
                  {COUNTRY_NAMES[code]}
                  <Box component="span" sx={monoCaptionSx(ui.textFaint)}>{code}</Box>
                </MenuItem>
              ))}
            </Select>
            <TextField
              placeholder="City"
              inputRef={cityInputRef}
              defaultValue={defaultCity}
              onKeyDown={searchOnEnter}
              size="small"
              inputProps={{ "aria-label": "City (optional)" }}
              sx={{ gridArea: "city" }}
            />
            <Select
              size="small"
              value={skillLevel}
              onChange={(e) => setSkillLevel(e.target.value)}
              renderValue={skillLevelLabel}
              SelectDisplayProps={{ "aria-label": "Skill Level" }}
              sx={{ gridArea: "level" }}
            >
              {SKILL_LEVELS.map((level) => (
                <MenuItem key={level} value={level}>{skillLevelLabel(level)}</MenuItem>
              ))}
            </Select>
            <Button
              variant={scraping ? "outlined" : "contained"}
              color={scraping ? "inherit" : "primary"}
              startIcon={scraping ? <StopRoundedIcon /> : undefined}
              onClick={scraping ? stopSearch : handleSearch}
              sx={{ gridArea: "search", minWidth: 96, height: 40 }}
            >
              {scraping ? "Stop" : "Search"}
            </Button>
          </Box>

          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mt: 1.25, px: 0.5, minHeight: 22 }}
          >
            <Tooltip title="Reads several result pages per board. Slower, finds more.">
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={deepSearch}
                    onChange={(e) => setDeepSearch(e.target.checked)}
                    disabled={scraping}
                  />
                }
                label="Deep search"
              />
            </Tooltip>
            {statusText && (
              <Typography noWrap sx={{ minWidth: 0, ml: 2, ...monoCaptionSx(ui.textMuted) }}>
                {statusText}
              </Typography>
            )}
          </Stack>
        </CardContent>

        <LinearProgress
          variant="determinate"
          value={sourceProgress ? scrapePercent : PROGRESS_PLACEHOLDER_PERCENT}
          aria-hidden={!scraping}
          sx={bottomEdgeProgressSx(scraping)}
        />
      </Card>

      {showSkippedBoards && (
        <SkippedBoardsNote reasons={skippedSources} onDismiss={() => setDismissedSkips(skippedSources)} />
      )}

      <ErrorAlertList
        errors={errors}
        onDismiss={(i) => setErrors((prev) => prev.filter((_, j) => j !== i))}
      />

      {showExampleQueries && (
        <Box sx={{ px: 0.5 }}>
          <Typography variant="body2" sx={{ color: ui.textMuted }}>
            Try{" "}
            {EXAMPLE_QUERIES.map((query, i) => (
              <span key={query}>
                <ButtonBase onClick={() => searchFor(query)} sx={exampleLinkSx}>
                  {query}
                </ButtonBase>
                {listSeparator(i, EXAMPLE_QUERIES.length)}
              </span>
            ))}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: ui.textFaint }}>
            A search takes about a minute and keeps running if you switch pages.
          </Typography>
        </Box>
      )}

      {showNoMatches && (
        <EmptyState title="No matches">
          Try a broader title, set the level to Any level, or turn on Deep search.
        </EmptyState>
      )}

      {jobs.length > 0 && (
        <>
          <JobFilterBar sources={Array.from(new Set(jobs.map((j) => j.source))).sort()} filters={filters} onChange={setFilters} />
          <Typography sx={{ mb: 1.5, ...monoCaptionSx(ui.textFaint) }}>
            {filteredJobs.length === jobs.length
              ? `${jobs.length} results`
              : `${filteredJobs.length} of ${jobs.length} results`}
            {cachedCount > 0 && ` · ${filteredJobs.length - cachedCount} fresh · ${cachedCount} cached`}
          </Typography>
        </>
      )}

      {scraping && jobs.length === 0 && (
        <Stack spacing={1.25}>
          {Array.from({ length: SKELETON_CARD_COUNT }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={150} sx={{ borderRadius: 2 }} />
          ))}
        </Stack>
      )}

      <Stack spacing={1.25}>
        {rankedJobs.map((job) => {
          const arrivalIndex = arrivalIndexRef.current.get(job.id);
          const arrivedInThisSearch = arrivalIndex !== undefined;
          return (
            <Box
              key={job.id}
              sx={arrivedInThisSearch ? {
                animation: "rise 220ms ease-out both",
                animationDelay: `${Math.min(arrivalIndex * ARRIVAL_STAGGER_MS, MAX_ARRIVAL_DELAY_MS)}ms`,
              } : undefined}
            >
              {renderJobCard(job)}
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
