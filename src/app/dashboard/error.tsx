"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@mui/material";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <EmptyState
      title="The dashboard didn't load"
      action={<Button variant="outlined" size="small" onClick={reset}>Try again</Button>}
    >
      {error.message}
    </EmptyState>
  );
}
