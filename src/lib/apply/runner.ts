import { revalidatePath } from "next/cache";
import { readCvText } from "@/lib/cv";
import { prisma } from "@/lib/prisma";
import { findAdapter } from "./adapters";
import { applyMutex, openApplyPage, releasePage, withApplyLock } from "./browser";
import { Evidence } from "./evidence";
import { runGenericFlow } from "./formFiller";
import { waitingApplicationIds } from "./humanWait";
import { settle } from "./pageActions";
import { ApplyAbort, type ApplyContext, type ApplyEvent, type ApplyFile, type ApplyJob, type ApplyProfile, type ApplyResult } from "./types";

export interface ApplyInput {
  applicationId: string;
  userId: string;
  job: ApplyJob;
  profile: ApplyProfile;
}

interface ApplyLoadError {
  code: 404 | 409 | 422;
  message: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
};

const hotReloadSafeGlobals = globalThis as unknown as { applyRunningIds?: Set<string> };
const running = (hotReloadSafeGlobals.applyRunningIds ??= new Set<string>());
const IN_PROGRESS_STATUSES = ["APPLYING", "WAITING_FOR_USER"] as const;
const STALE_RUN_MESSAGE = "The run stopped when the server restarted; finish it by hand or auto apply again";

interface RunApplyOptions {
  autoSubmit?: boolean;
}

function isApplyRunning(applicationId: string): boolean {
  return running.has(applicationId);
}

function hasLiveRun(applicationId: string): boolean {
  return isApplyRunning(applicationId) || waitingApplicationIds().includes(applicationId);
}

export async function sweepStaleApplyRuns(userId?: string): Promise<number> {
  const rows = await prisma.application.findMany({
    where: { status: { in: [...IN_PROGRESS_STATUSES] }, ...(userId ? { userId } : {}) },
    select: { id: true },
  });
  const stale = rows.map((row) => row.id).filter((id) => !hasLiveRun(id));
  if (stale.length === 0) return 0;
  await prisma.application.updateMany({
    where: { id: { in: stale } },
    data: { status: "NEEDS_MANUAL", errorMessage: STALE_RUN_MESSAGE },
  });
  refreshDashboardWhenInsideRequestScope();
  return stale.length;
}

function refreshDashboardWhenInsideRequestScope(): void {
  try {
    revalidatePath("/dashboard");
  } catch {
    return;
  }
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function latestCv(userId: string): Promise<ApplyFile | null> {
  const cv = await prisma.cvDocument.findFirst({ where: { userId }, orderBy: { uploadedAt: "desc" } });
  if (!cv) return null;
  const extension = cv.originalName.split(".").pop()?.toLowerCase() ?? "";
  return {
    name: cv.originalName,
    mimeType: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
    buffer: Buffer.from(cv.data),
  };
}

export async function loadApplyInput(applicationId: string, userId: string): Promise<ApplyInput | ApplyLoadError> {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    include: { job: true, user: { include: { userProfile: true } } },
  });
  if (!application) return { code: 404, message: "Application not found" };
  const inProgress = (IN_PROGRESS_STATUSES as readonly string[]).includes(application.status);
  if (inProgress && !hasLiveRun(applicationId)) {
    await prisma.application
      .update({ where: { id: applicationId }, data: { status: "NEEDS_MANUAL", errorMessage: STALE_RUN_MESSAGE } })
      .catch(() => undefined);
  } else if (inProgress || isApplyRunning(applicationId)) {
    return { code: 409, message: "This application is already being submitted" };
  }
  const userProfile = application.user.userProfile;
  const name = (userProfile?.name || application.user.name || "").trim();
  const email = (userProfile?.email || application.user.email || "").trim();
  if (!name || !email) return { code: 422, message: "Fill in your name and e-mail in Settings before auto-applying" };
  if (!/^https?:\/\//i.test(application.job.sourceUrl)) return { code: 422, message: "The job posting has no usable URL" };

  const cvText = await readCvText(userId).catch(() => "");
  return {
    applicationId,
    userId,
    job: {
      id: application.job.id,
      title: application.job.title,
      company: application.job.company,
      sourceUrl: application.job.sourceUrl,
      source: application.job.source,
      description: application.job.description,
      skills: application.job.skills,
    },
    profile: {
      name,
      ...splitName(name),
      email,
      phone: userProfile?.phone?.trim() || null,
      linkedInUrl: userProfile?.linkedInUrl?.trim() || null,
      githubUrl: userProfile?.githubUrl?.trim() || null,
      city: userProfile?.city?.trim() || null,
      country: userProfile?.country ?? "CZ",
      cv: await latestCv(userId),
      cvText: cvText.trim() || null,
    },
  };
}

