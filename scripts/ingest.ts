/**
 * Job ingestion — the scraper that runs outside a web request.
 *
 * Why this exists: a polite multi-board crawl takes minutes, and a web request
 * has to answer in seconds. Scraping inside the request means either timing
 * out or rushing the crawl hard enough to get rate limited — and no amount of
 * tuning escapes that, on any host.
 *
 * So scraping lives here. This script has no deadline, paces itself per host,
 * and writes into Postgres. The web app then answers searches out of the
 * database, which is instant. Run it from a systemd timer, from cron, from the
 * bundled GitHub Actions schedule, or by hand — see docs/SELF_HOSTING.md.
 *
 * Nothing here needs a browser: boards that render their listings in
 * JavaScript are walked through their sitemaps instead. See
 * src/lib/scrapers/boards/sitemap-board.ts for why that works.
 *
 *   npx tsx scripts/ingest.ts --country CZ
 *   npx tsx scripts/ingest.ts --country DE --boards remotive,arbeitnow --limit 200
 *   npx tsx scripts/ingest.ts --country CZ --full --concurrency 4
 *   npx tsx scripts/ingest.ts --country BR --dry-run
 */
import { allBoards, ingestBoardsForCountry } from "../src/lib/scrapers/registry";
import { classifyQueryIntent } from "../src/lib/matching";
import { getFetchStats, resetFetchStats, setConditionalStore } from "../src/lib/scrapers/fetcher";
import { createMemoryStore } from "../src/lib/scrapers/http/cache";
import { setGlobalConcurrency } from "../src/lib/scrapers/http/limiter";
import { alreadyFresh, lastScrapedAt, persistJobs } from "../src/lib/scrapers/persist";
import type { BoardDefinition, ScrapedJob } from "../src/lib/scrapers/types";

interface Args {
  country: string;
  boardIds: string[];
  /** Ignore the last-run timestamp and walk everything the board offers. */
  full: boolean;
  limitPerBoard: number;
  concurrency: number;
  /** Seed queries for boards that can only be searched, not enumerated. */
  queries: string[];
  dryRun: boolean;
  quiet: boolean;
}

/**
 * Seed queries for API boards, which answer a search but cannot be walked.
 * Broad on purpose: the goal is coverage of the market, not one user's query.
 */
const DEFAULT_QUERIES = [
  "developer",
  "frontend",
  "backend",
  "fullstack",
  "devops",
  "data",
  "mobile",
  "qa",
];

/** Postings re-read inside this window are skipped as already current. */
const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Rows written per transaction. */
const BATCH_SIZE = 25;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    country: process.env.DEFAULT_COUNTRY?.toUpperCase() || "US",
    boardIds: [],
    full: false,
    limitPerBoard: 400,
    concurrency: 4,
    queries: DEFAULT_QUERIES,
    dryRun: false,
    quiet: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i] ?? "";
    switch (argv[i]) {
      case "--country": case "-c": args.country = next().toUpperCase(); break;
      case "--boards": case "-b": args.boardIds.push(...next().split(",").map((s) => s.trim()).filter(Boolean)); break;
      case "--queries": case "-q": args.queries = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--limit": args.limitPerBoard = Math.max(1, Number(next()) || 400); break;
      case "--concurrency": args.concurrency = Math.max(1, Number(next()) || 4); break;
      case "--full": args.full = true; break;
      case "--dry-run": args.dryRun = true; break;
      case "--quiet": args.quiet = true; break;
      case "--help": case "-h": usage(); process.exit(0); break;
      default:
        if (argv[i].startsWith("-")) {
          console.error(`Unknown flag: ${argv[i]}`);
          process.exit(1);
        }
    }
  }
  return args;
}

function usage(): void {
  console.log(`
Usage: npx tsx scripts/ingest.ts [options]

Collects job postings into the database. No deadline, paced per host.

Options:
  -c, --country <ISO>     Country to collect for (default: $DEFAULT_COUNTRY or US)
  -b, --boards <ids>      Comma-separated board ids (default: every board for the country)
  -q, --queries <list>    Seed queries for search-only boards
      --limit <n>         Max postings per board (default 400)
      --concurrency <n>   Requests in flight across all hosts (default 4)
      --full              Ignore the last-run timestamp; walk everything
      --dry-run           Scrape but write nothing
      --quiet             Only print the final summary
  -h, --help              This message

Requires DATABASE_URL. Needs no browser and no API key.
`.trim());
}

interface BoardResult {
  board: BoardDefinition;
  found: number;
  written: number;
  created: number;
  skipped: number;
  ms: number;
  error: string | null;
}

