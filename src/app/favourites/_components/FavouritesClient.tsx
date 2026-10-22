"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Box, Button } from "@mui/material";
import { ALL_OPTION, JobFilterBar, type JobFilters } from "@/components/jobs/JobFilterBar";
import { ErrorAlertList } from "@/components/ui/ErrorAlertList";
import { PageHeader } from "@/components/ui/PageHeader";
import { toggleFavourite, trackJob } from "@/lib/actions/jobActions";
import { FavouritesJobList } from "./FavouritesJobList";
import type { JobItem } from "@/types";

interface Props {
  jobs: JobItem[];
  filters: JobFilters;
  sources: string[];
}

interface JobActionOptions {
  setBusyJobId: (jobId: string | null) => void;
  run: () => Promise<unknown>;
  describeFailure: (error: unknown) => string;
}

interface TrackRefusal {
  job: JobItem;
  reason: string;
}

const FAVOURITES_PATH = "/favourites";

interface TrackRefusalNoticeProps {
  refusal: TrackRefusal | null;
  isTracking: boolean;
  onTrackAnyway: (job: JobItem) => void;
  onDismiss: () => void;
}

function TrackRefusalNotice({ refusal, isTracking, onTrackAnyway, onDismiss }: TrackRefusalNoticeProps) {
  if (!refusal) return null;
  return (
    <Alert
      severity="info"
      onClose={onDismiss}
      sx={{ mb: 1 }}
      action={
        <Button size="small" color="inherit" disabled={isTracking} onClick={() => onTrackAnyway(refusal.job)}>
          {isTracking ? "Tracking…" : "Track anyway"}
        </Button>
      }
    >
      {refusal.job.title}: {refusal.reason}
    </Alert>
  );
}

function favouritesHref({ source, position, hasSalary }: JobFilters): string {
  const params = new URLSearchParams();
  if (source !== ALL_OPTION) params.set("source", source);
  if (position) params.set("position", position);
  if (hasSalary) params.set("hasSalary", "true");
  return params.size > 0 ? `${FAVOURITES_PATH}?${params.toString()}` : FAVOURITES_PATH;
}

export function FavouritesClient({ jobs, filters, sources }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<TrackRefusal | null>(null);

  const addError = (message: string) => setErrors((previous) => [...previous, message]);
  const dismissError = (index: number) =>
    setErrors((previous) => previous.filter((_, errorIndex) => errorIndex !== index));

  const runJobAction = (job: JobItem, { setBusyJobId, run, describeFailure }: JobActionOptions) => {
    setBusyJobId(job.id);
    startTransition(async () => {
      try {
        await run();
        router.refresh();
      } catch (err) {
        addError(describeFailure(err));
      } finally {
        setBusyJobId(null);
      }
    });
  };

  const handleToggle = (job: JobItem) =>
    runJobAction(job, {
      setBusyJobId: setTogglingId,
      run: () => toggleFavourite(job.id),
      describeFailure: (err) => `Failed: ${String(err)}`,
    });

  const track = (job: JobItem, force: boolean) =>
    runJobAction(job, {
      setBusyJobId: setTrackingId,
      run: async () => {
        const outcome = await trackJob(job.id, { force });
        if (outcome.tracked) setRefusal(null);
        else if (outcome.canOverride) setRefusal({ job, reason: outcome.reason });
        else addError(outcome.reason);
      },
      describeFailure: (err) => `Track failed for ${job.title}: ${String(err)}`,
    });

  return (
    <Box>
      <PageHeader
        title="Saved jobs"
        meta={`${jobs.length} saved · Track one to move it to your dashboard`}
      />

      <ErrorAlertList errors={errors} onDismiss={dismissError} />
      <TrackRefusalNotice
        refusal={refusal}
        isTracking={trackingId !== null && trackingId === refusal?.job.id}
        onTrackAnyway={(job) => track(job, true)}
        onDismiss={() => setRefusal(null)}
      />

      <JobFilterBar
        variant="basic"
        sources={sources}
        filters={filters}
        onChange={(nextFilters) => router.replace(favouritesHref(nextFilters))}
      />

      <FavouritesJobList
        jobs={jobs}
        trackingId={trackingId}
        togglingId={togglingId}
        onTrack={(job) => track(job, false)}
        onToggleFavourite={handleToggle}
      />
    </Box>
  );
}
