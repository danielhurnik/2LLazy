import { Box, Skeleton, Stack } from "@mui/material";

const FIGURE_PLACEHOLDERS = 3;
const CHART_PLACEHOLDER_HEIGHT = 300;

export default function StatsLoading() {
  return (
    <Box>
      <Skeleton variant="text" width={200} height={40} sx={{ mb: 1 }} />
      <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
        {Array.from({ length: FIGURE_PLACEHOLDERS }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={100} sx={{ flex: 1, borderRadius: 2 }} />
        ))}
      </Stack>
      <Skeleton variant="rectangular" height={CHART_PLACEHOLDER_HEIGHT} sx={{ borderRadius: 2, mb: 2 }} />
      <Skeleton variant="rectangular" height={CHART_PLACEHOLDER_HEIGHT} sx={{ borderRadius: 2 }} />
    </Box>
  );
}
