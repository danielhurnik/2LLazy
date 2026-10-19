import { getCalendarEntriesForMonth } from "@/lib/data/interviews";
import { InterviewsClient } from "./_components/InterviewsClient";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const revalidate = 60;

const FIRST_MONTH = 1;
const LAST_MONTH = 12;
const EARLIEST_YEAR = 1970;
const LATEST_YEAR = 9999;

function integerInRange(value: string | undefined, min: number, max: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export default async function InterviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const today = new Date();
  const requestedMonth = integerInRange(params.month, FIRST_MONTH, LAST_MONTH);
  const requestedYear = integerInRange(params.year, EARLIEST_YEAR, LATEST_YEAR);
  const month = requestedMonth ?? today.getMonth() + 1;
  const year = requestedYear ?? today.getFullYear();
  const entries = await getCalendarEntriesForMonth(session.user.id, month, year);
  return (
    <InterviewsClient
      initialEntries={entries}
      month={month}
      year={year}
      followsLocalToday={requestedMonth === null && requestedYear === null}
    />
  );
}
