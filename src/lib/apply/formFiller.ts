import {
  AUTO_SUBMIT_CONFIDENCE,
  describeField,
  finalizePlan,
  isFillableField,
  planFill,
  type FieldDescriptor,
  type FillPlan,
  type PlannedFill,
} from "./fieldMatcher";
import type { Locator } from "playwright";
import { describeScan, findButton, locatorFor, scanPage, type ButtonDescriptor, type PageScan } from "./fieldScanner";
import { draftFreeText, mapFieldsWithOllama } from "./ollamaMapper";
import {
  clickButton,
  findApplyEntry,
  isConfirmed,
  NEXT_BUTTON,
  rescan,
  SUBMIT_BUTTON,
  VALIDATION_TEXT,
} from "./pageActions";
import { ApplyAbort, type ApplyContext, type ApplyProfile, type ApplyResult } from "./types";

const MAX_STEPS = 6;
const UPLOAD_BUTTON = /(uploadnout|nahr[aá]t|p[rř]ilo[zž]it|p[rř][ií]lohu|p[rř][ií]loha|upload|attach|browse|vybrat soubor|choose file|životopis|zivotopis|resume|\bcv\b)/i;
const PHONE_PREFIX = /^\+\d{1,3}$/;

export interface GenericFlowOptions {
  entry?: RegExp;
  submit?: RegExp;
  upload?: RegExp;
}

export async function snap(ctx: ApplyContext, label: string): Promise<void> {
  const file = await ctx.evidence.screenshot(ctx.page, label);
  if (file) ctx.emit({ type: "screenshot", url: ctx.evidence.urlFor(file) });
}

export function guardPage(scan: PageScan): void {
  if (scan.signals.captcha) {
    throw new ApplyAbort("NEEDS_MANUAL", `A CAPTCHA is blocking the form (${scan.signals.captcha}); solve it in the apply window and submit there`);
  }
  if (scan.signals.loginWall) {
    throw new ApplyAbort("NEEDS_MANUAL", "The job board asks for a login; sign in once in the apply window and retry");
  }
}

function nationalPhone(phone: string | null, scan: PageScan): string | null {
  if (!phone) return phone;
  const prefixButton = scan.buttons.find((b) => b.visible && PHONE_PREFIX.test(b.text.trim()));
  const prefixSelect = scan.fields.find((f) => f.tag === "select" && f.options.some((o) => PHONE_PREFIX.test(o.text.trim())));
  if (!prefixButton && !prefixSelect) return phone;
  const digits = phone.replace(/[^\d+]/g, "");
  const match = digits.match(/^(?:\+|00)(\d{1,3})(\d{9})$/);
  return match ? match[2] : phone;
}

export function profileForScan(profile: ApplyProfile, scan: PageScan): ApplyProfile {
  return { ...profile, phone: nationalPhone(profile.phone, scan) };
}

export async function buildPlan(ctx: ApplyContext, scan: PageScan): Promise<FillPlan> {
  const profile = profileForScan(ctx.profile, scan);
  const plan = planFill(scan.fields, profile);
  if (plan.unmatched.length > 0) {
    ctx.emit({ type: "progress", message: `Asking Ollama about ${plan.unmatched.length} unrecognised field(s)` });
    const llm = await mapFieldsWithOllama(plan.unmatched, profile);
    ctx.evidence.log(`ollama mapper used=${llm.used} mapped=${llm.mapped.length}`);
    plan.fills.push(...llm.mapped);
  }
  const freeTextFields = plan.unfillable.filter((entry) => (entry.key === "message" || entry.key === "coverLetter") && entry.field.tag === "textarea");
  for (const entry of freeTextFields.slice(0, 2)) {
    ctx.emit({ type: "progress", message: `Drafting "${describeField(entry.field)}" with Ollama` });
    const draft = await draftFreeText(entry.field, profile, ctx.job, (reason) => ctx.evidence.log(`draft rejected: ${reason}`));
    if (draft) {
      plan.fills.push({ field: entry.field, key: entry.key, score: 0.6, value: { kind: "text", value: draft.text } });
      ctx.evidence.log(`drafted ${describeField(entry.field)} with ${draft.model} (${draft.text.length} chars)`);
    } else {
      ctx.evidence.log(`no usable draft for ${describeField(entry.field)}`);
    }
  }
  return finalizePlan(plan, scan.fields);
}

