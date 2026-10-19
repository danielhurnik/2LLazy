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
  for (const entry of plan.unfillable) {
    const wantsText = (entry.key === "message" || entry.key === "coverLetter") && entry.field.tag === "textarea";
    if (!wantsText || !entry.field.required) continue;
    ctx.emit({ type: "progress", message: `Drafting "${describeField(entry.field)}" with Ollama` });
    const text = await draftFreeText(entry.field, profile, ctx.job);
    if (text) plan.fills.push({ field: entry.field, key: entry.key, score: 0.6, value: { kind: "text", value: text } });
  }
  return finalizePlan(plan, scan.fields);
}

async function applyFill(scan: PageScan, fill: PlannedFill): Promise<void> {
  const locator = locatorFor(scan, fill.field);
  switch (fill.value.kind) {
    case "text":
      await locator.fill(fill.value.value, { timeout: 5_000 });
      return;
    case "file":
      await locator.setInputFiles({ name: fill.value.file.name, mimeType: fill.value.file.mimeType, buffer: fill.value.file.buffer }, { timeout: 5_000 });
      return;
    case "select":
      await locator.selectOption(fill.value.value, { timeout: 5_000 });
      return;
    case "check": {
      const checked = await locator.isChecked({ timeout: 2_000 }).catch(() => false);
      if (checked === fill.value.value) return;
      try {
        await locator.setChecked(fill.value.value, { timeout: 3_000 });
      } catch {
        await locator.evaluate((el) => ((el as HTMLInputElement).labels?.[0] ?? (el as HTMLElement)).click());
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

export async function fillFields(ctx: ApplyContext, scan: PageScan, plan: FillPlan): Promise<Record<string, string>> {
  const payload: Record<string, string> = {};
  const failed: PlannedFill[] = [];
  for (const fill of plan.fills) {
    const label = describeField(fill.field);
    try {
      await applyFill(scan, fill);
      payload[label] = payloadValue(fill);
      ctx.evidence.log(`filled ${label} <- ${fill.key} (${fill.score.toFixed(2)})`);
    } catch (err) {
      failed.push(fill);
      ctx.evidence.log(`could not fill ${label}: ${(err as Error).message.split("\n")[0]}`);
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
