import { Box, Skeleton, Stack, Divider } from "@mui/material";

const PROFILE_FIELD_PLACEHOLDERS = 5;
const UPLOADED_FILE_PLACEHOLDERS = 2;

export default function SettingsLoading() {
  return (
    <Box sx={{ maxWidth: 760 }}>
      <Skeleton variant="text" width={200} height={32} sx={{ mb: 3 }} />

      <Stack spacing={2} sx={{ mb: 4 }}>
        {Array.from({ length: PROFILE_FIELD_PLACEHOLDERS }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={56} />
        ))}
      </Stack>

      <Divider sx={{ my: 3 }} />

      <Skeleton variant="text" width={160} height={28} sx={{ mb: 2 }} />
      <Skeleton variant="rounded" height={100} sx={{ mb: 2 }} />
      <Stack spacing={1}>
        {Array.from({ length: UPLOADED_FILE_PLACEHOLDERS }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={48} />
        ))}
      </Stack>
    </Box>
  );
}