async function setValueThroughDom(locator: Locator, value: string): Promise<void> {
  await locator.evaluate((el, next) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    input.focus();
    if (setter) setter.call(input, next);
    else input.value = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.blur();
  }, value);
}

async function setCheckedThroughDom(locator: Locator, checked: boolean): Promise<void> {
  await locator.evaluate((el, next) => {
    const input = el as HTMLInputElement;
    const label = input.labels?.[0] ?? input.closest("label");
    if (label) {
      (label as HTMLElement).click();
      if (input.checked === next) return;
    }
    input.checked = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, checked);
}

async function applyFill(scan: PageScan, fill: PlannedFill): Promise<void> {
  const locator = locatorFor(scan, fill.field);
  switch (fill.value.kind) {
    case "text":
      if (fill.field.type === "richtext") {
        await locator.click({ timeout: 4_000 });
        await locator.fill(fill.value.value, { timeout: 4_000 });
        return;
      }
      try {
        await locator.fill(fill.value.value, { timeout: 4_000 });
      } catch {
        await setValueThroughDom(locator, fill.value.value);
      }
      return;
    case "file":
      await locator.setInputFiles({ name: fill.value.file.name, mimeType: fill.value.file.mimeType, buffer: fill.value.file.buffer }, { timeout: 5_000 });
      return;
    case "select":
      await locator.selectOption(fill.value.value, { timeout: 5_000 });
      return;
    case "check": {
      const checked = await locator.evaluate((el) => (el as HTMLInputElement).checked).catch(() => false);
      if (checked === fill.value.value) return;
      try {
        await locator.setChecked(fill.value.value, { timeout: 3_000 });
      } catch {
        await setCheckedThroughDom(locator, fill.value.value);
      }
    }
  }
}

function payloadValue(fill: PlannedFill): string {
  switch (fill.value.kind) {
    case "file":
      return fill.value.file.name;
    case "check":
      return fill.value.value ? "checked" : "unchecked";
    default:
      return fill.value.value;
  }
}

function sameField(a: FieldDescriptor, b: FieldDescriptor): boolean {
  if (a.frameIndex !== b.frameIndex || a.tag !== b.tag || a.type !== b.type) return false;
  if (a.name && b.name) return a.name === b.name;
  return a.label === b.label && a.placeholder === b.placeholder && a.ariaLabel === b.ariaLabel;
}

async function relocate(ctx: ApplyContext, field: FieldDescriptor): Promise<{ scan: PageScan; field: FieldDescriptor } | null> {
  const fresh = await scanPage(ctx.page);
  const match = fresh.fields.find((candidate) => candidate.visible && sameField(candidate, field));
  return match ? { scan: fresh, field: match } : null;
}

async function isStillAttached(scan: PageScan, field: FieldDescriptor): Promise<boolean> {
  return (await locatorFor(scan, field).count().catch(() => 0)) > 0;
}

export async function fillFields(ctx: ApplyContext, scan: PageScan, plan: FillPlan): Promise<Record<string, string>> {
  const payload: Record<string, string> = {};
  const failed: PlannedFill[] = [];
  let current = scan;
  for (const fill of plan.fills) {
    const label = describeField(fill.field);
    try {
      let target = fill;
      let targetScan = current;
      if (!(await isStillAttached(current, fill.field))) {
        const found = await relocate(ctx, fill.field);
        if (!found) throw new Error("element disappeared after the page re-rendered");
        current = found.scan;
        targetScan = found.scan;
        target = { ...fill, field: found.field };
        ctx.evidence.log(`relocated ${label} -> ${found.field.selector}`);
      }
      await applyFill(targetScan, target);
      payload[label] = payloadValue(fill);
      ctx.evidence.log(`filled ${label} <- ${fill.key} (${fill.score.toFixed(2)})`);
    } catch (err) {
      failed.push(fill);
      ctx.evidence.log(`could not fill ${label} [frame ${fill.field.frameIndex} ${fill.field.selector}]: ${(err as Error).message.split("\n")[0]}`);
    }
  }
  if (failed.length > 0) {
    plan.fills = plan.fills.filter((f) => !failed.includes(f));
    plan.unmatched.push(...failed.map((f) => f.field));
    finalizePlan(plan, scan.fields);
  }
  return payload;
}

export async function uploadViaChooser(ctx: ApplyContext, scan: PageScan, pattern: RegExp): Promise<string | null> {
  if (!ctx.profile.cv) return null;
  const button = findButton(scan, pattern, { kinds: ["button", "link"] });
  if (!button) return null;
  const cv = ctx.profile.cv;
  try {
    const [chooser] = await Promise.all([
      ctx.page.waitForEvent("filechooser", { timeout: 5_000 }),
      locatorFor(scan, button).click({ timeout: 5_000 }),
    ]);
    await chooser.setFiles({ name: cv.name, mimeType: cv.mimeType, buffer: cv.buffer });
    await ctx.page.waitForTimeout(1_000);
    ctx.evidence.log(`uploaded ${cv.name} via "${button.text}"`);
    return button.text;
  } catch (err) {
    ctx.evidence.log(`upload via "${button.text}" failed: ${(err as Error).message.split("\n")[0]}`);
    return null;
  }
}

function selectorKey(field: FieldDescriptor): string {
  return `${field.frameIndex}:${field.selector}`;
}

const NON_FORM_INPUT_TYPES = new Set(["email", "checkbox", "radio", "search", "hidden"]);

export function looksLikeApplicationForm(fields: FieldDescriptor[]): boolean {
  return fields.some((f) => f.tag === "textarea" || f.tag === "select" || f.type === "file" || (f.tag === "input" && !NON_FORM_INPUT_TYPES.has(f.type)));
}

async function findEntry(scan: PageScan, options: GenericFlowOptions): Promise<ButtonDescriptor | null> {
  return (options.entry && findButton(scan, options.entry)) || findApplyEntry(scan);
}

function assertReadyToSubmit(ctx: ApplyContext, plan: FillPlan): void {
  if (plan.requiredMissing.length > 0) {
    const names = plan.requiredMissing.map(describeField).join(", ");
    throw new ApplyAbort("NEEDS_MANUAL", `Required field(s) left empty: ${names}. Finish them in the apply window`);
  }
  if (plan.confidence < AUTO_SUBMIT_CONFIDENCE) {
    throw new ApplyAbort("NEEDS_MANUAL", `Field mapping confidence ${plan.confidence} is below ${AUTO_SUBMIT_CONFIDENCE}; review the form in the apply window`);
  }
  if (!ctx.autoSubmit) throw new ApplyAbort("NEEDS_MANUAL", "Form filled; automatic submission is disabled");
}

async function openForm(ctx: ApplyContext, scan: PageScan, entry: ButtonDescriptor): Promise<PageScan> {
  ctx.emit({ type: "progress", message: `Opening the application form ("${entry.text}")` });
  const outcome = await clickButton(ctx.page.context(), ctx.page, scan, entry);
  ctx.page = outcome.page;
  await ctx.page.waitForTimeout(800);
  const next = await rescan(ctx.page);
  guardPage(next);
  ctx.evidence.log(`form opened at ${next.signals.url}`);
  return next;
}

export async function runGenericFlow(ctx: ApplyContext, options: GenericFlowOptions = {}): Promise<ApplyResult> {
  const scan = await rescan(ctx.page);
  guardPage(scan);
  await snap(ctx, "posting");

  const payload: Record<string, string> = {};
  const filledSelectors = new Set<string>();
  try {
    await fillAndSubmit(ctx, scan, options, payload, filledSelectors);
    return { status: "APPLIED", message: lastConfirmation, submitted: payload };
  } catch (err) {
    if (err instanceof ApplyAbort) err.submitted = payload;
    throw err;
  }
}

let lastConfirmation: string | undefined;

async function fillAndSubmit(
  ctx: ApplyContext,
  initial: PageScan,
  options: GenericFlowOptions,
  payload: Record<string, string>,
  filledSelectors: Set<string>,
): Promise<void> {
  let scan = initial;
  let formOpened = false;
  lastConfirmation = undefined;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    ctx.evidence.log(`step ${step + 1}: ${describeScan(scan)}`);
    const fillable = scan.fields.filter(isFillableField);
    const formLike = looksLikeApplicationForm(fillable);
    const entry = formOpened && formLike ? null : await findEntry(scan, options);
    const preferEntry = entry !== null && (!formLike || (!formOpened && entry.kind !== "submit"));
    if (preferEntry && entry) {
      scan = await openForm(ctx, scan, entry);
      formOpened = true;
      continue;
    }
    if (!formLike) {
      throw new ApplyAbort("FAILED", step === 0 ? "No application form or apply button found on the posting" : "The form disappeared before it could be submitted");
    }

    ctx.emit({ type: "progress", message: `Filling step ${step + 1} (${fillable.length} field(s))` });
    const plan = await buildPlan(ctx, scan);
    ctx.evidence.log(
      `plan: fills=${plan.fills.map((f) => f.key).join(",") || "-"} unmatched=${plan.unmatched.length} unfillable=${plan.unfillable.map((u) => u.key).join(",") || "-"} requiredMissing=${plan.requiredMissing.map(describeField).join(",") || "-"} confidence=${plan.confidence}`,
    );
    Object.assign(payload, await fillFields(ctx, scan, plan));
    for (const fill of plan.fills) filledSelectors.add(selectorKey(fill.field));
    if (ctx.profile.cv && !plan.fills.some((f) => f.key === "cv")) {
      const via = await uploadViaChooser(ctx, scan, options.upload ?? UPLOAD_BUTTON);
      if (via) payload[via] = ctx.profile.cv.name;
    }
    await snap(ctx, `filled-step-${step + 1}`);

    const submit = options.submit ? findButton(scan, options.submit) : findButton(scan, SUBMIT_BUTTON);
    const next = submit ? null : findButton(scan, NEXT_BUTTON);
    if (next) {
      ctx.emit({ type: "progress", message: `Continuing to the next step ("${next.text}")` });
      const outcome = await clickButton(ctx.page.context(), ctx.page, scan, next);
      ctx.page = outcome.page;
      scan = await rescan(ctx.page);
      guardPage(scan);
      continue;
    }
    if (!submit) throw new ApplyAbort("NEEDS_MANUAL", "Form filled but no submit button was recognised; submit it in the apply window");

    assertReadyToSubmit(ctx, plan);
    ctx.emit({ type: "progress", message: `Submitting ("${submit.text}")` });
    ctx.evidence.log(`submitting via "${submit.text}" with confidence ${plan.confidence}`);
    const before = scan;
    const outcome = await clickButton(ctx.page.context(), ctx.page, scan, submit);
    ctx.page = outcome.page;
    await ctx.page.waitForTimeout(1_500);
    scan = await scanPage(ctx.page);
    guardPage(scan);
    await snap(ctx, "after-submit");

    if (isConfirmed(before, scan, filledSelectors)) {
      lastConfirmation = scan.signals.bodyText.match(/.{0,80}(d[eě]kujeme|thank you|odesl[aá]n).{0,120}/i)?.[0]?.trim();
      return;
    }
    if (VALIDATION_TEXT.test(scan.signals.bodyText) && scan.fields.some((f) => filledSelectors.has(selectorKey(f)))) {
      throw new ApplyAbort("NEEDS_MANUAL", "The form reported validation errors after submitting; check the apply window");
    }
  }
  throw new ApplyAbort("NEEDS_MANUAL", "Could not confirm that the application was submitted; check the apply window");
}
