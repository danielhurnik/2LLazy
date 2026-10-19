"use client";

import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { ui, fonts } from "@/theme/tokens";

interface EvidenceDialogProps {
  evidenceUrl: string;
  title: string;
  onClose: () => void;
}

type EvidenceListing =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "loaded"; files: string[] };

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
const FILE_EXTENSION = /\.[^.]+$/;
const STEP_SEPARATOR = /[-_]+/g;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function filesFromListing(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null || !("files" in body)) return null;
  return isStringArray(body.files) ? body.files : null;
}

const fileUrl = (evidenceUrl: string, file: string) =>
  `${evidenceUrl.replace(/\/+$/, "")}/${encodeURIComponent(file)}`;

const stepCaption = (file: string) => file.replace(FILE_EXTENSION, "").replace(STEP_SEPARATOR, " ");

async function fetchEvidenceListing(evidenceUrl: string): Promise<EvidenceListing> {
  try {
    const response = await fetch(evidenceUrl);
    if (!response.ok) return { state: "failed", message: `Evidence unavailable (HTTP ${response.status}).` };
    const files = filesFromListing(await response.json());
    return files ? { state: "loaded", files: [...files].sort() } : { state: "failed", message: "Evidence listing was empty." };
  } catch {
    return { state: "failed", message: "Evidence could not be loaded." };
  }
}

const fileLinkSx = {
  fontFamily: fonts.mono,
  fontSize: "0.75rem",
  color: ui.textMuted,
  textDecoration: "underline",
  textDecorationColor: ui.lineStrong,
  textUnderlineOffset: 3,
  "&:hover": { color: ui.text, textDecorationColor: ui.accent },
} as const;

function EvidenceFiles({ evidenceUrl, files }: { evidenceUrl: string; files: string[] }) {
  const screenshots = files.filter((file) => IMAGE_FILE.test(file));
  const records = files.filter((file) => !IMAGE_FILE.test(file));

  if (files.length === 0) {
    return <Typography variant="body2" sx={{ color: ui.textMuted }}>No files were recorded for this run.</Typography>;
  }

  return (
    <Stack spacing={2.5}>
      {screenshots.map((file) => (
        <Box key={file} component="figure" sx={{ m: 0 }}>
          <Box
            component="img"
            src={fileUrl(evidenceUrl, file)}
            alt={stepCaption(file)}
            sx={{ display: "block", width: "100%", border: `1px solid ${ui.line}`, borderRadius: 1 }}
          />
          <Typography component="figcaption" sx={{ mt: 0.75, fontFamily: fonts.mono, fontSize: "0.75rem", color: ui.textFaint }}>
            {stepCaption(file)}
          </Typography>
        </Box>
      ))}
      {records.length > 0 && (
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          {records.map((file) => (
            <Box key={file} component="a" href={fileUrl(evidenceUrl, file)} target="_blank" rel="noreferrer" sx={fileLinkSx}>
              {file}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export function EvidenceDialog({ evidenceUrl, title, onClose }: EvidenceDialogProps) {
  const [listing, setListing] = useState<EvidenceListing>({ state: "loading" });

  useEffect(() => {
    let isCurrent = true;
    void fetchEvidenceListing(evidenceUrl).then((result) => {
      if (isCurrent) setListing(result);
    });
    return () => {
      isCurrent = false;
    };
  }, [evidenceUrl]);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        Evidence
        <Typography component="span" sx={{ display: "block", mt: 0.25, color: ui.textMuted, fontSize: "0.8125rem" }}>
          {title}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {listing.state === "loading" && (
          <Typography sx={{ fontFamily: fonts.mono, fontSize: "0.75rem", color: ui.textFaint }}>Loading…</Typography>
        )}
        {listing.state === "failed" && (
          <Typography variant="body2" sx={{ color: ui.red }}>{listing.message}</Typography>
        )}
        {listing.state === "loaded" && <EvidenceFiles evidenceUrl={evidenceUrl} files={listing.files} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
