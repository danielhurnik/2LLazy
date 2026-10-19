import { Stack, Typography, Button } from "@mui/material";
import Link from "next/link";
import { ApplicationCard } from "@/components/dashboard/ApplicationCard";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Application, AppStatus } from "@/types";
import { ui, fonts } from "@/theme/theme";

interface Props {
  applications: Application[];
  isSaving: boolean;
  onStatusClick: (id: string, status: AppStatus) => void;
  onClearFilters?: () => void;
}

function NoMatchingApplications({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <EmptyState
      title="No applications match these filters"
      action={
        <Button variant="outlined" size="small" onClick={onClearFilters}>
          Clear filters
        </Button>
      }
    />
  );
}

function NothingTrackedYet() {
  return (
    <EmptyState
      title="Nothing tracked yet"
      action={
        <Button component={Link} href="/favourites" variant="outlined" size="small">
          Open saved jobs
        </Button>
      }
    >
      Save a job from Search, then press Track on it. It shows up here with its status
      and your notes.
    </EmptyState>
  );
}

function SavingIndicator() {
  return (
    <Typography sx={{ mb: 1, fontFamily: fonts.mono, fontSize: "0.75rem", color: ui.textFaint }}>
      Saving…
    </Typography>
  );
}

export function ApplicationList({
  applications,
  isSaving,
  onStatusClick,
  onClearFilters,
}: Props) {
  if (applications.length === 0) {
    return onClearFilters
      ? <NoMatchingApplications onClearFilters={onClearFilters} />
      : <NothingTrackedYet />;
  }

  return (
    <>
      {isSaving && <SavingIndicator />}
      <Stack spacing={1.25}>
        {applications.map((application) => (
          <ApplicationCard
            key={application.id}
            application={application}
            onStatusClick={onStatusClick}
          />
        ))}
      </Stack>
    </>
  );
}
