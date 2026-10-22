import type { Frame, Locator, Page } from "playwright";
import type { FieldDescriptor } from "./fieldMatcher";
import { errorMessage } from "@/lib/guards";

export interface ButtonDescriptor {
  frameIndex: number;
  selector: string;
  text: string;
  kind: "submit" | "button" | "link";
  href: string;
  visible: boolean;
}

interface PageSignals {
  url: string;
  title: string;
  captcha: string | null;
  captchaInvisible?: boolean;
  captchaChallenge?: boolean;
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
  captchaInvisible: boolean;
  captchaChallenge: boolean;
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
  const generatedId = (id: string) => /\d{2,}/.test(id) || /^(reka|radix|headlessui|mui|v-|:r|input-|field-|el-)/i.test(id) || /[-_:][0-9a-z]{6,}$/i.test(id);
  const selectorFor = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute("name");
    const testId = el.getAttribute("data-testid");
    if (el.id && !generatedId(el.id) && isUnique(`#${CSS.escape(el.id)}`, el)) return `#${CSS.escape(el.id)}`;
    if (testId && isUnique(`[data-testid="${CSS.escape(testId)}"]`, el)) return `[data-testid="${CSS.escape(testId)}"]`;
    if (name && isUnique(`${tag}[name="${CSS.escape(name)}"]`, el)) return `${tag}[name="${CSS.escape(name)}"]`;
    if (el.id && isUnique(`#${CSS.escape(el.id)}`, el)) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.nodeType === 1 && parts.length < 12) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && !generatedId(cur.id)) {
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
    const inputType = (el.getAttribute("type") ?? "").toLowerCase();
    if (!bits.length && (inputType === "checkbox" || inputType === "radio") && el.parentElement) {
      const text = clean(el.parentElement.textContent);
      if (text) bits.push(text);
    }
    if (!bits.length) {
      const labelLike = (node: Element | null): string => {
        if (!node || node.contains(el)) return "";
        if (node.matches("label, legend, [class*=label i], h1, h2, h3, h4, h5, h6, p, span, div, dt, strong")) {
          const text = clean(node.textContent);
          if (text && text.length <= 120 && !node.querySelector("input, textarea, select")) return text;
          const inner = node.querySelector("label, legend, [class*=label i]");
          if (inner && !inner.contains(el)) return clean(inner.textContent);
        }
        return "";
      };
      let scope: Element | null = el;
      let depth = 0;
      while (scope && depth < 4 && !bits.length) {
        let sibling = scope.previousElementSibling;
        let hops = 0;
        while (sibling && hops < 3) {
          const text = labelLike(sibling);
          if (text) {
            bits.push(text);
            break;
          }
          sibling = sibling.previousElementSibling;
          hops += 1;
        }
        scope = scope.parentElement;
        depth += 1;
      }
    }
    return bits.filter(Boolean).join(" ");
  };

  const fieldVisible = (el: HTMLElement, type: string): boolean => {
    const input = el as HTMLInputElement;
    if (input.disabled || input.readOnly) return false;
    if (type === "file") return true;
    if (isVisible(el)) return true;
    if (type !== "checkbox" && type !== "radio") return false;
    const holder = input.labels?.[0] ?? el.closest("label") ?? el.parentElement;
    return !!holder && isVisible(holder);
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
      visible: fieldVisible(el, type),
      checked: (el as HTMLInputElement).checked === true,
      value: type === "file" || type === "password" ? "" : clean((el as HTMLInputElement).value).slice(0, 2000),
      options: tag === "select" ? Array.from((el as HTMLSelectElement).options).map((o) => ({ value: o.value, text: clean(o.textContent) })) : [],
    });
  }

  const editors = root.querySelectorAll<HTMLElement>('[contenteditable="true"], [contenteditable=""], [role="textbox"]');
  for (const el of Array.from(editors)) {
    const tagName = el.tagName.toLowerCase();
    if (tagName === "input" || tagName === "textarea") continue;
    const label = labelFor(el);
    fields.push({
      selector: selectorFor(el),
      tag: "textarea",
      type: "richtext",
      name: el.getAttribute("name") ?? el.getAttribute("data-name") ?? "",
      id: el.id ?? "",
      label,
      placeholder: el.getAttribute("data-placeholder") ?? el.getAttribute("aria-placeholder") ?? el.getAttribute("placeholder") ?? "",
      ariaLabel: el.getAttribute("aria-label") ?? "",
      autocomplete: "",
      accept: "",
      required: el.getAttribute("aria-required") === "true" || /\*\s*$/.test(label),
      visible: isVisible(el),
      checked: false,
      value: clean(el.textContent).slice(0, 2000),
      options: [],
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
  const captchaElements = Array.from(document.querySelectorAll<HTMLElement>(captchaSelectors));
  const isChallengeFrame = (el: HTMLElement) => el.tagName.toLowerCase() === "iframe" && /api2\/bframe|frame=challenge|hcaptcha\.com\/.*challenge/i.test(el.getAttribute("src") ?? "");
  const isInvisibleWidget = (el: HTMLElement) =>
    /size=invisible/i.test(el.getAttribute("src") ?? "") || el.getAttribute("data-size") === "invisible" || !!el.closest(".grecaptcha-badge");
  const challengeFrame = captchaElements.find((el) => isChallengeFrame(el) && isVisible(el));
  const captchaEl = challengeFrame ?? captchaElements.find(isVisible);
  const captcha = captchaEl ? (captchaEl.getAttribute("src") ?? captchaEl.className ?? "captcha").slice(0, 120) : null;
  const captchaChallenge = !!challengeFrame;
  const captchaInvisible = !!captchaEl && !captchaChallenge && isInvisibleWidget(captchaEl);
  const bodyText = clean(document.body?.innerText ?? "").slice(0, 4000);
  const stepHints = Array.from(new Set((bodyText.match(/(krok\s*\d+\s*(z|\/)\s*\d+|step\s*\d+\s*(of|\/)\s*\d+)/gi) ?? []).map((s) => s.toLowerCase())));
  return {
    fields,
    buttons,
    captcha,
    captchaInvisible,
    captchaChallenge,
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
  let captchaInvisible = false;
  let captchaChallenge = false;
  let passwordInputs = 0;
  const stepHints = new Set<string>();
  let bodyText = "";
  const errors: string[] = [];

  for (const [frameIndex, frame] of frames.entries()) {
    let result: FrameScan;
    try {
      result = await frame.evaluate(enumerateFrame);
    } catch (err) {
      errors.push(`frame ${frameIndex} ${frame.url().slice(0, 80)}: ${errorMessage(err).split("\n")[0].slice(0, 200)}`);
      continue;
    }
    for (const field of result.fields) fields.push({ ...field, frameIndex });
    for (const button of result.buttons) buttons.push({ ...button, frameIndex });
    const strongerCaptcha =
      result.captcha !== null && (captcha === null || result.captchaChallenge || (captchaInvisible && !result.captchaInvisible && !captchaChallenge));
    if (strongerCaptcha) {
      captcha = result.captcha;
      captchaInvisible = result.captchaInvisible;
      captchaChallenge = captchaChallenge || result.captchaChallenge;
    }
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
      captchaInvisible,
      captchaChallenge,
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
  const fieldSample = scan.fields
    .filter((f) => f.visible)
    .slice(0, 30)
    .map((f) => `${f.tag === "input" ? f.type : f.tag}${f.required ? "*" : ""}:"${(f.label || f.placeholder || f.ariaLabel || f.name).slice(0, 40)}"`)
    .join(", ");
  return `scan ${scan.signals.url.slice(0, 100)} frames=${scan.frames.length} fields=${scan.fields.length}/${visibleFields} visible buttons=${scan.buttons.length}/${visibleButtons.length} visible captcha=${scan.signals.captcha ?? "no"} login=${scan.signals.loginWall}${errors} fields: ${fieldSample} | buttons: ${sample}`;
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
