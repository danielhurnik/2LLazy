/**
 * findApplyButton
 *
 * Locates the primary "Apply" call-to-action on a job detail page by matching
 * the visible text of buttons and links against the vocabulary job boards
 * actually use (English and Czech). No model call: an apply button that does
 * not say "apply" in some form is rare enough that MANUAL_REQUIRED — the page
 * opens for the user — is the right answer, not a guess at which element to
 * click on their behalf.
 *
 * Returns the DOM index (data-aaf-btn-idx) of the best match, or null when
 * no suitable element is found (→ MANUAL_REQUIRED in the orchestrator).
 */
import type { Page } from "playwright";

const APPLY_TEXT_PATTERN =
  /^(apply|apply now|apply for (this )?(job|position|role)|apply here|submit (your )?application|send (my )?application|send cv|send resume|quick apply|easy apply|i'?m interested|odeslat (zadost|odpoved)|odpovedet|prihlasit se|mam zajem|chci tuto praci|respond to job|reagovat( na nabidku)?)/i;

interface BtnCandidate {
  idx: number;
  text: string;
  ariaLabel: string;
}

/** Diacritics-insensitive, so "Odeslat žádost" matches "odeslat zadost". */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

export async function findApplyButton(page: Page): Promise<number | null> {
  // Inject data-aaf-btn-idx and collect candidate info
  const candidates: BtnCandidate[] = await page.evaluate((): BtnCandidate[] => {
    const all = Array.from(document.querySelectorAll("button, a[href]")) as (
      | HTMLButtonElement
      | HTMLAnchorElement
    )[];

    return all
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .slice(0, 60)
      .map((el, idx) => {
        el.setAttribute("data-aaf-btn-idx", String(idx));
        return {
          idx,
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
          ariaLabel: el.getAttribute("aria-label") ?? "",
        };
      });
  });

  const match = candidates.find(
    (c) => APPLY_TEXT_PATTERN.test(fold(c.text)) || APPLY_TEXT_PATTERN.test(fold(c.ariaLabel)),
  );
  return match?.idx ?? null;
}
