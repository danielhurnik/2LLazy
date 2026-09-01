"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardActions,
  Chip,
  Stack,
  Box,
  Typography,
  IconButton,
  Button,
  Tooltip,
  CircularProgress,
  alpha,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import type { JobItem } from "@/types";
import { jobScore, sourceColor } from "@/types";
import { ios } from "@/theme/theme";

interface JobCardProps {
  job: JobItem;
  variant?: "search" | "favourites";
  isApplying?: boolean;
  isToggling?: boolean;
  onApply?: (job: JobItem) => void;
  onToggleFavourite: (job: JobItem) => void;
  onViewCoverLetter?: (coverLetter: { id: string; content: string }) => void;
}

export function JobCard({
  job,
  variant = "search",
  isApplying,
  isToggling,
  onApply,
  onToggleFavourite,
  onViewCoverLetter,
}: JobCardProps) {
  const score = jobScore(job);
  const matchPct = score > 0 ? Math.round(score * 100) : null;
  const matched = job.matched ?? [];
  const reasons = job.reasons ?? [];
  const [expanded, setExpanded] = useState(false);
  const longDesc = (job.description?.length ?? 0) > 200;

  // The percentage on its own is opaque, so the tooltip always says where it
  // came from — the ranker's own reasons when it sent any, the matched terms
  // otherwise.
  const matchExplanation = reasons.length
    ? reasons
    : matched.length
      ? [`Matched: ${matched.join(", ")}`]
      : ["Ranked on how well the posting matches your search terms."];

  return (
    <Card>
      <CardContent sx={{ pb: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1.5}>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography
              variant="h6"
              sx={{
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                lineHeight: 1.35,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {job.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {job.company}
              {job.location ? (
                <Box component="span" sx={{ color: ios.label3, mx: 0.5 }}>·</Box>
              ) : null}
              {job.location}
            </Typography>
          </Box>

          {/* Badges */}
          <Stack direction="row" spacing={0.75} alignItems="center" flexShrink={0}>
            {matchPct !== null && matchPct > 0 && (
              <Tooltip
                title={
                  <Box component="ul" sx={{ m: 0, pl: 2, py: 0.25 }}>
                    {matchExplanation.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </Box>
                }
                placement="top"
                arrow
              >
              <Chip
                label={`${matchPct}% match`}
                size="small"
                sx={{
                  background: matchPct >= 80
                    ? alpha(ios.green, 0.18)
                    : matchPct >= 60
                      ? alpha(ios.orange, 0.18)
                      : alpha(ios.label2, 0.1),
                  color: matchPct >= 80
                    ? ios.green
                    : matchPct >= 60
                      ? ios.orange
                      : ios.label2,
                  border: `1px solid ${
                    matchPct >= 80
                      ? alpha(ios.green, 0.3)
                      : matchPct >= 60
                        ? alpha(ios.orange, 0.3)
                        : ios.separatorOpaque
                  }`,
                  fontWeight: 700,
                  fontSize: "0.7rem",
                  height: 22,
                  cursor: "help",
                }}
              />
              </Tooltip>
            )}
            {job.isNew && (
              <Chip
                label="NEW"
                size="small"
                color="success"
                variant="outlined"
              />
            )}
            {job.isStale && !job.isNew && (
              <Chip
                label="CACHED"
                size="small"
                variant="outlined"
                sx={{
                  color: ios.label3,
                  borderColor: ios.label3,
                  fontSize: "0.65rem",
                  height: 20,
                }}
              />
            )}
            <Chip
              label={job.source}
              size="small"
              color={sourceColor(job.source)}
              variant="filled"
            />
          </Stack>
        </Stack>

        {job.salary && (
          <Typography
            variant="body2"
            sx={{
              mt: 1,
              color: ios.green,
              fontWeight: 600,
              fontSize: "0.8125rem",
            }}
          >
            {job.salary}
          </Typography>
        )}

        {matched.length > 0 && (
          <Stack direction="row" sx={{ mt: 1, flexWrap: "wrap", gap: 0.5 }}>
            {matched.slice(0, 6).map((term) => (
              <Chip
                key={term}
                label={term}
                size="small"
                variant="outlined"
                sx={{
                  height: 20,
                  fontSize: "0.68rem",
                  color: ios.teal,
                  borderColor: alpha(ios.teal, 0.35),
                  background: alpha(ios.teal, 0.08),
                  "& .MuiChip-label": { px: 0.75 },
                }}
              />
            ))}
            {matched.length > 6 && (
              <Typography variant="caption" sx={{ color: ios.label3, alignSelf: "center" }}>
                +{matched.length - 6} more
              </Typography>
            )}
          </Stack>
        )}

        <Box onClick={() => longDesc && setExpanded((v) => !v)} sx={longDesc ? { cursor: "pointer" } : undefined}>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              mt: 1.25,
              ...(!expanded && {
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }),
              lineHeight: 1.55,
              fontSize: "0.8125rem",
              color: ios.label2,
            }}
          >
            {job.description || "No description available."}
          </Typography>
          {longDesc && (
            <Typography
              variant="caption"
              sx={{ color: ios.blue, mt: 0.5, display: "block", userSelect: "none" }}
            >
              {expanded ? "Show less" : "Show more"}
            </Typography>
          )}
        </Box>
      </CardContent>

      {/* Separator */}
      <Box sx={{ mx: 2, height: "1px", background: ios.separator }} />

      <CardActions sx={{ px: 2, py: 1.25, gap: 0.75 }}>
        {variant === "search" ? (
          <Button
            size="small"
            variant={job.favourited ? "contained" : "outlined"}
            color={job.favourited ? "success" : "primary"}
            startIcon={
              isToggling ? (
                <CircularProgress size={13} color="inherit" />
              ) : job.favourited ? (
                <BookmarkIcon fontSize="small" />
              ) : (
                <BookmarkBorderIcon fontSize="small" />
              )
            }
            onClick={() => onToggleFavourite(job)}
            disabled={isToggling}
            sx={{
              ...(job.favourited && {
                background: alpha(ios.green, 0.18),
                color: ios.green,
                borderColor: alpha(ios.green, 0.3),
                "&:hover": {
                  background: alpha(ios.green, 0.25),
                },
              }),
            }}
          >
            {job.favourited ? "Saved" : "Save"}
          </Button>
        ) : (
          <>
            <Button
              size="small"
              variant="contained"
              startIcon={isApplying ? <CircularProgress size={13} color="inherit" /> : <SendIcon fontSize="small" />}
              onClick={() => onApply?.(job)}
              disabled={isApplying}
            >
              {isApplying ? "Tracking…" : "Track"}
            </Button>

            <Tooltip title="Remove from saved">
              <IconButton
                size="small"
                onClick={() => onToggleFavourite(job)}
                disabled={isToggling}
                sx={{
                  ml: "auto",
                  color: ios.orange,
                  "&:hover": { background: alpha(ios.orange, 0.1) },
                }}
              >
                {isToggling ? (
                  <CircularProgress size={15} />
                ) : (
                  <BookmarkIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </>
        )}

        <Tooltip title="Open job posting" sx={variant === "search" ? { ml: "auto" } : undefined}>
          <IconButton
            size="small"
            component="a"
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ color: ios.label2, "&:hover": { color: ios.label1 } }}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </CardActions>
    </Card>
  );
}
