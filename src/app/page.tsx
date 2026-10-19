import { getSettingsData } from "@/lib/data/settings";
import { requireUserId } from "@/lib/auth/sessionManager";
import { SearchClient } from "./_components/SearchClient";

export default async function SearchPage() {
  const userId = await requireUserId();
  const { profile } = await getSettingsData(userId);
  return <SearchClient defaultCountry={profile.country} defaultCity={profile.city} />;
}
