/**
 * Deterministic salary extraction from free text.
 *
 * Boards write pay in a hundred dialects ("60 000 - 90 000 Kč", "$120k–$160k",
 * "PLN 15 000 — 22 000 brutto"), and job pages are full of numbers that are not
 * pay at all: years, phone numbers, head-counts, postcodes. The parser is
 * therefore deliberately conservative — a match must carry a currency, a `k`
 * multiplier or a period word, and must survive a magnitude sanity check.
 */

export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  unit: "hour" | "day" | "week" | "month" | "year" | null;
  text: string;
}

type Unit = NonNullable<ParsedSalary["unit"]>;

/** Symbol / code → ISO 4217 code. Order matters: longest tokens first. */
const CURRENCIES: Array<[string, string]> = [
  ["CZK", "CZK"], ["EUR", "EUR"], ["USD", "USD"], ["GBP", "GBP"], ["PLN", "PLN"],
  ["CHF", "CHF"], ["SEK", "SEK"], ["NOK", "NOK"], ["DKK", "DKK"], ["HUF", "HUF"],
  ["RON", "RON"], ["BGN", "BGN"], ["UAH", "UAH"], ["RUB", "RUB"], ["CAD", "CAD"],
  ["AUD", "AUD"], ["NZD", "NZD"], ["SGD", "SGD"], ["INR", "INR"], ["JPY", "JPY"],
  ["TRY", "TRY"], ["BRL", "BRL"], ["MXN", "MXN"], ["ZAR", "ZAR"],
  ["Kč", "CZK"], ["kc", "CZK"], ["zł", "PLN"], ["zl", "PLN"], ["Ft", "HUF"],
  ["R$", "BRL"], ["€", "EUR"], ["$", "USD"], ["£", "GBP"], ["₹", "INR"],
  ["¥", "JPY"], ["₺", "TRY"], ["₴", "UAH"], ["₽", "RUB"],
];

/** Regex-safe currency alternation, longest first so "CZK" beats "C". */
const CUR_SRC = CURRENCIES.map(([token]) => token.replace(/[$.*+?^{}()|[\]\\]/g, "\\$&"))
  .sort((a, b) => b.length - a.length)
  .join("|");

