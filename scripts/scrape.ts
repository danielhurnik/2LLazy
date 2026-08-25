/**
 * Board smoke-test CLI.
 *
 * Runs one or more job boards straight from the terminal, without a database,
 * a browser session, or the Next.js server. Contributors adding a board need a
 * fast way to see what it actually returns — and when a board silently breaks
 * because a site changed its markup, this is how you find out which one.
 *
 *   npx tsx scripts/scrape.ts react --country DE
 *   npx tsx scripts/scrape.ts "node.js" --country CZ --board jobscz --deep
 *   npx tsx scripts/scrape.ts react --list
 *
 * Nothing here talks to a model or needs an API key.
 */
import { classifyQueryIntent, scoreJob, buildCorpusStats, RELEVANCE_THRESHOLD } from "../src/lib/matching";
import { allBoards, boardsForCountry, boardStatus } from "../src/lib/scrapers/registry";
import { detectCountry } from "../src/lib/geo";
import type { BoardDefinition, ScrapedJob, Seniority } from "../src/lib/scrapers/types";

interface Args {
  query: string;
  country: string;
  city: string;
  seniority: Seniority | null;
  boardIds: string[];
  deep: boolean;
  remoteOnly: boolean;
  list: boolean;
  json: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const args: Args = {
    query: "",
    country: "",
    city: "",
    seniority: null,
    boardIds: [],
    deep: false,
    remoteOnly: false,
    list: false,
    json: false,
    limit: 20,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    switch (arg) {
      case "--country": case "-c": args.country = next().toUpperCase(); break;
      case "--city": args.city = next(); break;
      case "--seniority": case "-s": args.seniority = next() as Seniority; break;
      case "--board": case "-b": args.boardIds.push(...next().split(",").map((s) => s.trim())); break;
      case "--deep": args.deep = true; break;
      case "--remote": args.remoteOnly = true; break;
      case "--list": case "-l": args.list = true; break;
      case "--json": args.json = true; break;
      case "--limit": args.limit = Number(next()) || 20; break;
      case "--help": case "-h": usage(); process.exit(0); break;
      default:
        if (arg.startsWith("-")) { console.error(`Unknown flag: ${arg}`); process.exit(1); }
        positional.push(arg);
    }
  }

  args.query = positional.join(" ").trim();
  return args;
}

function usage(): void {
  console.log(`
Usage: npx tsx scripts/scrape.ts <query> [options]

Options:
  -c, --country <ISO>   Country to search, e.g. DE. Detected from DEFAULT_COUNTRY when omitted.
      --city <name>     City filter, where the board supports one.
  -s, --seniority <l>   Junior | Mid | Senior | Lead
  -b, --board <ids>     Comma-separated board ids. Defaults to every board for the country.
      --deep            Fetch more pages per board.
      --remote          Remote roles only.
      --limit <n>       Rows to print (default 20).
      --json            Print raw JSON instead of a table.
  -l, --list            List boards for the country and exit.
  -h, --help            This message.
`.trim());
}

function truncate(s: string, n: number): string {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

async function runBoard(
  board: BoardDefinition,
  query: Parameters<BoardDefinition["scrape"]>[0],
): Promise<{ board: BoardDefinition; jobs: ScrapedJob[]; ms: number; error: string | null }> {
  const started = Date.now();
  try {
    const jobs = await board.scrape(query);
    return { board, jobs, ms: Date.now() - started, error: null };
  } catch (err) {
    return {
      board,
      jobs: [],
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const country = args.country || detectCountry({}).country;

  if (args.list) {
    console.log(`Boards for ${country}:\n`);
    for (const b of boardStatus(country)) {
      const mark = b.enabled ? "✔" : "✖";
      const tags = [
        b.remoteOnly ? "remote-only" : null,
        b.requiresBrowser ? "browser-for-search" : null,
        b.ingestable ? "ingestable" : null,
      ].filter(Boolean).join(", ");
      console.log(
        `  ${mark} ${b.id.padEnd(21)} ${b.name.padEnd(23)} ${tags ? `[${tags}] ` : ""}` +
        `${b.disabledReason ?? ""}`,
      );
    }
    console.log(`\n${allBoards().length} boards registered in total.`);
    return;
  }

  if (!args.query) { usage(); process.exit(1); }

  const intent = classifyQueryIntent(args.query, args.seniority ?? "");
  const selected = args.boardIds.length
    ? allBoards().filter((b) => args.boardIds.includes(b.id))
    : boardsForCountry(country, { remoteOnly: args.remoteOnly });

  if (selected.length === 0) {
    console.error(`No boards matched. Try --list to see what is available for ${country}.`);
    process.exit(1);
  }

  const scrapeQuery = {
    query: args.query,
    seniority: args.seniority,
    city: args.city,
    country,
    deepSearch: args.deep,
    remoteOnly: args.remoteOnly,
    intent,
  };

  console.error(
    `Searching "${args.query}" in ${country} across ${selected.length} board(s): ` +
    `${selected.map((b) => b.id).join(", ")}\n`,
  );

  const results = await Promise.all(selected.map((b) => runBoard(b, scrapeQuery)));
  const jobs = results.flatMap((r) => r.jobs);
  const stats = buildCorpusStats(jobs.map((j) => `${j.title} ${j.description}`));

  const ranked = jobs
    .map((job) => ({ job, result: scoreJob(job, intent, { ...stats, country, city: args.city }) }))
    .sort((a, b) => b.result.score - a.result.score);

  if (args.json) {
    console.log(JSON.stringify(
      ranked.map(({ job, result }) => ({ ...job, score: result.score, matched: result.matched })),
      null,
      2,
    ));
    return;
  }

  console.error("Per-board results:");
  for (const r of results) {
    const status = r.error ? `ERROR: ${truncate(r.error, 60)}` : `${r.jobs.length} jobs`;
    console.error(`  ${r.board.id.padEnd(16)} ${String(r.ms).padStart(6)}ms  ${status}`);
  }

  const above = ranked.filter((r) => r.result.score >= RELEVANCE_THRESHOLD);
  console.error(
    `\n${jobs.length} scraped, ${above.length} above the relevance threshold ` +
    `(${RELEVANCE_THRESHOLD}). Showing ${Math.min(args.limit, ranked.length)}:\n`,
  );

  for (const { job, result } of ranked.slice(0, args.limit)) {
    const pct = `${Math.round(result.score * 100)}%`.padStart(4);
    const flag = result.score >= RELEVANCE_THRESHOLD ? " " : "·";
    console.log(`${flag}${pct}  ${truncate(job.title, 46).padEnd(46)}  ${truncate(job.company, 22).padEnd(22)}  ${job.source}`);
    console.log(`       ${truncate(job.location, 28).padEnd(28)}  ${job.salary ?? "—"}`);
    if (result.matched.length) console.log(`       matched: ${result.matched.slice(0, 8).join(", ")}`);
    console.log(`       ${job.sourceUrl}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
