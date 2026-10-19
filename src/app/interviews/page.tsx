import { getCalendarEntriesForMonth } from "@/lib/data/interviews";
import { InterviewsClient } from "./_components/InterviewsClient";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const revalidate = 60;

export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const today = new Date();
  const month = Number(params.month ?? today.getMonth() + 1);
  const year = Number(params.year ?? today.getFullYear());
  const entries = await getCalendarEntriesForMonth(session.user.id, month, year);
  return <InterviewsClient initialEntries={entries} month={month} year={year} />;
}
