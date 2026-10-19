import type { Frame, Locator, Page } from "playwright";
import type { FieldDescriptor } from "./fieldMatcher";

export interface ButtonDescriptor {
  frameIndex: number;
  selector: string;
  text: string;
  kind: "submit" | "button" | "link";
  href: string;
  visible: boolean;
}

export interface PageSignals {
  url: string;
  title: string;
  captcha: string | null;
  loginWall: boolean;
  stepHints: string[];
  bodyText: string;
  errors: string[];
}

export interface PageScan {
  frames: Frame[];
  fields: FieldDescriptor[];
  buttons: ButtonDescriptor[];
  signals: PageSignals;
}

interface FrameScan {
  fields: Omit<FieldDescriptor, "frameIndex">[];
  buttons: Omit<ButtonDescriptor, "frameIndex">[];
  captcha: string | null;
  passwordInputs: number;
  stepHints: string[];
  bodyText: string;
}

function enumerateFrame(): FrameScan {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const isVisible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (rect.width > 0 || rect.height > 0) && style.visibility !== "hidden" && style.display !== "none";
  };
  const isUnique = (selector: string, el: Element) => {
    try {
      const found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  };
  const selectorFor = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    if (el.id && isUnique(`#${CSS.escape(el.id)}`, el)) return `#${CSS.escape(el.id)}`;
    const testId = el.getAttribute("data-testid");
    if (testId && isUnique(`[data-testid="${CSS.escape(testId)}"]`, el)) return `[data-testid="${CSS.escape(testId)}"]`;
    const name = el.getAttribute("name");
    if (name && isUnique(`${tag}[name="${CSS.escape(name)}"]`, el)) return `${tag}[name="${CSS.escape(name)}"]`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && parts.length < 12) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(" > ");
  };
  const labelFor = (el: HTMLElement): string => {
    const bits: string[] = [];
    const labels = (el as HTMLInputElement).labels;
    if (labels) for (const l of Array.from(labels)) bits.push(clean(l.textContent));
    if (!bits.length && el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) bits.push(clean(l.textContent));
    }
    if (!bits.length) {
      const wrap = el.closest("label");
      if (wrap) bits.push(clean(wrap.textContent));
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const node = document.getElementById(id);
        if (node) bits.push(clean(node.textContent));
      }
    }
    if (!bits.length) {
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 4) {
        const candidate = parent.querySelector("label, legend, [class*=label i]");
        if (candidate && !candidate.contains(el)) {
          bits.push(clean(candidate.textContent));
          break;
        }
        parent = parent.parentElement;
        depth += 1;
      }
    }
    return bits.filter(Boolean).join(" ");
  };

  const modals = Array.from(document.querySelectorAll<HTMLElement>("[role=dialog], dialog[open], [aria-modal=true]")).filter(isVisible);
  const root: ParentNode = modals[modals.length - 1] ?? document;

  const fields: FrameScan["fields"] = [];
  const controls = root.querySelectorAll<HTMLElement>("input, textarea, select");
  for (const el of Array.from(controls)) {
    const tag = el.tagName.toLowerCase() as "input" | "textarea" | "select";
    const type = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : tag;
    const label = labelFor(el);
    const required =
      (el as HTMLInputElement).required === true ||
      el.getAttribute("aria-required") === "true" ||
      /\*\s*$/.test(label) ||
      /^\*/.test(label);
    fields.push({
      selector: selectorFor(el),
      tag,
      type,
      name: el.getAttribute("name") ?? "",
      id: el.id ?? "",
      label,
      placeholder: el.getAttribute("placeholder") ?? "",
      ariaLabel: el.getAttribute("aria-label") ?? "",
      autocomplete: el.getAttribute("autocomplete") ?? "",
      accept: el.getAttribute("accept") ?? "",
      required,
      visible: type === "file" ? !(el as HTMLInputElement).disabled : isVisible(el),
      checked: (el as HTMLInputElement).checked === true,
      options: tag === "select" ? Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, text: clean(o.textContent) })) : [],
    });
  }

  const buttons: FrameScan["buttons"] = [];
  const clickables = root.querySelectorAll<HTMLElement>("button, [role=button], input[type=submit], a[href]");
  for (const el of Array.from(clickables)) {
    const tag = el.tagName.toLowerCase();
    const text = clean((el as HTMLInputElement).value && tag === "input" ? (el as HTMLInputElement).value : el.innerText || el.getAttribute("aria-label") || el.title);
    if (!text) continue;
    const type = (el.getAttribute("type") ?? "").toLowerCase();
    buttons.push({
      selector: selectorFor(el),
      text,
      kind: tag === "a" ? "link" : type === "submit" ? "submit" : "button",
      href: tag === "a" ? (el as HTMLAnchorElement).href : "",
      visible: isVisible(el),
    });
  }

  const captchaSelectors = '.g-recaptcha, .cf-turnstile, .h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"]';
  const captchaEl = Array.from(document.querySelectorAll<HTMLElement>(captchaSelectors)).find(isVisible);
  const captcha = captchaEl ? (captchaEl.getAttribute("src") ?? captchaEl.className ?? "captcha").slice(0, 80) : null;
  const bodyText = clean(document.body?.innerText ?? "").slice(0, 4000);
  const stepHints = Array.from(new Set((bodyText.match(/(krok\s*\d+\s*(z|\/)\s*\d+|step\s*\d+\s*(of|\/)\s*\d+)/gi) ?? []).map((s) => s.toLowerCase())));
  return {
    fields,
    buttons,
    captcha,
    passwordInputs: Array.from(document.querySelectorAll("input[type=password]")).filter(isVisible).length,
    stepHints,
    bodyText,
  };
}

