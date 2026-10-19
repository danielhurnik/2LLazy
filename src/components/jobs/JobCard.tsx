"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  Chip,
  Stack,
  Box,
  Typography,
  IconButton,
  Button,
  Tooltip,
  CircularProgress,
  ButtonBase,
  alpha,
} from "@mui/material";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import type { JobItem } from "@/types";
import { sourceLabel } from "@/types";
import { ui, fonts } from "@/theme/tokens";

interface JobCardProps {
  job: JobItem;
  variant?: "search" | "favourites";
  isApplying?: boolean;
  isToggling?: boolean;
  onApply?: (job: JobItem) => void;
  onToggleFavourite: (job: JobItem) => void;
}

const LONG_DESCRIPTION_LENGTH = 200;
const COLLAPSED_DESCRIPTION_LINES = 3;
const STRONG_MATCH_PERCENT = 60;
const BUTTON_SPINNER_SIZE = 13;
const ICON_BUTTON_SPINNER_SIZE = 15;
const MATCH_SCORE_HINT = "How closely the posting matches your search";
const REMOVE_FROM_SAVED_LABEL = "Remove from saved";

export const lineClampSx = (lines: number) => ({
  display: "-webkit-box",
  WebkitLineClamp: lines,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
}) as const;

const savedButtonSx = {
  color: ui.accent,
  borderColor: alpha(ui.accent, 0.4),
  "&:hover": { borderColor: ui.accent, backgroundColor: alpha(ui.accent, 0.08) },
};

interface JobHeadingProps {
  title: string;
  company: string;
  location: string;
}

export function JobHeading({ title, company, location }: JobHeadingProps) {
  return (
    <Box sx={{ minWidth: 0, flexGrow: 1 }}>
      <Typography variant="h6" noWrap title={title}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ color: ui.textMuted, mt: 0.25 }} noWrap>
        {company}
        {location && <Box component="span" sx={{ color: ui.textFaint, mx: 0.75 }}>·</Box>}
        {location}
      </Typography>
    </Box>
  );
}

interface SourceLinkChipProps {
  source: string;
  sourceUrl: string;
}

export function SourceLinkChip({ source, sourceUrl }: SourceLinkChipProps) {
  const boardName = sourceLabel(source);
  return (
    <Chip
      label={`${boardName} ↗`}
      size="small"
      component="a"
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      clickable
      aria-label={`Open posting on ${boardName}`}
    />
  );
}

interface MatchScoreProps {
  similarity?: number;
  matchReasons?: string[];
}

function MatchScore({ similarity, matchReasons }: MatchScoreProps) {
  if (similarity == null) return null;

  const matchPercent = Math.round(similarity * 100);
  const isPositiveMatch = matchPercent > 0;
  if (!isPositiveMatch) return null;

  const tooltipContent = matchReasons?.length ? (
    <Box component="ul" sx={{ m: 0, pl: 2 }}>
      {matchReasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </Box>
  ) : (
    MATCH_SCORE_HINT
  );

  return (
    <Tooltip title={tooltipContent}>
      <Typography
        sx={{
          flexShrink: 0,
          fontFamily: fonts.mono,
          fontSize: "0.75rem",
          color: matchPercent >= STRONG_MATCH_PERCENT ? ui.text : ui.textMuted,
          whiteSpace: "nowrap",
          pt: "2px",
        }}
      >
        {matchPercent}%<Box component="span" sx={{ color: ui.textFaint, ml: 0.5 }}>match</Box>
      </Typography>
    </Tooltip>
  );
}

function ExpandableDescription({ description }: { description: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLongDescription = (description?.length ?? 0) > LONG_DESCRIPTION_LENGTH;
  const toggleExpanded = () => setIsExpanded((expanded) => !expanded);

  return (
    <>
      <Box
        onClick={isLongDescription ? toggleExpanded : undefined}
        sx={isLongDescription ? { cursor: "pointer" } : undefined}
      >
        <Typography
          variant="body2"
          sx={{
            mt: 1.25,
            color: ui.textMuted,
            ...(!isExpanded && lineClampSx(COLLAPSED_DESCRIPTION_LINES)),
          }}
        >
          {description || "No description available."}
        </Typography>
      </Box>
      {isLongDescription && (
        <ButtonBase
          onClick={toggleExpanded}
          sx={{
            mt: 0.5,
            fontSize: "0.75rem",
            color: ui.textFaint,
            textDecoration: "underline",
            textUnderlineOffset: 3,
            "&:hover": { color: ui.text },
          }}
        >
          {isExpanded ? "Show less" : "Show more"}
        </ButtonBase>
      )}
    </>
  );
}

interface SaveStateIconProps {
  isSaved?: boolean;
  isToggling?: boolean;
}

function SaveStateIcon({ isSaved, isToggling }: SaveStateIconProps) {
  if (isToggling) return <CircularProgress size={BUTTON_SPINNER_SIZE} color="inherit" />;
  return isSaved ? <BookmarkIcon /> : <BookmarkBorderIcon />;
}

interface SaveToggleButtonProps {
  isSaved?: boolean;
  isToggling?: boolean;
  onToggle: () => void;
}

function SaveToggleButton({ isSaved, isToggling, onToggle }: SaveToggleButtonProps) {
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<SaveStateIcon isSaved={isSaved} isToggling={isToggling} />}
      onClick={onToggle}
      disabled={isToggling}
      sx={isSaved ? savedButtonSx : undefined}
    >
      {isSaved ? "Saved" : "Save"}
    </Button>
  );
}

