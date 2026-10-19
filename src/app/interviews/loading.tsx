import { Box, Skeleton, Stack, Grid } from "@mui/material";

const DAYS_PER_WEEK = 7;
const PLACEHOLDER_WEEKS = 5;
const GRID_COLUMNS = 12;
const DAY_COLUMN_SPAN = GRID_COLUMNS / DAYS_PER_WEEK;

export default function InterviewsLoading() {
  return (
    <Box>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
        <Skeleton variant="circular" width={36} height={36} />
        <Skeleton variant="text" width={160} height={32} />
        <Skeleton variant="circular" width={36} height={36} />
      </Stack>

      <Grid container spacing={1}>
        {Array.from({ length: DAYS_PER_WEEK }).map((_, i) => (
          <Grid key={i} item xs={DAY_COLUMN_SPAN}>
            <Skeleton variant="text" width="60%" height={20} sx={{ mx: "auto", mb: 1 }} />
          </Grid>
        ))}
        {Array.from({ length: DAYS_PER_WEEK * PLACEHOLDER_WEEKS }).map((_, i) => (
          <Grid key={`cell-${i}`} item xs={DAY_COLUMN_SPAN}>
            <Skeleton variant="rounded" height={80} />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
