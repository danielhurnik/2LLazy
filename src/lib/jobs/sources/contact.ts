import type { CheerioAPI } from "cheerio";
import type { ApplyPath } from "./types";

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const MAILTO_SELECTOR = "a[href^='mailto:' i]";
const MAILTO_PREFIX = /^mailto:/i;
const PAGE_CHROME_SELECTOR = "header, footer, nav";
const FILE_LIKE_SUFFIX = /\.(png|jpe?g|gif|svg|webp|js|css)$/i;
const BOARD_OPERATOR_DOMAINS = [
  "jobs.cz",
  "prace.cz",
  "lmc.eu",
  "alma.career",
  "teamio.com",
  "jobstack.it",
  "startupjobs.cz",
  "cocuma.cz",
  "skilleto.cz",
  "nofluffjobs.com",
  "jooble.org",
  "hitprace.cz",
  "profesia.cz",
];
const NON_HIRING_MAILBOXES = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "gdpr",
  "privacy",
  "dpo",
  "unsubscribe",
  "webmaster",
  "support",
  "podpora",
  "helpdesk",
  "abuse",
  "postmaster",
  "newsletter",
  "press",
  "marketing",
  "sales",
  "obchod",
  "fakturace",
  "faktury",
  "invoice",
  "billing",
  "ucetni",
]);

export function emailsInText(text: string): string[] {
  const found = text.match(EMAIL_PATTERN) ?? [];
  return Array.from(new Set(found.map((email) => email.toLowerCase()).filter((email) => !FILE_LIKE_SUFFIX.test(email))));
}

function mailtoAddress(href: string | undefined): string {
  return (href ?? "").replace(MAILTO_PREFIX, "").split("?")[0];
}

export function emailsInHtml($: CheerioAPI): string[] {
  const linked = $(MAILTO_SELECTOR)
    .filter((_, anchor) => $(anchor).closest(PAGE_CHROME_SELECTOR).length === 0)
    .map((_, anchor) => mailtoAddress($(anchor).attr("href")))
    .get()
    .flatMap(emailsInText);
  const content = $("body").clone();
  content.find(PAGE_CHROME_SELECTOR).remove();
  return Array.from(new Set([...linked, ...emailsInText(content.text())]));
}

function isHiringMailbox(email: string): boolean {
  const [mailbox, domain] = email.split("@");
  if (!mailbox || !domain || NON_HIRING_MAILBOXES.has(mailbox)) return false;
  return !BOARD_OPERATOR_DOMAINS.some((operator) => domain === operator || domain.endsWith(`.${operator}`));
}

export function contactEmail(candidates: string[]): string | undefined {
  return candidates.flatMap(emailsInText).find(isHiringMailbox);
}

export function emailApplyPath(url: string, candidates: string[]): ApplyPath | undefined {
  const email = contactEmail(candidates);
  return email ? { kind: "email", url, email } : undefined;
}

export function boardFormApplyPath(url: string): ApplyPath {
  return { kind: "board-form", url };
}