interface SavedJobActionsProps {
  isTracking?: boolean;
  isRemoving?: boolean;
  onTrack: () => void;
  onRemove: () => void;
}

function SavedJobActions({ isTracking, isRemoving, onTrack, onRemove }: SavedJobActionsProps) {
  return (
    <>
      <Button
        size="small"
        variant="contained"
        startIcon={isTracking ? <CircularProgress size={BUTTON_SPINNER_SIZE} color="inherit" /> : undefined}
        onClick={onTrack}
        disabled={isTracking}
      >
        {isTracking ? "Tracking…" : "Track"}
      </Button>
      <Tooltip title={REMOVE_FROM_SAVED_LABEL}>
        <span>
          <IconButton
            size="small"
            onClick={onRemove}
            disabled={isRemoving}
            aria-label={REMOVE_FROM_SAVED_LABEL}
            sx={{ color: ui.accent }}
          >
            {isRemoving
              ? <CircularProgress size={ICON_BUTTON_SPINNER_SIZE} color="inherit" />
              : <BookmarkIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
    </>
  );
}

function FreshnessChip({ isNew, isStale }: { isNew?: boolean; isStale?: boolean }) {
  if (isNew) return <Chip label="New" size="small" color="primary" />;
  if (isStale) return <Chip label="Cached" size="small" />;
  return null;
}

export function JobCard({
  job,
  variant = "search",
  isApplying,
  isToggling,
  onApply,
  onToggleFavourite,
}: JobCardProps) {
  const toggleFavourite = () => onToggleFavourite(job);

  return (
    <Card
      data-testid="job-card"
      sx={{ transition: "border-color 120ms ease", "&:hover": { borderColor: ui.lineStrong } }}
    >
      <CardContent sx={{ pb: "14px !important" }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={2}>
          <JobHeading title={job.title} company={job.company} location={job.location} />
          <MatchScore similarity={job.similarity} matchReasons={job.matchReasons} />
        </Stack>

        {job.salary && (
          <Typography sx={{ mt: 1, fontFamily: fonts.mono, fontSize: "0.78rem", color: ui.text }}>
            {job.salary}
          </Typography>
        )}

        <ExpandableDescription description={job.description} />

        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ mt: 1.75, pt: 1.5, borderTop: `1px solid ${ui.line}` }}
        >
          {variant === "search" ? (
            <SaveToggleButton
              isSaved={job.favourited}
              isToggling={isToggling}
              onToggle={toggleFavourite}
            />
          ) : (
            <SavedJobActions
              isTracking={isApplying}
              isRemoving={isToggling}
              onTrack={() => onApply?.(job)}
              onRemove={toggleFavourite}
            />
          )}

          <Box sx={{ flexGrow: 1 }} />

          <FreshnessChip isNew={job.isNew} isStale={job.isStale} />
          <SourceLinkChip source={job.source} sourceUrl={job.sourceUrl} />
        </Stack>
      </CardContent>
    </Card>
  );
}
