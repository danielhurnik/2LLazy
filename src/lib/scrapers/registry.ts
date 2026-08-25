/**
 * Job-board registry.
 *
 * Every board is a self-contained `BoardDefinition`; this module is the only
 * place that knows the full set. Board selection is driven by the searching
 * user's country: a user in Germany gets the German boards plus every
 * worldwide (remote) board, a user in Czechia gets the Czech ones plus the
 * same worldwide baseline. That baseline is what makes the app useful in a
 * country nobody has written a local board for yet.
 *
 * Adding a board means adding one import and one entry to `BOARDS`.
 */
import type { BoardDefinition, CountryCode } from "./types";
import { WORLDWIDE } from "./types";

import { cocumaBoard } from "./boards/cocuma";
import { startupJobsBoard } from "./boards/startupjobs";
import { jobstackBoard } from "./boards/jobstack";
import { skilletoBoard } from "./boards/skilleto";
import { noFluffJobsBoard } from "./boards/nofluffjobs";
import { jobsCzBoard } from "./boards/jobscz";
import { joobleBoard } from "./boards/jooble";
import { remotiveBoard } from "./boards/remotive";
import { remoteOkBoard } from "./boards/remoteok";
import { arbeitnowBoard } from "./boards/arbeitnow";
import { jobicyBoard } from "./boards/jobicy";
import { himalayasBoard } from "./boards/himalayas";
import { weWorkRemotelyBoard } from "./boards/weworkremotely";
import { adzunaBoard } from "./boards/adzuna";
import { ATS_BOARDS } from "./boards/ats";

/** Every board known to the app, in no particular order. */
const BOARDS: BoardDefinition[] = [
  // Employers' own ATS boards. Highest-quality postings in the app: straight
  // from the company, usually the day the role opens, and no key required.
  ...ATS_BOARDS,
  // Worldwide, API-backed, no key required — the baseline for every country.
  remotiveBoard,
  remoteOkBoard,
  jobicyBoard,
  himalayasBoard,
  weWorkRemotelyBoard,
  // Regional, API-backed.
  arbeitnowBoard,
  adzunaBoard,
  // Country-specific HTML boards.
  cocumaBoard,
  startupJobsBoard,
  jobstackBoard,
  skilletoBoard,
  noFluffJobsBoard,
  jobsCzBoard,
  joobleBoard,
];

export function allBoards(): BoardDefinition[] {
  return [...BOARDS];
}

export function getBoard(id: string): BoardDefinition | null {
  return BOARDS.find((b) => b.id === id) ?? null;
}

/** True when a board serves every country rather than an explicit list. */
export function isWorldwide(board: BoardDefinition): boolean {
  return board.countries.includes(WORLDWIDE);
}

/**
 * Environment variables a board needs but does not have. Empty means the board
 * can run. Checked at selection time so a misconfigured optional integration
 * is skipped quietly instead of failing mid-search.
 */
export function missingEnvFor(board: BoardDefinition): string[] {
  return (board.requiredEnv ?? []).filter((name) => !process.env[name]?.trim());
}

export interface BoardSelectionOptions {
  /** Drop boards that also list non-remote roles. */
  remoteOnly?: boolean;
  /**
   * Only boards that can answer a keyword search inside a web request. The
   * search route sets this; the ingest script does not, because it can walk
   * the rest through their sitemaps with no deadline.
   */
  liveSearchOnly?: boolean;
  /** Drop boards needing a browser when Playwright is not enabled. */
  playwrightEnabled?: boolean;
  /** Restrict to these board ids (used by tests and by a future per-user opt-out). */
  only?: string[];
}

/**
 * Boards that should run for a search in `country`, country-specific first so
 * local results start streaming before the worldwide remote boards catch up.
 */
export function boardsForCountry(
  country: CountryCode,
  opts: BoardSelectionOptions = {},
): BoardDefinition[] {
  const code = country.toUpperCase();
  const playwright = opts.playwrightEnabled ?? process.env.PLAYWRIGHT_ENABLED === "true";

  const selected = BOARDS.filter((board) => {
    if (opts.only && !opts.only.includes(board.id)) return false;
    if (missingEnvFor(board).length > 0) return false;
    if (opts.liveSearchOnly && board.supportsLiveSearch === false) return false;
    if (board.requiresBrowser && !playwright) return false;
    if (opts.remoteOnly && !board.remoteOnly) {
      // A general board can still return remote roles; keep it, the ranker
      // filters. Only drop boards that cannot serve the country at all.
    }
    return isWorldwide(board) || board.countries.includes(code);
  });

  // Local boards first: they carry the postings a user in this country is most
  // likely to be able to actually take.
  return selected.sort((a, b) => {
    const aLocal = isWorldwide(a) ? 1 : 0;
    const bLocal = isWorldwide(b) ? 1 : 0;
    if (aLocal !== bLocal) return aLocal - bLocal;
    return a.name.localeCompare(b.name);
  });
}

export interface BoardStatus {
  id: string;
  name: string;
  homepage: string;
  countries: CountryCode[];
  remoteOnly: boolean;
  requiresBrowser: boolean;
  /** True when this board would run for the given country right now. */
  enabled: boolean;
  /** Why it would not run, in words a user can act on. */
  disabledReason: string | null;
  note?: string;
}

/**
 * Every board and whether it applies to `country`, for the Settings screen.
 * Unlike `boardsForCountry` this returns the disabled ones too, with a reason,
 * so a user can see that (say) Adzuna is one env var away from working.
 */
export function boardStatus(country: CountryCode): BoardStatus[] {
  const code = country.toUpperCase();
  const playwright = process.env.PLAYWRIGHT_ENABLED === "true";

  return BOARDS.map((board): BoardStatus => {
    const missingEnv = missingEnvFor(board);
    const servesCountry = isWorldwide(board) || board.countries.includes(code);

    let disabledReason: string | null = null;
    if (!servesCountry) disabledReason = `Does not cover ${code}`;
    else if (missingEnv.length > 0) disabledReason = `Set ${missingEnv.join(" and ")} to enable`;
    else if (board.requiresBrowser && !playwright) {
      disabledReason = "Needs PLAYWRIGHT_ENABLED=true (renders JavaScript-heavy pages)";
    }

    return {
      id: board.id,
      name: board.name,
      homepage: board.homepage,
      countries: board.countries,
      remoteOnly: board.remoteOnly,
      requiresBrowser: board.requiresBrowser,
      enabled: disabledReason === null,
      disabledReason,
      note: board.note,
    };
  }).sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
}

/**
 * Boards the ingest script should walk for a country.
 *
 * Unlike the live search this ignores `requiresBrowser`: a board whose listing
 * page needs JavaScript is still walkable through its sitemap, which is the
 * whole reason ingestion exists as a separate path.
 */
export function ingestBoardsForCountry(country: CountryCode): BoardDefinition[] {
  const code = country.toUpperCase();
  return BOARDS.filter((board) => {
    if (missingEnvFor(board).length > 0) return false;
    return isWorldwide(board) || board.countries.includes(code);
  }).sort((a, b) => Number(isWorldwide(a)) - Number(isWorldwide(b)) || a.name.localeCompare(b.name));
}

/** Countries with at least one board of their own, for the country picker. */
export function countriesWithLocalBoards(): CountryCode[] {
  const set = new Set<CountryCode>();
  for (const board of BOARDS) {
    if (isWorldwide(board)) continue;
    for (const c of board.countries) set.add(c);
  }
  return [...set].sort();
}