/** Cancels the run cleanly on Ctrl-C so partial work is still committed. */
function installSignalHandler(controller: AbortController): void {
  let interrupted = false;
  const stop = () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.error("\nInterrupted — finishing the current batch, press Ctrl-C again to force quit.");
    controller.abort(new Error("Interrupted"));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

/**
 * Collects one board.
 *
 * Boards that expose bulk enumeration (`ingest`) are walked newest-first from
 * their sitemap. The rest are searched with the seed queries, which is the only
 * thing their APIs support.
 */
async function runBoard(board: BoardDefinition, args: Args, signal: AbortSignal): Promise<BoardResult> {
  const started = Date.now();
  const result: BoardResult = {
    board, found: 0, written: 0, created: 0, skipped: 0, ms: 0, error: null,
  };

  const log = (message: string) => {
    if (!args.quiet) console.error(`  [${board.id}] ${message}`);
  };

  let batch: ScrapedJob[] = [];
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    if (args.dryRun) {
      result.written += batch.length;
      batch = [];
      return;
    }
    const { written, created } = await persistJobs(batch, args.country);
    result.written += written;
    result.created += created;
    batch = [];
  };

  try {
    if (board.ingest) {
      // Incremental by default: only postings the board says changed since the
      // last run. This is what keeps a daily crawl small enough to stay polite.
      const since = args.full ? null : await lastScrapedAt(board.source);
      if (since) log(`incremental since ${since.toISOString()}`);

      for await (const job of board.ingest({
        country: args.country,
        since,
        limit: args.limitPerBoard,
        signal,
        onProgress: log,
      })) {
        result.found++;
        batch.push(job);
        if (batch.length >= BATCH_SIZE) await flush();
        if (signal.aborted) break;
      }
    } else {
      // Search-only board: sweep the seed queries instead of enumerating.
      const seen = new Set<string>();
      for (const query of args.queries) {
        if (signal.aborted) break;
        if (result.found >= args.limitPerBoard) break;

        const jobs = await board.scrape({
          query,
          seniority: null,
          city: "",
          country: args.country,
          deepSearch: true,
          remoteOnly: false,
          intent: classifyQueryIntent(query),
          signal,
        });

        const fresh = jobs.filter((job) => !seen.has(job.sourceUrl));
        for (const job of fresh) seen.add(job.sourceUrl);

        // Skip anything already stored recently — the common case on a re-run,
        // and the cheapest request is the one never made.
        const current = await alreadyFresh(fresh.map((j) => j.sourceUrl), FRESHNESS_WINDOW_MS);
        const due = args.full ? fresh : fresh.filter((job) => !current.has(job.sourceUrl));
        result.skipped += fresh.length - due.length;
        result.found += due.length;

        batch.push(...due);
        if (batch.length >= BATCH_SIZE) await flush();
        log(`"${query}": ${due.length} new of ${jobs.length}`);
      }
    }

    await flush();
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    // Commit whatever was collected before the failure.
    await flush().catch(() => {});
  }

  result.ms = Date.now() - started;
  return result;
}

/** Runs boards with bounded parallelism, in registry order. */
async function runPool(
  boards: BoardDefinition[],
  args: Args,
  signal: AbortSignal,
  workers: number,
): Promise<BoardResult[]> {
  const queue = [...boards];
  const results: BoardResult[] = [];

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      if (signal.aborted) return;
      const board = queue.shift();
      if (!board) return;
      if (!args.quiet) console.error(`→ ${board.name}`);
      results.push(await runBoard(board, args, signal));
    }
  };

  await Promise.all(Array.from({ length: Math.min(workers, boards.length) }, worker));
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL && !args.dryRun) {
    console.error("DATABASE_URL is not set. Set it, or pass --dry-run to scrape without writing.");
    process.exit(1);
  }

  // Board-level parallelism is separate from HTTP concurrency: several boards
  // can be in flight while each individual host is still politely paced.
  setGlobalConcurrency(args.concurrency);
  setConditionalStore(createMemoryStore());
  resetFetchStats();

  const controller = new AbortController();
  installSignalHandler(controller);

  const selected = args.boardIds.length
    ? allBoards().filter((b) => args.boardIds.includes(b.id))
    : ingestBoardsForCountry(args.country);

  if (selected.length === 0) {
    console.error(`No boards matched for ${args.country}. Try: npx tsx scripts/scrape.ts --list --country ${args.country}`);
    process.exit(1);
  }

  const enumerable = selected.filter((b) => b.ingest).length;
  console.error(
    `Ingesting ${args.country} from ${selected.length} board(s) — ` +
    `${enumerable} walkable, ${selected.length - enumerable} search-only. ` +
    `${args.full ? "Full" : "Incremental"} run, ${args.concurrency} concurrent requests.` +
    (args.dryRun ? " DRY RUN — nothing will be written." : "") + "\n",
  );

  const started = Date.now();
  const results = await runPool(selected, args, controller.signal, 3);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.error("\nBoard                found  written  new     skipped  time     status");
  console.error("─".repeat(78));
  for (const r of results.sort((a, b) => b.created - a.created)) {
    const status = r.error ? `ERROR: ${r.error.slice(0, 28)}` : "ok";
    console.error(
      `${r.board.id.padEnd(20)} ${String(r.found).padStart(5)}  ${String(r.written).padStart(7)}  ` +
      `${String(r.created).padStart(6)}  ${String(r.skipped).padStart(7)}  ` +
      `${(r.ms / 1000).toFixed(1).padStart(6)}s  ${status}`,
    );
  }

  const totals = results.reduce(
    (acc, r) => ({
      found: acc.found + r.found,
      created: acc.created + r.created,
      failed: acc.failed + (r.error ? 1 : 0),
    }),
    { found: 0, created: 0, failed: 0 },
  );

  console.error("─".repeat(78));
  const http = getFetchStats();
  console.error(
    `${totals.found} postings collected, ${totals.created} new, ` +
    `${totals.failed} board(s) failed, ${elapsed}s total.`,
  );
  console.error(
    `${http.requests} requests — ${http.failures} failed, ${http.throttled} throttled, ` +
    `${http.notModified} unchanged.`,
  );

  // Boards fail soft, so "found nothing" and "could not reach anything" look
  // identical in the table above. Say which one this was.
  if (totals.found === 0 && http.failures > 0) {
    console.error(
      `\nEvery request failed. Check network access to the boards, or run one ` +
      `board with --boards <id> to see the error.`,
    );
  } else if (http.throttled > http.requests / 4) {
    console.error(
      `\nA quarter of requests were throttled. Lower --concurrency, or run less often.`,
    );
  }

  // A run where every board failed is a failure worth a non-zero exit, so cron
  // and CI notice. Partial success is normal and must not page anyone.
  process.exit(totals.failed === results.length && results.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
