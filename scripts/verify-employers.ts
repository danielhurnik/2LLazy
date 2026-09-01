/**
 * Checks which employer slugs in the ATS registry actually resolve.
 *
 * The registry in `src/lib/scrapers/boards/ats/employers.ts` is hand-written,
 * and a company can migrate ATS or rename its board at any time. A wrong slug
 * costs nothing at runtime — the adapter 404s and moves on — but it is dead
 * weight, and this is how you find it.
 *
 * Run it after adding employers, and before sending a pull request:
 *
 *   npx tsx scripts/verify-employers.ts
 *   npx tsx scripts/verify-employers.ts --ats greenhouse
 *   npx tsx scripts/verify-employers.ts --country CZ --verbose
 *   npx tsx scripts/verify-employers.ts --prune      # print the list without the dead ones
 *
 * Needs no database and no API key — only network access to the ATS vendors.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { adapterFor, ATS_ADAPTERS } from "../src/lib/scrapers/boards/ats/adapters";
import { EMPLOYERS, employersForCountry } from "../src/lib/scrapers/boards/ats/employers";
import { setGlobalConcurrency } from "../src/lib/scrapers/http/limiter";
import type { Employer } from "../src/lib/scrapers/boards/ats/types";

interface Args {
  ats: string | null;
  country: string | null;
  verbose: boolean;
  prune: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { ats: null, country: null, verbose: false, prune: false, concurrency: 4 };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i] ?? "";
    switch (argv[i]) {
      case "--ats": case "-a": args.ats = next().toLowerCase(); break;
      case "--country": case "-c": args.country = next().toUpperCase(); break;
      case "--concurrency": args.concurrency = Math.max(1, Number(next()) || 4); break;
      case "--verbose": case "-v": args.verbose = true; break;
      case "--prune": args.prune = true; break;
      case "--help": case "-h":
        console.log(`
Usage: npx tsx scripts/verify-employers.ts [options]

Checks every employer slug in the ATS registry against its vendor's public API.

Options:
  -a, --ats <platform>   Only this ATS (${ATS_ADAPTERS.map((a) => a.platform).join(", ")})
  -c, --country <ISO>    Only employers hiring in this country
      --concurrency <n>  Requests in flight (default 4)
  -v, --verbose          Print the failure reason for each dead slug
      --prune            Print the registry entries that resolved, ready to paste back
  -h, --help             This message
`.trim());
        process.exit(0);
        break;
      default:
        if (argv[i].startsWith("-")) {
          console.error(`Unknown flag: ${argv[i]}`);
          process.exit(1);
        }
    }
  }
  return args;
}

interface Check {
  employer: Employer;
  ok: boolean;
  count: number;
  reason: string;
  ms: number;
}

/**
 * Routes each check's console.warn output to that check alone.
 *
 * Checks run concurrently, so console.warn is patched exactly once and each
 * warning lands in the capture list of whichever async context emitted it.
 * (Patching per check would corrupt the restore chain: worker B saves worker
 * A's capture function as "the original" and restores it after A has finished.)
 */
const warnCapture = new AsyncLocalStorage<string[]>();
const originalWarn = console.warn;
console.warn = (...parts: unknown[]) => {
  const captured = warnCapture.getStore();
  if (captured) captured.push(parts.map(String).join(" "));
  else originalWarn(...parts);
};

async function check(employer: Employer): Promise<Check> {
  const started = Date.now();
  const adapter = adapterFor(employer.ats);
  if (!adapter) {
    return { employer, ok: false, count: 0, reason: `unknown ATS "${employer.ats}"`, ms: 0 };
  }

  // The adapters swallow their own errors and return [], so an empty result is
  // the signal here. That conflates "board closed" with "no open roles", which
  // is why the summary says "no postings" rather than "broken".
  const captured: string[] = [];
  const postings = await warnCapture.run(captured, () => adapter.fetchPostings(employer));
  return {
    employer,
    ok: postings.length > 0,
    count: postings.length,
    reason: postings.length > 0 ? "" : captured[0] ?? "no postings returned",
    ms: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  setGlobalConcurrency(args.concurrency);

  let employers = args.country ? employersForCountry(args.country) : EMPLOYERS;
  if (args.ats) employers = employers.filter((employer) => employer.ats === args.ats);

  if (employers.length === 0) {
    console.error("No employers matched those filters.");
    process.exit(1);
  }

  console.error(`Checking ${employers.length} employer board(s)…\n`);

  const results: Check[] = [];
  const queue = [...employers];
  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      const employer = queue.shift();
      if (!employer) return;
      const result = await check(employer);
      results.push(result);
      const mark = result.ok ? "✔" : "✖";
      const detail = result.ok
        ? `${result.count} postings`
        : args.verbose
          ? result.reason.slice(0, 60)
          : "no postings";
      console.error(
        `  ${mark} ${employer.ats.padEnd(15)} ${employer.slug.padEnd(20)} ${detail}`,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, employers.length) }, worker));

  const live = results.filter((r) => r.ok);
  const dead = results.filter((r) => !r.ok);

  console.error(`\n${live.length} resolved, ${dead.length} returned nothing.`);
  console.error(`${live.reduce((sum, r) => sum + r.count, 0)} postings reachable in total.`);

  if (dead.length > 0 && !args.prune) {
    console.error(`\nNot resolving: ${dead.map((r) => `${r.employer.ats}/${r.employer.slug}`).join(", ")}`);
    console.error("Re-run with --verbose for reasons, or --prune to print the surviving entries.");
  }

  if (args.prune) {
    console.log("\n// Entries that resolved — paste into employers.ts");
    for (const { employer } of live.sort((a, b) => a.employer.ats.localeCompare(b.employer.ats))) {
      const countries = employer.countries.map((c) => `"${c}"`).join(", ");
      const remote = employer.remote ? ", remote: true" : "";
      console.log(
        `  { slug: "${employer.slug}", name: "${employer.name}", ats: "${employer.ats}", ` +
        `countries: [${countries}]${remote} },`,
      );
    }
  }

  // A run where nothing resolved usually means no network, not 50 dead boards.
  process.exit(live.length === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
