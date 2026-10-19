import { Box, Stack, Skeleton } from "@mui/material";

const SKELETON_CARD_COUNT = 4;
const SKELETON_CARD_HEIGHT = 160;

export default function FavouritesLoading() {
  return (
    <Box>
      <Skeleton variant="text" width={180} height={42} sx={{ mb: 0.5 }} />
      <Skeleton variant="text" width={280} height={20} sx={{ mb: 3 }} />
      <Skeleton variant="rectangular" height={52} sx={{ borderRadius: 2, mb: 2 }} />
      <Stack spacing={2}>
        {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
          <Skeleton key={index} variant="rectangular" height={SKELETON_CARD_HEIGHT} sx={{ borderRadius: 2 }} />
        ))}
      </Stack>
    </Box>
  );
}
