import type { BrowserContext, Page } from "playwright";
import { findButton, scanPage, type ButtonDescriptor, type PageScan } from "./fieldScanner";
import { locatorFor } from "./fieldScanner";

export const APPLY_BUTTON = /(reagovat|odpov[eě]d[eě]t|odpov[eě]d na inzer[aá]t|m[aá]m z[aá]jem|chci se p[rř]ihl[aá]sit|p[rř]ihl[aá]sit se na pozici|zaslat (životopis|cv)|poslat (životopis|cv)|^apply( now| for this job)?$|apply|reaguj|respond|\breply\b|i'm interested|odeslat z[aá]jem|send (my )?(cv|resume)|uch[aá]zet se|po[zž][aá]dat( o tuto pr[aá]ci)?|apply for this job)/i;
export const SUBMIT_BUTTON = /^(odeslat( z[aá]jem| žádost| reakci| formul[aá][rř])?|odeslat a dokončit|submit( application)?|send( application)?|apply( now)?|reagovat|dokon[cč]it|potvrdit|confirm)\b/i;
export const NEXT_BUTTON = /^(pokra[cč]ovat|dal[sš][ií]( krok)?|next( step)?|continue|forward)\b/i;
export const REJECT_CONSENT = /^(odm[ií]tnout( v[sš]e| vše)?|odm[ií]t[aá]m|pouze nezbytn[eé]|p[rř]ijmout nezbytn[eé]|jen nezbytn[eé]|nezbytn[eé]( cookies)?|reject( all)?|decline|necessary only|only necessary|essential only|accept necessary|accept essential)/i;
export const CONFIRMATION_TEXT = /(d[eě]kujeme|děkujeme za (vaši|vaší|tvou)? ?(reakci|odpov[eě][dď]|zájem|žádost)|reakce byla odesl[aá]na|úspěšně odesl[aá]n|bylo odesl[aá]no|byla odesl[aá]na|thank you for (your )?(applying|application|interest)|application (was )?(sent|submitted|received)|successfully (sent|submitted|applied)|we have received your application)/i;
export const VALIDATION_TEXT = /(povinn[eéý]|toto pole|vypl[nň]te|neplatn[yýáé]|je vy[zž]adov[aá]n|required|invalid|must be|please (fill|enter|provide))/i;

const CONSENT_CONTAINERS = [
  ".cky-consent-container",
  ".cky-overlay",
  "#CybotCookiebotDialog",
  "#onetrust-consent-sdk",
  ".didomi-popup-container",
  ".lmc-fms__modal",
  ".lmc-fms__overlay",
  "#cookiescript_injected",
  "[class*=cookie-consent i]",
  "[id*=cookie-consent i]",
  ".cookie-notice",
  "#cookie-notice",
];

export async function settle(page: Page, idleMs = 8_000): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: idleMs }).catch(() => undefined);
  await page.waitForTimeout(600);
}

export async function dismissConsent(page: Page): Promise<string | null> {
  for (const frame of page.frames()) {
    const button = frame.getByRole("button", { name: REJECT_CONSENT }).first();
    if (await button.isVisible().catch(() => false)) {
      const text = (await button.innerText().catch(() => "")).trim();
      await button.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      return text || "consent rejected";
    }
  }
  const removed = await page
    .evaluate((selectors) => {
      let count = 0;
      for (const selector of selectors) {
        for (const el of Array.from(document.querySelectorAll(selector))) {
          el.remove();
          count += 1;
        }
      }
      document.documentElement.classList.remove("force--consent", "show--consent", "cky-overlay-active");
      document.body?.classList.remove("cky-overlay-active");
      if (document.body) document.body.style.overflow = "";
      return count;
    }, CONSENT_CONTAINERS)
    .catch(() => 0);
  return removed > 0 ? `removed ${removed} consent overlay element(s)` : null;
}

export interface ClickOutcome {
  page: Page;
  navigated: boolean;
}

export async function clickButton(context: BrowserContext, page: Page, scan: PageScan, button: ButtonDescriptor): Promise<ClickOutcome> {
  const beforeUrl = page.url();
  const popupPromise = context.waitForEvent("page", { timeout: 4_000 }).catch(() => null);
  const locator = locatorFor(scan, button);
  await locator.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
  await locator.click({ timeout: 10_000 });
  const popup = await popupPromise;
  const active = popup ?? page;
  await settle(active);
  return { page: active, navigated: popup !== null || active.url() !== beforeUrl };
}

export async function findApplyEntry(scan: PageScan): Promise<ButtonDescriptor | null> {
  const direct = findButton(scan, APPLY_BUTTON, { kinds: ["submit", "button"] });
  if (direct) return direct;
  const links = scan.buttons.filter((b) => b.visible && b.kind === "link" && APPLY_BUTTON.test(b.text));
  return links.find((b) => /#|apply|reagovat|odpoved|zajem|formular|fms/i.test(b.href)) ?? links[0] ?? null;
}

export function isConfirmed(before: PageScan, after: PageScan, filledSelectors: Set<string>): boolean {
  if (CONFIRMATION_TEXT.test(after.signals.bodyText)) return true;
  if (/(thank|dekuj|success|confirm|odeslano|sent)/i.test(after.signals.url) && after.signals.url !== before.signals.url) return true;
  const visibleFilled = after.fields.filter((f) => f.visible && filledSelectors.has(`${f.frameIndex}:${f.selector}`));
  return filledSelectors.size > 0 && visibleFilled.length === 0 && !VALIDATION_TEXT.test(after.signals.bodyText);
}

export async function rescan(page: Page): Promise<PageScan> {
  await dismissConsent(page);
  return scanPage(page);
}
