"use client";

import {
  Card,
  CardContent,
  Typography,
  Box,
  Switch,
  FormControlLabel,
  Alert,
  Button,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useState, useTransition } from "react";
import { toggleGoogleCalendarSync, checkCalendarAccess } from "@/lib/actions/settingsActions";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_OAUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

interface Props {
  enabled: boolean;
  hasCalendarAccess: boolean;
}

function redirectToCalendarConsent() {
  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "",
    redirect_uri: `${window.location.origin}/api/auth/callback/google`,
    response_type: "code",
    scope: `openid email profile ${CALENDAR_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  window.location.href = `${GOOGLE_OAUTH_URL}?${params}`;
}

function syncStatusLabel(hasAccess: boolean, syncing: boolean) {
  if (!hasAccess) return "Grant calendar access first";
  return syncing ? "Sync enabled" : "Sync disabled";
}

export function GoogleCalendarCard({ enabled, hasCalendarAccess: initialAccess }: Props) {
  const [syncing, setSyncing] = useState(enabled);
  const [hasAccess, setHasAccess] = useState(initialAccess);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleToggle = (checked: boolean) => {
    setSyncing(checked);
    setError(null);
    startTransition(async () => {
      try {
        if (checked) {
          const access = await checkCalendarAccess();
          setHasAccess(access);
          if (!access) {
            setSyncing(false);
            setError("Calendar access not yet granted. Use the button below to grant it.");
            return;
          }
        }
        await toggleGoogleCalendarSync(checked);
      } catch {
        setSyncing(!checked);
        setError("Failed to update Google Calendar sync setting.");
      }
    });
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6">Google Calendar</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 2 }}>
          Copy the interviews and events you add here into your Google Calendar.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!hasAccess && (
          <Alert
            severity="warning"
            sx={{ mb: 2 }}
            action={
              <Button
                size="small"
                color="inherit"
                endIcon={<OpenInNewIcon fontSize="small" />}
                onClick={redirectToCalendarConsent}
              >
                Grant access
              </Button>
            }
          >
            Calendar permission not yet granted.
          </Alert>
        )}

        <Box>
          <FormControlLabel
            control={
              <Switch
                checked={syncing}
                onChange={(e) => handleToggle(e.target.checked)}
                disabled={isPending || !hasAccess}
                color="primary"
              />
            }
            label={<Typography variant="body2">{syncStatusLabel(hasAccess, syncing)}</Typography>}
          />
        </Box>

        {syncing && hasAccess && (
          <Alert severity="info" sx={{ mt: 2 }} icon={false}>
            <Typography variant="body2">
              New interviews and events will appear in your Google Calendar.
              Existing entries are synced on the next create or edit.
            </Typography>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
