import { Box, Typography } from "@mui/material";
import { ScraperStatusCard } from "./ScraperStatusCard";
import { UserProfileCard } from "./UserProfileCard";
import { CvDocumentsCard } from "./CvDocumentsCard";
import { GoogleCalendarCard } from "./GoogleCalendarCard";
import type { BoardStatus, UploadedFile, UserProfile } from "@/types";

interface Props {
  profile: UserProfile;
  uploadedFiles: UploadedFile[];
  country: string;
  countryName: string;
  boards: BoardStatus[];
  playwrightEnabled: boolean;
  hasCalendarAccess: boolean;
}

export function SettingsClient({
  profile,
  uploadedFiles,
  country,
  countryName,
  boards,
  playwrightEnabled,
  hasCalendarAccess,
}: Props) {
  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Your profile, CV documents, and the job boards your searches use.
        </Typography>
      </Box>
      <ScraperStatusCard
        country={country}
        countryName={countryName}
        boards={boards}
        playwrightEnabled={playwrightEnabled}
      />
      <GoogleCalendarCard enabled={profile.googleCalendarSync} hasCalendarAccess={hasCalendarAccess} />
      <UserProfileCard profile={profile} />
      <CvDocumentsCard uploadedFiles={uploadedFiles} />
    </Box>
  );
}
