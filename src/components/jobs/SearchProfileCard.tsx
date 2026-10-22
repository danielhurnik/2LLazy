"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  CircularProgress,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { loadSearchProfile, rebuildSearchProfile } from "@/lib/actions/searchProfileActions";
import { loadRankerStatus, retrainRankerAction } from "@/lib/actions/jobFeedbackActions";
import type { SearchProfile } from "@/lib/jobs/profile";
import { ui, fonts } from "@/theme/tokens";

const SENIORITY_LABEL: Record<NonNullable<SearchProfile["seniority"]>, string> = {
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
};
const SOURCE_LABEL: Record<SearchProfile["source"], string> = {
  cv: "from your CV",
  "cv+ollama": "from your CV",
};
const DATE_LOCALE = "en-GB";
const LABEL_WIDTH = 96;
const COLLAPSED_VALUE_COUNT = 12;
const SKELETON_ROW_COUNT = 3;
const NOT_PERSONALISED = "Not personalised yet: save, apply to, or hide a few jobs.";

type RankerStatus = Awaited<ReturnType<typeof loadRankerStatus>>;

interface RankerNote {
  text: string;
  isError: boolean;
}

const formatBuiltAt = (iso: string) =>
  new Date(iso).toLocaleString(DATE_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatTrainedAt = (iso: string) =>
  new Date(iso).toLocaleString(DATE_LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function describeRanker(status: RankerStatus): string {
  if (!status?.trainedAt) return NOT_PERSONALISED;
  return `Learned from ${status.samples} signals (${status.positives} positive), last trained ${formatTrainedAt(status.trainedAt)}.`;
}

const notEnoughFeedback = (samples: number) =>
  `Not enough feedback yet (${samples} signals, needs 3+ positive and 3+ hidden).`;

const labelSx = {
  width: { sm: LABEL_WIDTH },
  flexShrink: 0,
  pt: "2px",
  fontFamily: fonts.mono,
  fontSize: "0.72rem",
  color: ui.textFaint,
} as const;

const moreLinkSx = {
  font: "inherit",
  color: ui.textMuted,
  textDecoration: "underline",
  textDecorationColor: ui.lineStrong,
  textUnderlineOffset: 3,
  verticalAlign: "baseline",
  "&:hover": { color: ui.text, textDecorationColor: ui.accent },
} as const;

function levelFacts(profile: SearchProfile): string[] {
  const facts: string[] = [];
  if (profile.seniority) facts.push(SENIORITY_LABEL[profile.seniority]);
  if (profile.remote) facts.push("Open to remote");
  return facts;
}

function ProfileRow({ label, values }: { label: string; values: string[] }) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (values.length === 0) return null;

  const hiddenCount = values.length - COLLAPSED_VALUE_COUNT;
  const shownValues = isExpanded || hiddenCount <= 0 ? values : values.slice(0, COLLAPSED_VALUE_COUNT);

  return (
    <Stack direction={{ xs: "column", sm: "row" }} gap={{ xs: 0.25, sm: 2 }}>
      <Typography sx={labelSx}>{label}</Typography>
      <Typography variant="body2" sx={{ color: ui.text, minWidth: 0 }}>
        {shownValues.join(" · ")}
        {hiddenCount > 0 && (
          <>
            {" "}
            <ButtonBase onClick={() => setIsExpanded((expanded) => !expanded)} sx={moreLinkSx}>
              {isExpanded ? "show less" : `+${hiddenCount} more`}
            </ButtonBase>
          </>
        )}
      </Typography>
    </Stack>
  );
}

function ProfileDetails({ profile }: { profile: SearchProfile }) {
  return (
    <Stack spacing={1.25}>
      <ProfileRow label="titles" values={profile.titles} />
      <ProfileRow label="skills" values={profile.skills} />
      <ProfileRow label="level" values={levelFacts(profile)} />
      <ProfileRow label="cities" values={profile.cities} />
      <ProfileRow label="languages" values={profile.languages} />
      {profile.summary && (
        <Typography variant="body2" sx={{ pt: 0.5, color: ui.textMuted }}>
          {profile.summary}
        </Typography>
      )}
      <Typography sx={{ fontFamily: fonts.mono, fontSize: "0.72rem", color: ui.textFaint }}>
        built {formatBuiltAt(profile.builtAt)} {SOURCE_LABEL[profile.source]}
      </Typography>
    </Stack>
  );
}

function RankerRow() {
  const [status, setStatus] = useState<RankerStatus>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [note, setNote] = useState<RankerNote | null>(null);
  const [isRetraining, startRetrain] = useTransition();

  useEffect(() => {
    loadRankerStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setIsLoaded(true));
  }, []);

  const retrain = () => {
    setNote(null);
    startRetrain(async () => {
      const result = await retrainRankerAction();
      if ("error" in result) {
        setNote({ text: `Retraining failed: ${result.error}`, isError: true });
        return;
      }
      if (!result.trained) {
        setNote({ text: notEnoughFeedback(result.samples), isError: false });
        return;
      }
      setStatus(await loadRankerStatus());
    });
  };

  return (
    <Stack direction={{ xs: "column", sm: "row" }} gap={{ xs: 0.25, sm: 2 }} sx={{ mb: 2.5 }}>
      <Typography sx={labelSx}>ranking</Typography>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: ui.text }}>
          {isLoaded ? describeRanker(status) : "Loading…"}{" "}
          <ButtonBase onClick={retrain} disabled={isRetraining || !isLoaded} sx={moreLinkSx}>
            {isRetraining ? "retraining…" : "retrain now"}
          </ButtonBase>
        </Typography>
        {note && (
          <Typography variant="body2" sx={{ mt: 0.25, color: note.isError ? ui.red : ui.textMuted }}>
            {note.text}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

function ProfileSkeleton() {
  return (
    <Stack spacing={1}>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
        <Skeleton key={index} variant="text" width={`${70 - index * 15}%`} />
      ))}
    </Stack>
  );
}

export function SearchProfileCard() {
  const [profile, setProfile] = useState<SearchProfile | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRebuilding, startRebuild] = useTransition();

  useEffect(() => {
    loadSearchProfile()
      .then((result) => setProfile(result.profile))
      .catch(() => setProfile(null))
      .finally(() => setIsLoaded(true));
  }, []);

  const rebuild = () => {
    setError(null);
    startRebuild(async () => {
      const result = await rebuildSearchProfile();
      if (result.error) setError(result.error);
      else setProfile(result.profile);
    });
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6">Search profile</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 2.5 }}>
          Read from your CV. Jobs that match these titles and skills rank higher in search.
        </Typography>

        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 2.5 }}>
          {!isLoaded && <ProfileSkeleton />}
          {isLoaded && profile && <ProfileDetails profile={profile} />}
          {isLoaded && !profile && (
            <Typography variant="body2" sx={{ color: ui.textMuted }}>
              No profile yet. Upload a CV above, then build one.
            </Typography>
          )}
        </Box>

        <RankerRow />

        <Button
          variant={profile ? "outlined" : "contained"}
          onClick={rebuild}
          disabled={isRebuilding || !isLoaded}
          startIcon={isRebuilding ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {isRebuilding ? "Building…" : profile ? "Rebuild from CV" : "Build from CV"}
        </Button>
      </CardContent>
    </Card>
  );
}