const LOGIN_TEXT = /(přihlaste se|prihlaste se|pro pokračování se přihlaste|log in to|sign in to|please log in|please sign in|create an account to apply)/i;

export async function scanPage(page: Page): Promise<PageScan> {
  const frames = page.frames();
  const fields: FieldDescriptor[] = [];
  const buttons: ButtonDescriptor[] = [];
  let captcha: string | null = null;
  let passwordInputs = 0;
  const stepHints = new Set<string>();
  let bodyText = "";
  const errors: string[] = [];

  for (const [frameIndex, frame] of frames.entries()) {
    let result: FrameScan;
    try {
      result = await frame.evaluate(enumerateFrame);
    } catch (err) {
      errors.push(`frame ${frameIndex} ${frame.url().slice(0, 80)}: ${(err as Error).message.split("\n")[0].slice(0, 200)}`);
      continue;
    }
    for (const field of result.fields) fields.push({ ...field, frameIndex });
    for (const button of result.buttons) buttons.push({ ...button, frameIndex });
    captcha ??= result.captcha;
    passwordInputs += result.passwordInputs;
    for (const hint of result.stepHints) stepHints.add(hint);
    if (frame === page.mainFrame()) bodyText = result.bodyText;
  }

  return {
    frames,
    fields,
    buttons,
    signals: {
      url: page.url(),
      title: await page.title().catch(() => ""),
      captcha,
      loginWall: passwordInputs > 0 && LOGIN_TEXT.test(bodyText),
      stepHints: [...stepHints],
      bodyText,
      errors,
    },
  };
}

export function describeScan(scan: PageScan): string {
  const visibleFields = scan.fields.filter((f) => f.visible).length;
  const visibleButtons = scan.buttons.filter((b) => b.visible);
  const sample = visibleButtons
    .slice(0, 25)
    .map((b) => `"${b.text.slice(0, 30)}"[${b.kind}]`)
    .join(", ");
  const errors = scan.signals.errors.length ? ` errors=${JSON.stringify(scan.signals.errors)}` : "";
  return `scan ${scan.signals.url.slice(0, 100)} frames=${scan.frames.length} fields=${scan.fields.length}/${visibleFields} visible buttons=${scan.buttons.length}/${visibleButtons.length} visible captcha=${scan.signals.captcha ?? "no"} login=${scan.signals.loginWall}${errors} buttons: ${sample}`;
}

export function locatorFor(scan: PageScan, target: { frameIndex: number; selector: string }): Locator {
  const frame = scan.frames[target.frameIndex] ?? scan.frames[0];
  return frame.locator(target.selector).first();
}

export function findButton(scan: PageScan, pattern: RegExp, options: { kinds?: ButtonDescriptor["kind"][] } = {}): ButtonDescriptor | null {
  const kinds = options.kinds ? new Set(options.kinds) : null;
  const candidates = scan.buttons.filter((b) => b.visible && pattern.test(b.text) && (!kinds || kinds.has(b.kind)));
  return candidates.find((b) => b.kind === "submit") ?? candidates[0] ?? null;
}
