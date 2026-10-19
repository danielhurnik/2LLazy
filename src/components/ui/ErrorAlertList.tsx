"use client";

import { Alert } from "@mui/material";

interface ErrorAlertListProps {
  errors: string[];
  onDismiss: (index: number) => void;
}

export function ErrorAlertList({ errors, onDismiss }: ErrorAlertListProps) {
  if (!errors.length) return null;
  return (
    <>
      {errors.map((message, index) => (
        <Alert
          key={index}
          severity="warning"
          sx={{ mb: 1 }}
          onClose={() => onDismiss(index)}
        >
          {message}
        </Alert>
      ))}
    </>
  );
}
