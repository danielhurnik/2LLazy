const COMBINING_DIACRITICS = /[̀-ͯ]/g;

export function foldDiacritics(text: string): string {
  return text.normalize("NFD").replace(COMBINING_DIACRITICS, "");
}

export function normalizeText(text: string): string {
  return foldDiacritics(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
