export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { scheduleBackgroundRefresh } = await import("@/lib/jobs/refresh");
  scheduleBackgroundRefresh();
}
