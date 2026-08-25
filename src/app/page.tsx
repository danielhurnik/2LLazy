"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Card,
  CardContent,
  LinearProgress,
  Stack,
  Skeleton,
  GlobalStyles,
  Switch,
  FormControlLabel,
  Tooltip,
  Alert,
  Chip,
  CircularProgress,
  Link,
  alpha,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import PublicIcon from "@mui/icons-material/Public";
import { JobCard } from "@/components/jobs/JobCard";
import { JobFilterBar, type JobFilters, DEFAULT_JOB_FILTERS } from "@/components/jobs/JobFilterBar";
import { CountrySelect, countryLabel, flagEmoji, type CountryOption } from "@/components/jobs/CountrySelect";
import { ErrorAlertList } from "@/components/ui/ErrorAlertList";
import type { BoardsResponse, CountryDetection, JobItem, SearchBoard } from "@/types";
import { jobScore } from "@/types";
import { useScrapeProgress } from "@/context/ScrapeProgressContext";
import { ios } from "@/theme/theme";

type JobResult = JobItem;

/** Events streamed by `POST /api/scrape`, one per `data:` line. */
type ScrapeEvent =
  | {
      type: "meta";
      country: string;
      countryName: string;
      detectedVia: CountryDetection;
      boards: SearchBoard[];
    }
  | { type: "progress"; site?: string; message?: string }
  | { type: "job"; data: JobResult }
  | { type: "scraperDone"; site?: string; doneCount: number; total: number }
  | { type: "scrapersDone"; total: number }
  | { type: "complete"; total?: number }
  | { type: "error"; site?: string; message?: string };

const SKILL_LEVELS = ["Junior", "Mid", "Senior", "Lead", "Any"];

/** Detection methods the user did not choose themselves — worth flagging. */
const AUTO_DETECTED: CountryDetection[] = ["geo-header", "accept-language"];

interface SearchSession {
  jobs?: JobResult[];
  query?: string;
  city?: string;
  skillLevel?: string;
  deepSearch?: boolean;
  remoteOnly?: boolean;
  country?: string;
  progress?: string;
  errors?: string[];
}

