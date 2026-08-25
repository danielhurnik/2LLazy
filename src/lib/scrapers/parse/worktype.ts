/**
 * Work-type detection from posting text.
 *
 * Boards rarely mark remote/hybrid/onsite in structured data, so this is a
 * keyword vote across the languages our boards publish in (en/cs/pl/de/es/fr/nl).
 * Text is diacritic-folded first, which lets one unaccented keyword list cover
 * "hybridní", "hybrydowa" and "híbrido" at once.
 */
import type { WorkType } from "../types";

/** Lowercases and strips diacritics so one keyword matches every spelling. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const REMOTE = [
  "remote", "remotely", "work from home", "work from anywhere", "wfh",
  "home office", "homeoffice", "home-office", "telecommute", "telework",
  "prace z domova", "z domova", "na dalku", "praca zdalna", "zdalna", "zdalnie",
  "teletrabajo", "en remoto", "a distancia", "teletravail", "a distance",
  "thuiswerken", "op afstand", "fernarbeit", "remoto", "remotni",
];

const HYBRID = [
  "hybrid", "hybridni", "hybridne", "hybrydowa", "hybrydowy", "praca hybrydowa",
  "hibrido", "hybride", "partially remote", "partly remote", "part remote",
  "combination of office", "mix of office", "office and home", "castecne remote",
  "castecny home office", "teilweise remote", "flexible office",
];

/** "2 days in the office", "3 dni w biurze" — a hybrid arrangement spelled out. */
const HYBRID_PATTERNS = [
  /\b\d\s*(?:days?|dni|dny|dnu|tage|dias|jours)\b[^.]{0,25}\b(?:office|kancelar|biur|buro|oficina|bureau|kantoor|home)\b/i,
  /\b(?:office|kancelar|biur)\b[^.]{0,20}\b\d\s*(?:days?|dni|dny|tage)\b/i,
];

const ONSITE = [
  "on-site", "onsite", "on site", "in-office", "in office", "office-based",
  "at our office", "from our office", "presencial", "vor ort", "im buro",
  "w biurze", "stacjonarna", "stacjonarnie", "v kancelari", "na pracovisti",
  "sur site", "sur place", "op kantoor", "prace na pracovisti",
];

/** Explicit refusals of remote work — these flip the vote to onsite. */
const NO_REMOTE =
  /\b(?:no|not|without|non|kein|keine|bez|zadny|zadna|nie ma)\b[^.]{0,15}\b(?:remote|home\s?office|prace z domova|zdaln)/i;

function countHits(hay: string, needles: string[]): number {
  let hits = 0;
  for (const needle of needles) if (hay.includes(needle)) hits++;
  return hits;
}

/**
 * Keyword detection across en/cs/pl/de/es/fr/nl. Returns "" when unclear.
 * Hybrid outranks remote on a tie because a page saying both ("hybrid, 2 days
 * remote") describes a hybrid role.
 */
export function detectWorkType(text: string): WorkType {
  if (!text || typeof text !== "string") return "";
  try {
    const hay = fold(text.slice(0, 20_000));
    const refusesRemote = NO_REMOTE.test(hay);

    const hybrid =
      countHits(hay, HYBRID) + (HYBRID_PATTERNS.some((re) => re.test(hay)) ? 1 : 0);
    const remote = refusesRemote ? 0 : countHits(hay, REMOTE);
    const onsite = countHits(hay, ONSITE) + (refusesRemote ? 2 : 0);

    const best = Math.max(hybrid, remote, onsite);
    if (best === 0) return "";
    if (hybrid === best) return "Hybrid";
    if (remote === best) return "Remote";
    return "Onsite";
  } catch {
    return "";
  }
}
