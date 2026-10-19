"use client";

import { useActionState, useTransition, useState } from "react";
import type { ReactNode } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Stack,
  Alert,
  CircularProgress,
  IconButton,
  Tooltip,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import { ui, fonts } from "@/theme/theme";
import type { UploadedFile } from "@/types";
import { uploadCvAction, deleteUploadedFileAction } from "@/lib/actions/settingsActions";

const UPLOAD_INPUT_ID = "cv-upload-input";
const ACCEPTED_FILE_TYPES = ".pdf,.docx,.doc,.txt";
const BYTES_PER_KILOBYTE = 1024;

const formatKilobytes = (bytes: number) => `${(bytes / BYTES_PER_KILOBYTE).toFixed(1)} KB`;

interface Props {
  uploadedFiles: UploadedFile[];
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <Box component="code" sx={{ fontFamily: fonts.mono, fontSize: "0.8em", color: ui.text }}>
      {children}
    </Box>
  );
}

function UploadedFileRow({
  file,
  isDeleting,
  onDelete,
}: {
  file: UploadedFile;
  isDeleting: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{ px: 1.5, py: 0.75, "& + &": { borderTop: `1px solid ${ui.line}` } }}
    >
      <Typography variant="body2" noWrap sx={{ minWidth: 0, flexGrow: 1 }}>
        {file.filename}
      </Typography>
      <Typography sx={{ fontFamily: fonts.mono, fontSize: "0.72rem", color: ui.textFaint, flexShrink: 0 }}>
        {formatKilobytes(file.size)}
      </Typography>
      <Tooltip title="Delete file">
        <span>
          <IconButton
            size="small"
            disabled={isDeleting}
            onClick={() => onDelete(file.id)}
            aria-label={`Delete ${file.filename}`}
            sx={{ "&:hover": { color: ui.red } }}
          >
            {isDeleting ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <DeleteOutlineRoundedIcon fontSize="small" />
            )}
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}

export function CvDocumentsCard({ uploadedFiles }: Props) {
  const [uploadState, uploadFormAction, isUploading] = useActionState(uploadCvAction, null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [, startDeleteTransition] = useTransition();
  const hasFiles = uploadedFiles.length > 0;

  const handleDelete = (id: string) => {
    setDeletingFileId(id);
    startDeleteTransition(async () => {
      const result = await deleteUploadedFileAction(id);
      if (result.error) setDeleteError(result.error);
      setDeletingFileId(null);
    });
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6">CV and documents</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 2 }}>
          Files named <InlineCode>cv.*</InlineCode> or{" "}
          <InlineCode>resume.*</InlineCode> are
          treated as your main CV.
        </Typography>

        {uploadState?.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {uploadState.error}
          </Alert>
        )}
        {deleteError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteError(null)}>
            {deleteError}
          </Alert>
        )}
        {uploadState?.filename && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Uploaded: {uploadState.filename}
          </Alert>
        )}

        <form action={uploadFormAction}>
          <input
            id={UPLOAD_INPUT_ID}
            type="file"
            name="file"
            accept={ACCEPTED_FILE_TYPES}
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.[0]) {
                e.target.form?.requestSubmit();
              }
            }}
          />
          <Button
            component="label"
            htmlFor={UPLOAD_INPUT_ID}
            variant="outlined"
            startIcon={isUploading ? <CircularProgress size={16} /> : <UploadFileIcon />}
            disabled={isUploading}
            sx={{ mb: 2 }}
          >
            {isUploading ? "Uploading…" : "Upload file"}
          </Button>
        </form>

        <Stack sx={{ border: hasFiles ? `1px solid ${ui.line}` : "none", borderRadius: 1 }}>
          {uploadedFiles.map((file) => (
            <UploadedFileRow
              key={file.id}
              file={file}
              isDeleting={deletingFileId === file.id}
              onDelete={handleDelete}
            />
          ))}
          {!hasFiles && (
            <Typography variant="body2" color="text.secondary">
              No files uploaded yet.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