export default function SearchPage() {
  const queryInputRef = useRef<HTMLInputElement>(null);
  const cityInputRef = useRef<HTMLInputElement>(null);
  const countryBoxRef = useRef<HTMLDivElement>(null);
  const [skillLevel, setSkillLevel] = useState("Any");
  const [deepSearch, setDeepSearch] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [country, setCountry] = useState("");
  const [countryName, setCountryName] = useState("");
  const [detectedVia, setDetectedVia] = useState<CountryDetection | null>(null);
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([]);
  const [boards, setBoards] = useState<SearchBoard[]>([]);
  const [jobs, setJobs] = useState<JobResult[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const { scraping, setScraping, scrapePercent, setScrapePercent } = useScrapeProgress();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [filters, setFilters] = useState<JobFilters>(DEFAULT_JOB_FILTERS);
  const abortRef = useRef<AbortController | null>(null);
  // Track which job IDs arrived via the live SSE stream (not restored from sessionStorage)
  const newJobIdsRef = useRef<Set<string>>(new Set());
  // Maps job ID → arrival index so we can stagger the entrance animation delay
  const jobArrivalIndexRef = useRef<Map<string, number>>(new Map());
  const arrivalCountRef = useRef(0);
  const uniqueJobCountRef = useRef(0);

  // Restore last search session when navigating back to this page
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("job_search_session");
      if (saved) {
        const p = JSON.parse(saved) as SearchSession;
        if (p.jobs?.length) setJobs(p.jobs.map((j) => ({ ...j, description: j.description ? j.description + "…" : "" })));
        if (p.query && queryInputRef.current) queryInputRef.current.value = p.query;
        if (p.city && cityInputRef.current) cityInputRef.current.value = p.city ?? "";
        if (p.skillLevel) setSkillLevel(p.skillLevel);
        if (p.deepSearch !== undefined) setDeepSearch(p.deepSearch);
        if (p.remoteOnly !== undefined) setRemoteOnly(p.remoteOnly);
        if (p.country) {
          setCountry(p.country);
          setDetectedVia("explicit");
        }
        // Only restore a terminal progress message, not a mid-scrape one
        if (p.progress && !p.progress.startsWith("Scraping") && !p.progress.startsWith("Starting")) {
          setProgress(p.progress);
        }
        if (p.errors?.length) setErrors(p.errors);
      }
    } catch { /* corrupt / unavailable */ }
  }, []);

  /** Applies a `meta` event (or the /api/boards payload) to the country UI. */
  const applyCountryMeta = useCallback(
    (meta: { country: string; countryName: string; detectedVia: CountryDetection; boards: SearchBoard[] }) => {
      setCountry(meta.country);
      setCountryName(meta.countryName);
      setDetectedVia(meta.detectedVia);
      setBoards(meta.boards ?? []);
      if (meta.country && meta.countryName) {
        setCountryOptions((prev) =>
          prev.some((c) => c.code === meta.country)
            ? prev
            : [...prev, { code: meta.country, name: meta.countryName }],
        );
      }
    },
    [],
  );

  // Ask the server which boards serve this user before the first search, so the
  // country selector is pre-filled and the board row is not empty on arrival.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const saved = (() => {
          try {
            return (JSON.parse(sessionStorage.getItem("job_search_session") ?? "{}") as SearchSession).country ?? "";
          } catch { return ""; }
        })();
        const qs = saved ? `?country=${encodeURIComponent(saved)}` : "";
        const res = await fetch(`/api/boards${qs}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as BoardsResponse;
        applyCountryMeta({
          country: data.country,
          countryName: data.countryName,
          detectedVia: data.detectedVia,
          boards: data.boards.filter((b) => b.enabled),
        });
      } catch { /* offline or aborted — the selector still works from COMMON_COUNTRIES */ }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the job list only when it actually changes (avoids stringify on every keystroke)
  useEffect(() => {
    if (scraping || !jobs.length) return;
    try {
      const existing = sessionStorage.getItem("job_search_session");
      const parsed = existing ? JSON.parse(existing) : {};
      sessionStorage.setItem(
        "job_search_session",
        JSON.stringify({ ...parsed, jobs: jobs.map(({ description, ...rest }) => ({ ...rest, description: description?.slice(0, 300) ?? "" })) }),
      );
    } catch { /* storage quota exceeded */ }
  }, [jobs, scraping]);

  // Persist cheap scalar values when they change (query is saved at search-submit time, not here)
  useEffect(() => {
    if (scraping) return;
    try {
      const existing = sessionStorage.getItem("job_search_session");
      const parsed = existing ? JSON.parse(existing) : {};
      sessionStorage.setItem(
        "job_search_session",
        JSON.stringify({ ...parsed, skillLevel, deepSearch, remoteOnly, country, progress, errors }),
      );
    } catch { /* storage quota exceeded */ }
  }, [skillLevel, deepSearch, remoteOnly, country, progress, errors, scraping]);

  const handleSearch = async () => {
    const q = queryInputRef.current?.value.trim() ?? "";
    const city = cityInputRef.current?.value.trim() ?? "";
    if (scraping || !q) return; // guard against double-submit (button + Enter)
    // Save query to session at submit time so it restores on navigation
    try {
      const existing = sessionStorage.getItem("job_search_session");
      const parsed = existing ? JSON.parse(existing) : {};
      sessionStorage.setItem("job_search_session", JSON.stringify({ ...parsed, query: q, city, country }));
    } catch { /* storage quota exceeded */ }
    setJobs([]);
    setErrors([]);
    setFilters(DEFAULT_JOB_FILTERS);
    newJobIdsRef.current = new Set();
    jobArrivalIndexRef.current = new Map();
    arrivalCountRef.current = 0;
    uniqueJobCountRef.current = 0;
    setScraping(true);
    setScrapePercent(0);
    setProgress("Starting scrape...");

    abortRef.current = new AbortController();

    // One handler for both the streaming loop and the post-stream flush.
    const handleEvent = (event: ScrapeEvent) => {
      if (event.type === "meta") {
        applyCountryMeta(event);
      } else if (event.type === "progress") {
        setProgress(event.message ?? null);
      } else if (event.type === "scraperDone" && event.doneCount != null && event.total != null) {
        setScrapePercent(Math.round((event.doneCount / event.total) * 100));
      } else if (event.type === "scrapersDone") {
        // Boards are finished; the server is still de-duplicating and ranking.
        setScrapePercent(100);
        setProgress("Ranking results…");
      } else if (event.type === "job" && event.data) {
        const job = event.data;
        if (!newJobIdsRef.current.has(job.id)) {
          newJobIdsRef.current.add(job.id);
          jobArrivalIndexRef.current.set(job.id, arrivalCountRef.current++);
        }
        setJobs((prev) => {
          const exists = prev.some((j) => j.id === job.id);
          if (!exists) uniqueJobCountRef.current++;
          return exists ? prev : [...prev, job];
        });
      } else if (event.type === "complete") {
        setScrapePercent(100);
        setProgress(uniqueJobCountRef.current === 0 ? "done-empty" : null);
        setScraping(false);
      } else if (event.type === "error") {
        setErrors((prev) => [...prev, `${event.site ?? "scraper"}: ${event.message ?? "failed"}`]);
      }
    };

    const handleLine = (line: string) => {
      if (!line.startsWith("data: ")) return;
      try {
        handleEvent(JSON.parse(line.slice(6)) as ScrapeEvent);
      } catch {
        // malformed / truncated SSE line — skip
      }
    };

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `country` is optional: omitting it lets the server detect from geo headers.
        body: JSON.stringify({
          query: q,
          skillLevel,
          deepSearch,
          city,
          remoteOnly,
          ...(country ? { country } : {}),
        }),
        signal: abortRef.current.signal,
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      // Buffer incomplete lines across chunk boundaries — large descriptions can
      // split a single `data: {...}` line across multiple reader.read() calls.
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });

        // Process every complete line (terminated by \n)
        const parts = buf.split("\n");
        // Keep the last part — it may be an incomplete line
        buf = parts.pop() ?? "";

        for (const line of parts) handleLine(line);
      }

      // Flush any remaining buffered content after stream ends
      if (buf) handleLine(buf);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrors((prev) => [...prev, "Scrape failed: " + String(err)]);
      }
    } finally {
      setScraping(false);
    }
  };

  const handleToggleFavourite = async (job: JobResult) => {
    setTogglingId(job.id);
    try {
      const res = await fetch("/api/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `mutation Fav($jobId: ID!) { toggleFavourite(jobId: $jobId) { id favourited } }`,
          variables: { jobId: job.id },
        }),
      });
      const data = await res.json();
      if (data.errors) throw new Error(data.errors[0].message);
      const updated: { id: string; favourited: boolean } = data.data.toggleFavourite;
      setJobs((prev) =>
        prev.map((j) =>
          j.id === updated.id ? { ...j, favourited: updated.favourited } : j,
        ),
      );
    } catch (err) {
      setErrors((prev) => [...prev, `Favourite failed: ${String(err)}`]);
    } finally {
      setTogglingId(null);
    }
  };

  const focusCountry = () => {
    countryBoxRef.current?.querySelector("input")?.focus();
  };

  const filteredJobs = jobs
    .filter((job) => {
      if (filters.source !== "ALL" && job.source !== filters.source) return false;
      if (filters.country && filters.country !== "ALL" && job.country !== filters.country) return false;
      if (filters.remoteOnly && job.workType !== "Remote") return false;
      if (filters.hasSalary && !job.salary) return false;
      if (filters.workType !== "ALL" && job.workType && job.workType !== filters.workType) return false;
      if (filters.city.trim()) {
        const cityQ = filters.city.toLowerCase();
        if (!job.location.toLowerCase().includes(cityQ)) return false;
      }
      if (filters.salaryMin || filters.salaryMax) {
        if (!job.salary) return false;
        const nums = job.salary.match(/[\d\s]+/g)?.map((n) => parseInt(n.replace(/\s/g, ""), 10)).filter((n) => !isNaN(n) && n > 0) ?? [];
        if (nums.length > 0) {
          const mid = nums.reduce((a, b) => a + b, 0) / nums.length;
          if (filters.salaryMin && mid < parseInt(filters.salaryMin, 10)) return false;
          if (filters.salaryMax && mid > parseInt(filters.salaryMax, 10)) return false;
        }
      }
      if (filters.position.trim()) {
        const q = filters.position.toLowerCase();
        if (
          !job.title.toLowerCase().includes(q) &&
          !job.company.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });

  const freshJobs = filteredJobs
    .filter((j) => !j.isStale)
    .sort((a, b) => jobScore(b) - jobScore(a));

  const staleJobs = filteredJobs
    .filter((j) => j.isStale)
    .sort((a, b) => jobScore(b) - jobScore(a));

  const resultCountries = Array.from(
    new Set(jobs.map((j) => j.country).filter((c): c is string => Boolean(c))),
  ).sort();

  const autoDetected = detectedVia != null && AUTO_DETECTED.includes(detectedVia);

  return (
    <Box>
      <GlobalStyles
        styles={{
          "@keyframes jobSlideIn": {
            from: { opacity: 0, transform: "translateY(14px) scale(0.99)" },
            to:   { opacity: 1, transform: "translateY(0) scale(1)" },
          },
        }}
      />

      {/* ── Page header ──────────────────────────────────────────────── */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          Find Jobs
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Pick a role, a country and a skill level — results are ranked by how well the posting matches your words.
        </Typography>
      </Box>

      {/* ── Search card ──────────────────────────────────────────────── */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ pb: "16px !important" }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.5}
            alignItems={{ xs: "stretch", sm: "flex-end" }}
            sx={{ flexWrap: "wrap", gap: 1.5 }}
          >
            <TextField
              label="Job Position"
              placeholder="e.g. Frontend Developer, Data Engineer"
              inputRef={queryInputRef}
              defaultValue=""
              onKeyDown={(e) => e.key === "Enter" && !scraping && handleSearch()}
              variant="outlined"
              size="small"
              sx={{ flexGrow: 1, minWidth: 200 }}
            />
            <TextField
              label="City (optional)"
              placeholder="e.g. Berlin, Praha"
              inputRef={cityInputRef}
              defaultValue=""
              onKeyDown={(e) => e.key === "Enter" && !scraping && handleSearch()}
              variant="outlined"
              size="small"
              sx={{ minWidth: 150, flexShrink: 0 }}
            />
            <Box ref={countryBoxRef} sx={{ minWidth: { xs: "100%", sm: 190 }, flexShrink: 0 }}>
              <CountrySelect
                value={country}
                onChange={(code) => {
                  setCountry(code);
                  setDetectedVia("explicit");
                  setCountryName(
                    countryOptions.find((c) => c.code === code)?.name ?? "",
                  );
                }}
                countries={countryOptions}
                disabled={scraping}
              />
            </Box>
            <FormControl size="small" sx={{ minWidth: 130, flexShrink: 0 }}>
              <InputLabel>Skill Level</InputLabel>
              <Select
                value={skillLevel}
                label="Skill Level"
                onChange={(e) => setSkillLevel(e.target.value)}
              >
                {SKILL_LEVELS.map((l) => (
                  <MenuItem key={l} value={l}>{l}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              startIcon={scraping ? <CircularProgress size={15} color="inherit" /> : <SearchIcon />}
              onClick={handleSearch}
              disabled={scraping}
              sx={{ minWidth: 120, height: 40, flexShrink: 0 }}
            >
              {scraping ? "Searching…" : "Search"}
            </Button>
          </Stack>

          {scraping && <LinearProgress sx={{ mt: 2 }} />}

          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}
          >
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
              <Tooltip title="Scrapes multiple pages per site — slower but finds more results.">
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={deepSearch}
                      onChange={(e) => setDeepSearch(e.target.checked)}
                      disabled={scraping}
                    />
                  }
                  label={
                    <Typography variant="caption" color="text.secondary">
                      Deep Search
                    </Typography>
                  }
                  sx={{ ml: 0, gap: 0.5 }}
                />
              </Tooltip>
              <Tooltip title="Only search boards and postings for remote roles.">
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={remoteOnly}
                      onChange={(e) => setRemoteOnly(e.target.checked)}
                      disabled={scraping}
                    />
                  }
                  label={
                    <Typography variant="caption" color="text.secondary">
                      Remote only
                    </Typography>
                  }
                  sx={{ ml: 0, gap: 0.5 }}
                />
              </Tooltip>
            </Stack>
            {progress && (
              <Typography variant="caption" color="text.secondary">
                {progress === "done-empty" ? "No results" : progress}
              </Typography>
            )}
          </Stack>

          {/* ── Boards for the selected country ────────────────────── */}
          {boards.length > 0 && (
            <Box sx={{ mt: 1.5, pt: 1.5, borderTop: `1px solid ${ios.separator}` }}>
              <Stack
                direction="row"
                alignItems="center"
                sx={{ mb: 1, flexWrap: "wrap", gap: 0.75 }}
              >
                <Typography variant="caption" sx={{ color: ios.label2, fontWeight: 600 }}>
                  {boards.length} {boards.length === 1 ? "board" : "boards"} for{" "}
                  {countryName ? `${flagEmoji(country)} ${countryName}` : countryLabel(country, countryOptions)}
                </Typography>
                {autoDetected && (
                  <Typography variant="caption" sx={{ color: ios.label3 }}>
                    · detected from your connection —{" "}
                    <Link
                      component="button"
                      type="button"
                      onClick={focusCountry}
                      underline="hover"
                      sx={{ color: ios.blue, font: "inherit", verticalAlign: "baseline" }}
                    >
                      change
                    </Link>
                  </Typography>
                )}
              </Stack>
              <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
                {boards.map((b) => (
                  <Tooltip
                    key={b.id}
                    title={b.remoteOnly ? `${b.name} — remote roles only` : b.name}
                  >
                    <Chip
                      size="small"
                      component="a"
                      href={b.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      clickable
                      icon={b.remoteOnly ? <PublicIcon sx={{ fontSize: 14 }} /> : undefined}
                      label={b.name}
                      sx={{
                        height: 24,
                        fontSize: "0.72rem",
                        fontWeight: 500,
                        color: ios.label1,
                        background: alpha(ios.blue, 0.12),
                        border: `1px solid ${alpha(ios.blue, 0.25)}`,
                        "& .MuiChip-icon": { color: ios.teal, ml: 0.75 },
                        "&:hover": { background: alpha(ios.blue, 0.2) },
                      }}
                    />
                  </Tooltip>
                ))}
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>

      <ErrorAlertList
        errors={errors}
        onDismiss={(i) => setErrors((prev) => prev.filter((_, j) => j !== i))}
      />

      {!scraping && jobs.length === 0 && !progress && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Start with a role like <strong>Frontend Developer</strong> or <strong>Data Engineer</strong>, then press Search.
        </Alert>
      )}

      {!scraping && jobs.length === 0 && progress === "done-empty" && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          No jobs found. Try broader keywords, set skill level to <strong>Any</strong>, turn on{" "}
          <strong>Remote only</strong> to reach the worldwide boards, or enable <strong>Deep Search</strong>.
        </Alert>
      )}

      {jobs.length > 0 && (
        <>
          <JobFilterBar
            sources={Array.from(new Set(jobs.map((j) => j.source))).sort()}
            countries={resultCountries}
            countryNames={countryOptions}
            filters={filters}
            onChange={setFilters}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontWeight: 500 }}>
            {filteredJobs.length === jobs.length
              ? `${jobs.length} results`
              : `${filteredJobs.length} of ${jobs.length} results`}
            {staleJobs.length > 0 && (
              <Box component="span" sx={{ color: ios.label3, ml: 1 }}>
                ({freshJobs.length} fresh · {staleJobs.length} cached)
              </Box>
            )}
          </Typography>
        </>
      )}

      {scraping && jobs.length === 0 && (
        <Stack spacing={2} sx={{ mt: 1 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="rectangular" height={160} sx={{ borderRadius: 2 }} />
          ))}
        </Stack>
      )}

      <Stack spacing={1.5}>
        {freshJobs.map((job) => {
          const isNew = newJobIdsRef.current.has(job.id);
          const delay = isNew
            ? Math.min((jobArrivalIndexRef.current.get(job.id) ?? 0) * 50, 800)
            : 0;
          return (
            <Box
              key={job.id}
              sx={isNew ? {
                animation: "jobSlideIn 0.38s cubic-bezier(0.34,1.2,0.64,1) both",
                animationDelay: `${delay}ms`,
              } : undefined}
            >
              <JobCard
                job={job}
                isToggling={togglingId === job.id}
                onToggleFavourite={handleToggleFavourite}
              />
            </Box>
          );
        })}
      </Stack>

      {staleJobs.length > 0 && (
        <>
          <Box sx={{ mt: 3, mb: 1.5, display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box sx={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.08)" }} />
            <Typography variant="caption" sx={{ color: ios.label3, fontWeight: 600, letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
              PREVIOUSLY FOUND ({staleJobs.length})
            </Typography>
            <Box sx={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.08)" }} />
          </Box>
          <Stack spacing={1.5}>
            {staleJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                isToggling={togglingId === job.id}
                onToggleFavourite={handleToggleFavourite}
              />
            ))}
          </Stack>
        </>
      )}
    </Box>
  );
}
