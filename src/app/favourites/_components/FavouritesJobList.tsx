import { Stack, Button } from "@mui/material";
import Link from "next/link";
import { JobCard } from "@/components/jobs/JobCard";
import { EmptyState } from "@/components/ui/EmptyState";
import type { JobItem } from "@/types";

interface Props {
  jobs: JobItem[];
  trackingId: string | null;
  togglingId: string | null;
  onTrack: (job: JobItem) => void;
  onToggleFavourite: (job: JobItem) => void;
}

function NoSavedJobs() {
  return (
    <EmptyState
      title="No saved jobs"
      action={
        <Button component={Link} href="/" variant="outlined" size="small">
          Search jobs
        </Button>
      }
    >
      Press Save on a search result and it lands here, ready to track.
    </EmptyState>
  );
}

export function FavouritesJobList({
  jobs,
  trackingId,
  togglingId,
  onTrack,
  onToggleFavourite,
}: Props) {
  if (jobs.length === 0) return <NoSavedJobs />;

  return (
    <Stack spacing={1.25}>
      {jobs.map((job) => (
        <JobCard
          key={job.id}
          job={job}
          variant="favourites"
          isApplying={trackingId === job.id}
          isToggling={togglingId === job.id}
          onApply={onTrack}
          onToggleFavourite={onToggleFavourite}
        />
      ))}
    </Stack>
  );
}
