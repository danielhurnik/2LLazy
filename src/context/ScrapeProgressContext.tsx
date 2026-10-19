"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import { isSseEvent, type SSEEvent } from "@/lib/jobs/events";
import { readSseStream } from "@/lib/readSseStream";
import type { JobItem } from "@/types";
import { errorMessage } from "@/lib/guards";

interface SearchParams {
  query: string;
  skillLevel: string;
  deepSearch: boolean;
  city: string;
  country?: string;
}

export const PROGRESS_DONE_EMPTY = "done-empty";
export const PROGRESS_STOPPED = "Search stopped";

const SCRAPE_ENDPOINT = "/api/scrape";
const HTTP_TOO_MANY_REQUESTS = 429;
const COMPLETE_PERCENT = 100;
const STARTING_MESSAGE = "Starting search…";
const SEARCHING_BOARDS_MESSAGE = "Searching job boards…";
const RATE_LIMITED_MESSAGE = "Too many searches — wait a few seconds and try again.";
const OVERALL_PROGRESS_SITES = new Set(["Search", "Cache"]);

type SourceProgress = { done: number; total: number };
type ProgressEvent = Extract<SSEEvent, { type: "progress" }>;

interface ScrapeProgressState {
  scraping: boolean;
  scrapePercent: number;
  sourceProgress: SourceProgress | null;
  skippedSources: string[];
  progress: string | null;
  setProgress: Dispatch<SetStateAction<string | null>>;
  jobs: JobItem[];
  setJobs: Dispatch<SetStateAction<JobItem[]>>;
  errors: string[];
  setErrors: Dispatch<SetStateAction<string[]>>;
  arrivalIndexRef: MutableRefObject<Map<string, number>>;
  startSearch: (params: SearchParams) => Promise<void>;
  stopSearch: () => void;
}

const noop = () => {};

const ScrapeProgressContext = createContext<ScrapeProgressState>({
  scraping: false,
  scrapePercent: 0,
  sourceProgress: null,
  skippedSources: [],
  progress: null,
  setProgress: noop,
  jobs: [],
  setJobs: noop,
  errors: [],
  setErrors: noop,
  arrivalIndexRef: { current: new Map() },
  startSearch: async () => {},
  stopSearch: noop,
});

function collapseParallelScraperProgress({ site, message }: ProgressEvent): string {
  return OVERALL_PROGRESS_SITES.has(site) ? message : SEARCHING_BOARDS_MESSAGE;
}

function percentOf(done: number, total: number): number {
  return Math.round((done / total) * COMPLETE_PERCENT);
}

function appendUnique<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items : [...items, item];
}

function isAbortError(err: unknown): boolean {
  return (err instanceof Error || err instanceof DOMException) && err.name === "AbortError";
}

function withArrivedJob(jobs: JobItem[], job: JobItem): JobItem[] {
  const index = jobs.findIndex((existing) => existing.id === job.id);
  if (index === -1) return [...jobs, job];
  const isLiveConfirmationOfCachedJob = jobs[index].isStale && !job.isStale;
  if (!isLiveConfirmationOfCachedJob) return jobs;
  const updated = jobs.slice();
  updated[index] = job;
  return updated;
}

async function openSearchStream(
  { query, skillLevel, deepSearch, city, country }: SearchParams,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(SCRAPE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, skillLevel, deepSearch, city, country }),
    signal,
  });
  if (res.ok && res.body) return res.body;
  throw new Error(res.status === HTTP_TOO_MANY_REQUESTS ? RATE_LIMITED_MESSAGE : `HTTP ${res.status}`);
}

export function ScrapeProgressProvider({ children }: { children: ReactNode }) {
  const [scraping, setScraping] = useState(false);
  const [scrapePercent, setScrapePercent] = useState(0);
  const [sourceProgress, setSourceProgress] = useState<SourceProgress | null>(null);
  const [skippedSources, setSkippedSources] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const arrivalIndexRef = useRef<Map<string, number>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const scrapingRef = useRef(false);

  const startSearch = useCallback(async (params: SearchParams) => {
    if (scrapingRef.current || !params.query) return;
    scrapingRef.current = true;

    setJobs([]);
    setErrors([]);
    arrivalIndexRef.current = new Map();
    setScraping(true);
    setScrapePercent(0);
    setSourceProgress(null);
    setSkippedSources([]);
    setProgress(STARTING_MESSAGE);

    const controller = new AbortController();
    abortRef.current = controller;

    const addJob = (job: JobItem) => {
      const arrivalIndex = arrivalIndexRef.current;
      if (!arrivalIndex.has(job.id)) arrivalIndex.set(job.id, arrivalIndex.size);
      setJobs((prev) => withArrivedJob(prev, job));
    };

    const handleEvent = (event: SSEEvent) => {
      switch (event.type) {
        case "progress":
          setProgress(collapseParallelScraperProgress(event));
          break;
        case "sourceSkipped":
          setSkippedSources((prev) => appendUnique(prev, event.message));
          break;
        case "scraperDone":
          setSourceProgress({ done: event.doneCount, total: event.total });
          setScrapePercent(percentOf(event.doneCount, event.total));
          break;
        case "job":
          addJob(event.data);
          break;
        case "complete":
          setScrapePercent(COMPLETE_PERCENT);
          setProgress(arrivalIndexRef.current.size === 0 ? PROGRESS_DONE_EMPTY : null);
          break;
        case "error":
          setErrors((prev) => [...prev, `${event.site}: ${event.message}`]);
          break;
      }
    };

    try {
      const stream = await openSearchStream(params, controller.signal);
      await readSseStream(stream, (data) => {
        if (isSseEvent(data)) handleEvent(data);
      });
    } catch (err) {
      if (isAbortError(err)) {
        setProgress(PROGRESS_STOPPED);
      } else {
        setErrors((prev) => [...prev, `Search failed: ${errorMessage(err)}`]);
        setProgress(null);
      }
    } finally {
      scrapingRef.current = false;
      abortRef.current = null;
      setScraping(false);
    }
  }, []);

  const stopSearch = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <ScrapeProgressContext.Provider
      value={{
        scraping,
        scrapePercent,
        sourceProgress,
        skippedSources,
        progress,
        setProgress,
        jobs,
        setJobs,
        errors,
        setErrors,
        arrivalIndexRef,
        startSearch,
        stopSearch,
      }}
    >
      {children}
    </ScrapeProgressContext.Provider>
  );
}

export function useScrapeProgress() {
  return useContext(ScrapeProgressContext);
}