/** A number with optional 3-digit grouping (space, dot, comma or apostrophe). */
const NUM_SRC = String.raw`\d{1,3}(?:[ \u00a0.,'’]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;

/** `k`/`m` multiplier, only when not glued to another word ("Kč" is a currency). */
const MULT_SRC = String.raw`(?:([kKmM])(?![\p{L}]))?`;

const SEP_SRC = String.raw`(?:[-–—―~]|\bto\b|\bau\b|\baž\b|\bdo\b|\bbis\b|\bhasta\b)`;

const RANGE_RE = new RegExp(
  `(${CUR_SRC})?\\s*(${NUM_SRC})\\s*${MULT_SRC}\\s*(${CUR_SRC})?\\s*${SEP_SRC}\\s*` +
    `(${CUR_SRC})?\\s*(${NUM_SRC})\\s*${MULT_SRC}\\s*(${CUR_SRC})?`,
  "giu",
);

const SINGLE_RE = new RegExp(
  `(${CUR_SRC})?\\s*(${NUM_SRC})\\s*${MULT_SRC}\\s*(${CUR_SRC})?`,
  "giu",
);

/**
 * Word-boundary matcher that also works for accented words: JavaScript's `\b`
 * is ASCII-only, so `/\bmesic\b/` would never match "měsíčně".
 */
function wordRe(body: string): RegExp {
  return new RegExp(`(?<![\\p{L}])(?:${body})(?![\\p{L}])`, "iu");
}

/** Period words in the languages the boards we scrape actually publish in. */
const UNIT_PATTERNS: Array<[Unit, RegExp]> = [
  [
    "hour",
    wordRe(
      "per\\s+hour|an?\\s+hour|hourly|\\/\\s*(?:h|hr|hour)|p\\/h|za\\s+hodinu|hodinu|hodin[ay]?|" +
        "godzin[ęya]?|pro\\s+stunde|\\/\\s*std|stunde|par\\s+heure|por\\s+hora|hora|per\\s+uur",
    ),
  ],
  [
    "day",
    wordRe(
      "per\\s+day|a\\s+day|daily|\\/\\s*(?:d|day)|man[-\\s]?day|md|denně|za\\s+den|dziennie|" +
        "pro\\s+tag|par\\s+jour|por\\s+día|per\\s+dag",
    ),
  ],
  [
    "week",
    wordRe(
      "per\\s+week|a\\s+week|weekly|\\/\\s*(?:w|wk|week)|týdně|tydne|tygodniowo|" +
        "pro\\s+woche|par\\s+semaine|semanal",
    ),
  ],
  [
    "month",
    wordRe(
      "per\\s+month|a\\s+month|monthly|\\/\\s*(?:mo|mth|month)|p\\/m|měsíčně|mesicne|za\\s+měsíc|" +
        "měsíc|mesic|miesięcznie|miesiac|monatlich|\\/\\s*monat|pro\\s+monat|monat|" +
        "par\\s+mois|mensual|al\\s+mes|per\\s+maand",
    ),
  ],
  [
    "year",
    wordRe(
      "per\\s+year|a\\s+year|yearly|annually|annual|per\\s+annum|p\\.?\\s?a\\.?|\\/\\s*(?:y|yr|year)|" +
        "ročně|rocne|za\\s+rok|\\/\\s*rok|rocznie|jährlich|jahrlich|pro\\s+jahr|\\/\\s*jahr|" +
        "par\\s+an|anual|al\\s+año|per\\s+jaar",
    ),
  ],
];

/** Gross/net qualifiers worth keeping in the display string. */
const QUALIFIER_RE = wordRe("brutto|netto|gross|net|hrubého|hrubá");

/** "from 50 000" / "od 50 000" — a lower bound with no upper bound. */
const FROM_RE = /(?:\bfrom\b|\bstarting\s+at\b|\bod\b|\bab\b|\bdesde\b|\bvanaf\b|\bmin\.?\b|\bminimum\b|\bmindestens\b)\s*$/iu;
/** "up to 90k" / "do 90 000" — an upper bound with no lower bound. */
const UPTO_RE = /(?:\bup\s+to\b|\bmax\.?\b|\bmaximum\b|\bdo\b|\bbis\s+zu\b|\bbis\b|\bhasta\b|\btot\b)\s*$/iu;

/** Plausible pay per period, in any currency. Outside this it is not a salary. */
const BOUNDS: Record<Unit | "none", [number, number]> = {
  hour: [1, 100_000],
  day: [10, 1_000_000],
  week: [50, 2_000_000],
  month: [100, 2_000_000],
  year: [1_000, 30_000_000],
  none: [1, 30_000_000],
};

/** Turns "60 000", "55,000", "60.000" and "25.5" into a number. */
function toNumber(raw: string): number | null {
  const compact = raw.replace(/[\s '’]/g, "");
  const lastSep = Math.max(compact.lastIndexOf("."), compact.lastIndexOf(","));
  let normalized: string;
  if (lastSep === -1) {
    normalized = compact;
  } else {
    const tail = compact.slice(lastSep + 1);
    normalized =
      tail.length === 3
        ? compact.replace(/[.,]/g, "") // grouping separator, e.g. 60.000
        : compact.slice(0, lastSep).replace(/[.,]/g, "") + "." + tail;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function multiplier(flag: string | undefined): number {
  if (!flag) return 1;
  return flag.toLowerCase() === "m" ? 1_000_000 : 1_000;
}

function currencyOf(token: string | undefined): string | null {
  if (!token) return null;
  const needle = token.trim().toLowerCase();
  const hit = CURRENCIES.find(([symbol]) => symbol.toLowerCase() === needle);
  return hit ? hit[1] : null;
}

/** Looks for a period word right after the amount, then just before it. */
function detectUnit(after: string, before: string): { unit: Unit | null; span: number } {
  for (const [unit, re] of UNIT_PATTERNS) {
    const m = after.match(re);
    // Only trust a trailing period word that sits next to the amount.
    if (m && m.index !== undefined && m.index <= 12) {
      return { unit, span: m.index + m[0].length };
    }
  }
  for (const [unit, re] of UNIT_PATTERNS) {
    if (re.test(before)) return { unit, span: 0 };
  }
  return { unit: null, span: 0 };
}

function withinBounds(value: number, unit: Unit | null): boolean {
  const [lo, hi] = BOUNDS[unit ?? "none"];
  return value >= lo && value <= hi;
}

/** Four-digit values in a plausible calendar range, e.g. "2024 - 2025". */
function looksLikeYears(a: number, b: number | null): boolean {
  const isYear = (n: number) => Number.isInteger(n) && n >= 1900 && n <= 2100;
  return isYear(a) && (b === null || isYear(b));
}

interface Candidate {
  min: number | null;
  max: number | null;
  currency: string | null;
  unit: Unit | null;
  text: string;
}

/** Builds a candidate from one regex hit, or null when it fails the guards. */
function evaluate(
  hay: string,
  start: number,
  end: number,
  minRaw: number | null,
  maxRaw: number | null,
  currency: string | null,
  hasMultiplier: boolean,
  currencyHint: string | null,
): Candidate | null {
  const before = hay.slice(Math.max(0, start - 40), start);
  const after = hay.slice(end, end + 45);

  // Percentages and phone numbers are the two loudest false positives.
  if (/^\s*%/.test(after)) return null;
  if (/[+#]\s*$/.test(before)) return null;
  if (/\b(?:tel|phone|mobil|fax|call|whatsapp|ič[oa]?|dič|vat|iban)\b[^.]{0,12}$/iu.test(before)) return null;

  const { unit, span } = detectUnit(after, before);
  const resolvedCurrency = currency ?? currencyHint ?? null;

  // Without a currency, a multiplier or a period word, a number is just a number.
  if (!currency && !hasMultiplier && !unit) return null;
  if (!currency && looksLikeYears(minRaw ?? 0, maxRaw)) return null;

  const values = [minRaw, maxRaw].filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  if (minRaw !== null && maxRaw !== null && minRaw > maxRaw) return null;
  if (!values.every((v) => withinBounds(v, unit))) return null;

  let textEnd = end + span;
  const qualifier = hay.slice(textEnd, textEnd + 25).match(QUALIFIER_RE);
  if (qualifier && qualifier.index !== undefined && qualifier.index <= 3) {
    textEnd += qualifier.index + qualifier[0].length;
  }

  return {
    min: minRaw,
    max: maxRaw,
    currency: resolvedCurrency,
    unit,
    text: hay.slice(start, textEnd).trim(),
  };
}

/**
 * Finds a salary range in free text. Returns null when nothing convincing is
 * found — callers treat that as "this posting does not publish pay".
 */
export function parseSalary(
  text: string,
  opts?: { currencyHint?: string | null },
): ParsedSalary | null {
  if (!text || typeof text !== "string") return null;
  const hay = text.replace(/[\u00a0  ]/g, " ").replace(/[ \t]+/g, " ");
  const hint = currencyOf(opts?.currencyHint ?? undefined) ?? opts?.currencyHint ?? null;

  try {
    RANGE_RE.lastIndex = 0;
    for (let m = RANGE_RE.exec(hay); m; m = RANGE_RE.exec(hay)) {
      const [, curA, numA, multA, curB, curC, numB, multB, curD] = m;
      const lo = toNumber(numA);
      const hi = toNumber(numB);
      if (lo === null || hi === null) continue;
      const multHi = multiplier(multB);
      // "60-90k" means 60 000 to 90 000: a trailing k applies to both bounds.
      const multLo = multA ? multiplier(multA) : lo < hi ? multHi : 1;
      const currency = currencyOf(curA ?? curB ?? curC ?? curD);
      const candidate = evaluate(
        hay,
        m.index,
        m.index + m[0].length,
        lo * multLo,
        hi * multHi,
        currency,
        Boolean(multA ?? multB),
        hint,
      );
      if (candidate) return finalize(candidate);
    }

    SINGLE_RE.lastIndex = 0;
    for (let m = SINGLE_RE.exec(hay); m; m = SINGLE_RE.exec(hay)) {
      const [, curA, num, mult, curB] = m;
      const value = toNumber(num);
      if (value === null) continue;
      const amount = value * multiplier(mult);
      const currency = currencyOf(curA ?? curB);
      const before = hay.slice(Math.max(0, m.index - 20), m.index);
      const isUpTo = UPTO_RE.test(before);
      const isFrom = FROM_RE.test(before);
      const candidate = evaluate(
        hay,
        m.index,
        m.index + m[0].length,
        isUpTo ? null : amount,
        isFrom ? null : amount,
        currency,
        Boolean(mult),
        hint,
      );
      if (candidate) return finalize(candidate);
    }
  } catch {
    // A pathological input must never break extraction for the whole page.
  }
  return null;
}

function finalize(c: Candidate): ParsedSalary {
  return {
    min: c.min,
    max: c.max,
    currency: c.currency,
    unit: c.unit,
    text: c.text.replace(/\s+/g, " ").trim(),
  };
}

/** Groups thousands with plain spaces: 90000 → "90 000". */
function formatAmount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const [whole, fraction] = String(rounded).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** Renders a ParsedSalary as the display string stored on `JobPosting.salary`. */
export function formatSalary(s: ParsedSalary): string {
  if (!s) return "";
  const { min, max, currency, unit } = s;
  let core: string;
  if (min !== null && max !== null) {
    core = min === max ? formatAmount(min) : `${formatAmount(min)} – ${formatAmount(max)}`;
  } else if (min !== null) {
    core = `from ${formatAmount(min)}`;
  } else if (max !== null) {
    core = `up to ${formatAmount(max)}`;
  } else {
    return (s.text ?? "").trim();
  }
  if (currency) core += ` ${currency}`;
  if (unit) core += ` / ${unit}`;
  const qualifier = (s.text ?? "").match(QUALIFIER_RE);
  if (qualifier) core += ` ${qualifier[0].toLowerCase()}`;
  return core;
}
