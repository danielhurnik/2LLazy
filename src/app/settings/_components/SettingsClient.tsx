import { Box } from "@mui/material";
import { PageHeader } from "@/components/ui/PageHeader";
import { UserProfileCard } from "./UserProfileCard";
import { CvDocumentsCard } from "./CvDocumentsCard";
import { GoogleCalendarCard } from "./GoogleCalendarCard";
import { SearchProfileCard } from "@/components/jobs/SearchProfileCard";
import type { UploadedFile, UserProfile } from "@/types";

interface Props {
  profile: UserProfile;
  uploadedFiles: UploadedFile[];
  hasCalendarAccess: boolean;
}

export function SettingsClient({
  profile,
  uploadedFiles,
  hasCalendarAccess,
}: Props) {
  return (
    <Box sx={{ maxWidth: 760 }}>
      <PageHeader title="Settings" />
      <GoogleCalendarCard enabled={profile.googleCalendarSync} hasCalendarAccess={hasCalendarAccess} />
      <UserProfileCard profile={profile} />
      <CvDocumentsCard uploadedFiles={uploadedFiles} />
      <SearchProfileCard />
    </Box>
  );
}
