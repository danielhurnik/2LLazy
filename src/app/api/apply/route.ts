import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Auto-apply drives a real browser, which is opt-in for the same reason the
  // browser boards are: it needs Chromium installed. Without it the button
  // degrades to opening the posting for a manual application.
  if (process.env.PLAYWRIGHT_ENABLED !== "true") {
    return NextResponse.json({ status: "MANUAL_REQUIRED" });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({})) as { applicationId?: string };
  const { applicationId } = body;
  if (!applicationId || !/^[a-z0-9]{15,30}$/i.test(applicationId)) {
    return NextResponse.json({ error: "Missing or invalid applicationId" }, { status: 400 });
  }

  try {
    // Lazy imports — the browser stack loads only when auto-apply actually runs
    const { prisma } = await import("@/lib/prisma");
    const { applyRouter } = await import("@/lib/apply/applyRouter");

    // Load application + job
    const application = await prisma.application.findUnique({
      where: { id: applicationId, userId },
      include: {
        job: true,
        coverLetter: true,
      },
    });

    if (!application) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const { job, coverLetter } = application;

    // Load user profile
    const userProfile = await prisma.userProfile.findUnique({ where: { userId } });
    if (!userProfile) {
      return NextResponse.json({ error: "User profile not set up yet" }, { status: 400 });
    }

    // Load latest CV document
    const cvDocument = await prisma.cvDocument.findFirst({
      where: { userId },
      orderBy: { uploadedAt: "desc" },
    });

    const profile = {
      name: userProfile.name,
      email: userProfile.email,
      phone: userProfile.phone,
      linkedInUrl: userProfile.linkedInUrl,
      githubUrl: userProfile.githubUrl,
      coverLetterText: coverLetter?.content ?? null,
    };

    const cvBuffer = cvDocument ? Buffer.from(cvDocument.data) : undefined;

    const result = await applyRouter(job.source, job.sourceUrl, profile, cvBuffer);

    // Update application status in DB (store full errorMessage for debugging)
    const statusMap = {
      APPLIED: "APPLIED",
      FAILED: "FAILED",
      MANUAL_REQUIRED: "PENDING", // Keep as pending so user knows to act
    } as const;

    await prisma.application.update({
      where: { id: applicationId },
      data: {
        status: statusMap[result.status],
        appliedAt: result.status === "APPLIED" ? new Date() : undefined,
        errorMessage: result.errorMessage ?? null,
      },
    });

    // Return only status — errorMessage may contain internal paths/stack traces
    return NextResponse.json({ status: result.status });
  } catch {
    return NextResponse.json({ error: "An unexpected error occurred" }, { status: 500 });
  }
}