async function executeInBrowser(
  input: ApplyInput,
  evidence: Evidence,
  emit: (event: ApplyEvent) => void,
  autoSubmit: boolean,
): Promise<{ result: ApplyResult; via: string }> {
  emit({ type: "progress", message: autoSubmit ? "Opening the apply browser" : "Opening the apply browser (dry run, nothing will be submitted)" });
  const page = await openApplyPage();
  const setWaiting = async (message: string | null) => {
    await prisma.application
      .update({
        where: { id: input.applicationId },
        data: message
          ? { status: "WAITING_FOR_USER", errorMessage: `Waiting for you: ${message}` }
          : { status: "APPLYING", errorMessage: null },
      })
      .catch(() => undefined);
    refreshDashboardWhenInsideRequestScope();
  };
  const ctx: ApplyContext = {
    applicationId: input.applicationId,
    page,
    profile: input.profile,
    job: input.job,
    evidence,
    emit,
    setWaiting,
    lock: applyMutex,
    autoSubmit,
  };
  const adapter = findAdapter(new URL(input.job.sourceUrl));
  const via = adapter?.id ?? "generic";
  evidence.log(`run start job=${input.job.id} url=${input.job.sourceUrl} adapter=${via} cv=${input.profile.cv?.name ?? "none"}`);
  let result: ApplyResult;
  try {
    emit({ type: "progress", message: `Opening ${new URL(input.job.sourceUrl).hostname}` });
    await page.goto(input.job.sourceUrl, { waitUntil: "domcontentloaded" });
    await settle(page);
    result = adapter ? await adapter.run(ctx) : await runGenericFlow(ctx);
  } catch (err) {
    if (err instanceof ApplyAbort) {
      result = { status: err.status, message: err.message, submitted: err.submitted };
    } else {
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      result = { status: "FAILED", message };
      await evidence.screenshot(ctx.page, "failure").catch(() => null);
    }
  }
  evidence.log(`result ${result.status}${result.message ? `: ${result.message}` : ""}`);
  if (result.submitted) await evidence.savePayload(result.submitted).catch(() => undefined);
  releasePage(page);
  releasePage(ctx.page);
  if (result.status !== "NEEDS_MANUAL") {
    await ctx.page.close().catch(() => undefined);
    if (ctx.page !== page) await page.close().catch(() => undefined);
  }
  return { result, via };
}

export async function runApply(input: ApplyInput, emit: (event: ApplyEvent) => void, options: RunApplyOptions = {}): Promise<void> {
  const { applicationId } = input;
  const autoSubmit = options.autoSubmit ?? true;
  running.add(applicationId);
  const evidence = new Evidence(applicationId);
  try {
    await evidence.init();
    await prisma.application.update({
      where: { id: applicationId },
      data: { status: "APPLYING", errorMessage: null, evidencePath: evidence.relativeDir },
    });
    refreshDashboardWhenInsideRequestScope();

    let outcome: { result: ApplyResult; via: string };
    try {
      outcome = await withApplyLock(() => executeInBrowser(input, evidence, emit, autoSubmit));
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      evidence.log(`browser failure: ${message}`);
      outcome = { result: { status: "FAILED", message }, via: "generic" };
    }
    const { result, via } = outcome;
    await evidence.flush().catch(() => undefined);

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        status: result.status,
        appliedAt: result.status === "APPLIED" ? new Date() : undefined,
        errorMessage: result.status === "APPLIED" ? null : (result.message ?? null),
        appliedVia: result.status === "APPLIED" ? via : null,
      },
    });
    refreshDashboardWhenInsideRequestScope();
    emit({ type: "done", status: result.status, evidenceUrl: evidence.urlFor(), message: result.message });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.application
      .update({ where: { id: applicationId }, data: { status: "FAILED", errorMessage: message } })
      .catch(() => undefined);
    refreshDashboardWhenInsideRequestScope();
    emit({ type: "error", message });
  } finally {
    running.delete(applicationId);
  }
}
