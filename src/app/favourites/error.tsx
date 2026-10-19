"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@mui/material";

export default function FavouritesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <EmptyState
      title="Saved jobs didn't load"
      action={<Button variant="outlined" size="small" onClick={reset}>Try again</Button>}
    >
      {error.message}
    </EmptyState>
  );
}
