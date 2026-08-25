/**
 * Tokenisation and normalisation for the deterministic lexical matcher.
 *
 * Postings arrive in English, Czech, Polish and German, so every string is
 * folded to one ASCII-lowercase shape ("vývojář" -> "vyvojar") before it is
 * compared. Tech terms are the awkward part: `node.js`, `c++` and `ci/cd` carry
 * meaning in their punctuation, so they are matched from an explicit protected
 * list *before* the generic non-alphanumeric split runs.
 *
 * Nothing here throws: malformed or empty input yields an empty token list.
 */

/**
 * Tokens whose punctuation is part of the name. Matched longest-first so
 * `asp.net` wins over `.net` and `react-native` over a plain hyphen split.
 */
export const PROTECTED_TOKENS: readonly string[] = [
  "objective-c",
  "react-native",
  "socket.io",
  "asp.net",
  "node.js",
  "next.js",
  "nuxt.js",
  "vue.js",
  "ci/cd",
  "ui/ux",
  ".net",
  "c++",
  "c#",
  "f#",
]
  .slice()
  .sort((a, b) => b.length - a.length);

const PROTECTED_SET = new Set(PROTECTED_TOKENS);

/**
 * Characters that survive NFD normalisation unchanged (they have no combining
 * form) and therefore need an explicit fold.
 */
const LETTER_FOLDS: Record<string, string> = {
  "ł": "l", // ł
  "đ": "d", // đ
  "ø": "o", // ø
  "æ": "ae",
  "œ": "oe",
  "ß": "ss",
};

/**
 * Stopwords for the four languages the boards return. Deliberately compact and
 * free of anything that could be a skill ("go", "it" aside — see note below).
 * `it` is dropped as an English pronoun, which also keeps "IT Manager" style
 * postings from matching on the noise word alone.
 */
const STOPWORDS = new Set(
  (
    // English
    "a an and are as at be been being but by can could do does for from had has have how if in " +
    "into is it its may more most no not of on or our out over per so such than that the their " +
    "then there these they this those to up us was we were what when where which who will with " +
    "would you your yours able about after all also any each other " +
    // Czech
    "a i v ve na se si je jsou byt bude budeme budou do pro s z ze k ke o od po pri za nebo ale " +
    "jako ktery ktera ktere kteri nas nase nasi vas vase jsme mate maji tym prace praci pracovat " +
    "nabizime hledame nabidka nam jeho jejich neni jen uz " +
    // Polish
    "i w na z ze do nie to sie o jest sa dla oraz lub po od za przez jako tym ma by bedzie beda " +
    "praca pracy prace szukamy oferujemy nasz nasza nasze jego ich tego czy juz " +
    // German
    "der die das den dem des ein eine einen einem eines und oder aber mit von zu zum zur bei im " +
    "in auf fur ist sind sein werden wir sie ihr uns unser unsere als auch nach uber wie sowie " +
    "sowohl du dich dir haben hat wird"
  ).split(" "),
);

/** True when the token carries no meaning on its own. */
export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/** Lowercase, strip diacritics, collapse whitespace. Punctuation is kept. */
export function normaliseText(text: string): string {
  if (!text) return "";
  let out = text.toLowerCase();
  out = out.replace(/[łđøæœß]/g, (c) => LETTER_FOLDS[c] ?? c);
  out = out.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Canonical form of a single token: folded to ASCII lowercase, punctuation
 * removed unless the whole token is a protected tech token.
 */
export function normaliseToken(token: string): string {
  const folded = normaliseText(token);
  if (PROTECTED_SET.has(folded)) return folded;
  const stripped = folded.replace(/[^a-z0-9]+/g, "");
  return PROTECTED_SET.has(stripped) ? stripped : stripped;
}

/** Flatten to alphanumeric words separated by single spaces (for title fragments). */
export function flattenText(text: string): string {
  return normaliseText(text).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Very small suffix stripper for English plurals and verb endings — enough to
 * make "developers"/"developer" and "testing"/"test" collide without pulling in
 * a full Porter stemmer. Protected tokens are never stemmed.
 */
export function stemToken(token: string): string {
  if (PROTECTED_SET.has(token) || token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("sses")) return token.slice(0, -2);
  if (token.length > 5 && /(ches|shes|xes|ses|zes)$/.test(token)) return token.slice(0, -2);
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ers") && token.length > 5) return token.slice(0, -1);
  if (token.endsWith("ed") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && !/(ss|us|is|as)$/.test(token)) return token.slice(0, -1);
  return token;
}

function isAlnum(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
}

function matchProtected(src: string, at: number): string | null {
  for (const token of PROTECTED_TOKENS) {
    if (!src.startsWith(token, at)) continue;
    const after = src[at + token.length];
    if (after !== undefined && isAlnum(after)) continue;
    return token;
  }
  return null;
}

export interface TokenizeOptions {
  /** Keep stopwords (used when building lookup keys for aliases). */
  keepStopwords?: boolean;
  /** Emit the light stem next to each raw token. */
  stem?: boolean;
}

/**
 * Core tokeniser. Returns tokens in document order; a source word may produce
 * several tokens (raw + stem, protected token + its parts, hyphen compound +
 * its glued form) so that queries and postings meet in the middle.
 */
export function tokenizeWith(text: string, options: TokenizeOptions = {}): string[] {
  const src = normaliseText(text);
  if (!src) return [];
  const keepStopwords = options.keepStopwords === true;
  const stem = options.stem === true;
  const out: string[] = [];

  const push = (token: string): void => {
    if (token.length < 2 && !PROTECTED_SET.has(token)) return;
    if (!keepStopwords && isStopword(token)) return;
    out.push(token);
  };

  let index = 0;
  let separator = "";
  let previousWord = "";

  while (index < src.length) {
    const ch = src[index];
    const boundaryBefore = index === 0 || !isAlnum(src[index - 1]);
    const protectedToken = boundaryBefore ? matchProtected(src, index) : null;

    if (protectedToken) {
      out.push(protectedToken);
      for (const nested of PROTECTED_TOKENS) {
        if (nested !== protectedToken && protectedToken.includes(nested)) out.push(nested);
      }
      for (const part of protectedToken.split(/[^a-z0-9]+/)) {
        if (part.length >= 2) push(part);
      }
      index += protectedToken.length;
      separator = "";
      previousWord = "";
      continue;
    }

    if (!isAlnum(ch)) {
      separator += ch;
      index += 1;
      continue;
    }

    let end = index;
    while (end < src.length && isAlnum(src[end])) end += 1;
    const word = src.slice(index, end);
    push(word);
    if (stem) {
      const stemmed = stemToken(word);
      if (stemmed !== word) push(stemmed);
    }
    // "front-end" should also answer to "frontend".
    if (separator === "-" && previousWord && word.length >= 2 && previousWord.length >= 2) {
      const glued = previousWord + word;
      if (glued.length <= 24) push(glued);
    }
    previousWord = word;
    separator = "";
    index = end;
  }

  return out;
}

/** Public tokeniser: stopwords dropped, stems emitted alongside raw tokens. */
export function tokenize(text: string): string[] {
  return tokenizeWith(text, { stem: true });
}

/** Tokens without stems — used to build stable lookup keys for aliases. */
export function tokenizeExact(text: string): string[] {
  return tokenizeWith(text, { stem: false });
}
