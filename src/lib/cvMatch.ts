/**
 * CV ↔ job match report.
 *
 * Replaces the endpoint that asked GPT-4o to rewrite the user's CV for each
 * posting. Rewriting somebody's CV is exactly the kind of thing a model does
 * confidently and wrongly — it invents experience, and the user ships it
 * without noticing. This does the honest half of the same job: it says which
 * of the posting's requirements the CV already evidences and which it does
 * not, and leaves the writing to the person whose career it is.
 *
 * Everything here is literal keyword matching, so every claim in the report
 * points at a line the user can go and read.
 */
import { extractKeywords, containsKeyword, type KeywordHit } from "./coverLetter";

export interface CvMatchReport {
  /** 0–100: share of the posting's keywords evidenced somewhere in the CV. */
  coverage: number;
  /** Keywords found in both, with the CV line that carries each one. */
  matched: Array<{ keyword: string; cvContext: string }>;
  /** Keywords the posting asks for that the CV never mentions. */
  missing: string[];
  /** Mechanical, checkable observations — never invented advice. */
  suggestions: string[];
}

/** Keywords repeated at least this often in a posting are treated as core requirements. */
const EMPHASIS_THRESHOLD = 3;
/** Report at most this many gaps; a wall of 40 missing keywords helps nobody. */
const MAX_MISSING = 15;
/** Trim the quoted CV line to something that reads in a list. */
const MAX_CONTEXT = 160;

/** Splits a CV into the lines a match can be quoted from. */
function cvLines(cvText: string): string[] {
  return cvText
    .split(/\r?\n|(?<=[.;])\s{2,}/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 2);
}

/** The CV line that best evidences a keyword — the shortest one containing it. */
function findContext(lines: string[], keyword: string): string {
  let best = "";
  for (const line of lines) {
    if (!containsKeyword(line, keyword)) continue;
    if (!best || line.length < best.length) best = line;
  }
  if (!best) return "";
  return best.length > MAX_CONTEXT ? `${best.slice(0, MAX_CONTEXT - 1)}…` : best;
}

/** How often a keyword appears in the posting — a proxy for how much it matters. */
function emphasisOf(hits: KeywordHit[], keyword: string): number {
  return hits.find((h) => h.label === keyword)?.count ?? 0;
}

export function buildCvMatchReport(
  cvText: string,
  job: { title: string; company: string; description: string },
): CvMatchReport {
  const jobKeywords = extractKeywords(`${job.title}\n${job.description ?? ""}`);
  const lines = cvLines(cvText ?? "");

  const matched: CvMatchReport["matched"] = [];
  const missing: string[] = [];

  for (const hit of jobKeywords) {
    const context = findContext(lines, hit.label);
    if (context) matched.push({ keyword: hit.label, cvContext: context });
    else missing.push(hit.label);
  }

  // An empty CV or a posting with no recognisable keywords both give 0/0;
  // reporting 0% coverage there is more honest than reporting 100%.
  const total = jobKeywords.length;
  const coverage = total === 0 ? 0 : Math.round((matched.length / total) * 100);

  return {
    coverage,
    matched,
    missing: missing.slice(0, MAX_MISSING),
    suggestions: buildSuggestions({ cvText: cvText ?? "", jobKeywords, matched, missing, coverage, total }),
  };
}

function buildSuggestions(input: {
  cvText: string;
  jobKeywords: KeywordHit[];
  matched: CvMatchReport["matched"];
  missing: string[];
  coverage: number;
  total: number;
}): string[] {
  const { cvText, jobKeywords, matched, missing, coverage, total } = input;
  const suggestions: string[] = [];

  if (!cvText.trim()) {
    return ["No CV text could be read. Upload a CV in Settings to get a match report."];
  }
  if (total === 0) {
    return [
      "This posting does not name any technologies the report recognises, so there is nothing concrete to match against. Read it manually.",
    ];
  }

  // Emphasised-but-absent keywords are the ones actually worth acting on.
  const emphasised = missing
    .map((keyword) => ({ keyword, count: emphasisOf(jobKeywords, keyword) }))
    .filter((entry) => entry.count >= EMPHASIS_THRESHOLD)
    .sort((a, b) => b.count - a.count);

  for (const { keyword, count } of emphasised.slice(0, 5)) {
    suggestions.push(
      `The posting mentions ${keyword} ${count} times and your CV never does. If you have used it, say so explicitly.`,
    );
  }

  const quietMisses = missing.filter((k) => emphasisOf(jobKeywords, k) < EMPHASIS_THRESHOLD);
  if (quietMisses.length > 0) {
    suggestions.push(
      `Mentioned once or twice and absent from your CV: ${quietMisses.slice(0, 8).join(", ")}.`,
    );
  }

  if (coverage >= 70) {
    suggestions.push(
      `You already evidence ${coverage}% of what this posting asks for — lead with the strongest of those in your first paragraph.`,
    );
  } else if (coverage < 35) {
    suggestions.push(
      `Only ${coverage}% of the posting's requirements appear in your CV. Worth checking whether this role is aimed at a different profile before spending time on it.`,
    );
  }

  // Numbers are the single most common thing missing from a developer CV.
  if (!/\d+\s*(%|percent|x\b)|\b\d{2,}\b/.test(cvText)) {
    suggestions.push(
      "Your CV contains no figures. Concrete numbers (users served, latency cut, team size) are the cheapest credibility you can add.",
    );
  }

  if (matched.length > 0 && suggestions.length === 0) {
    suggestions.push("Nothing obvious to fix — your CV lines up with what this posting asks for.");
  }

  return suggestions;
}

/** Renders the report as Markdown for the streaming dialog. */
export function renderCvMatchMarkdown(
  report: CvMatchReport,
  job: { title: string; company: string },
): string {
  const bar = coverageBar(report.coverage);
  const out: string[] = [
    `# CV match report`,
    ``,
    `**${job.title}** at **${job.company || "this company"}**`,
    ``,
    `## Coverage: ${report.coverage}%`,
    ``,
    `${bar}`,
    ``,
    `${report.matched.length} of ${report.matched.length + report.missing.length} keywords from this posting appear in your CV.`,
    ``,
  ];

  if (report.matched.length > 0) {
    out.push(`## What your CV already evidences`, ``);
    for (const { keyword, cvContext } of report.matched) {
      out.push(`- **${keyword}** — _"${cvContext}"_`);
    }
    out.push(``);
  }

  if (report.missing.length > 0) {
    out.push(
      `## Not found in your CV`,
      ``,
      report.missing.map((k) => `\`${k}\``).join(" · "),
      ``,
      `These are keywords from the posting only. Do not add anything you have not actually done.`,
      ``,
    );
  }

  if (report.suggestions.length > 0) {
    out.push(`## Notes`, ``);
    for (const suggestion of report.suggestions) out.push(`- ${suggestion}`);
    out.push(``);
  }

  out.push(
    `---`,
    ``,
    `_This report is literal keyword matching against the posting text — nothing was written or inferred for you._`,
  );

  return out.join("\n");
}

function coverageBar(coverage: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, coverage)) / 100) * 20);
  return `\`${"█".repeat(filled)}${"░".repeat(20 - filled)}\``;
}
