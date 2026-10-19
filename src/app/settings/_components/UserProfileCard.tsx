"use client";

import { useState, useTransition } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Stack,
  Alert,
  CircularProgress,
  MenuItem,
} from "@mui/material";
import { saveUserProfile } from "@/lib/actions/settingsActions";
import { COUNTRY_NAMES, isSupportedCountry } from "@/lib/jobs/sources/types";
import type { UserProfile } from "@/types";
import { useTimedMessage } from "./useTimedMessage";

const MESSAGE_VISIBLE_MS = 5000;
const SUPPORTED_COUNTRIES = Object.keys(COUNTRY_NAMES).filter(isSupportedCountry);

type EditableProfileField = Exclude<keyof UserProfile, "googleCalendarSync" | "country">

interface Props {
  profile: UserProfile;
}

function FieldRow({ children }: { children: ReactNode }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
      {children}
    </Stack>
  );
}

export function UserProfileCard({ profile: initialProfile }: Props) {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  const { message, showMessage, clearMessage } = useTimedMessage(MESSAGE_VISIBLE_MS);

  const fieldProps = (field: EditableProfileField) => ({
    size: "small" as const,
    value: profile[field],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setProfile({ ...profile, [field]: e.target.value }),
  });

  const handleSave = () => {
    setSaving(true);
    startTransition(async () => {
      try {
        await saveUserProfile(profile);
        showMessage("success", "Profile saved.");
        router.refresh();
      } catch (err) {
        showMessage("error", err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    });
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6">Profile</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, mb: 2.5 }}>
          Your contact details, kept in one place for applications.
        </Typography>

        {message && (
          <Alert severity={message.type} onClose={clearMessage} sx={{ mb: 2 }}>
            {message.text}
          </Alert>
        )}

        <Stack spacing={2}>
          <FieldRow>
            <TextField label="Full Name" {...fieldProps("name")} fullWidth />
            <TextField label="Email" type="email" {...fieldProps("email")} fullWidth />
          </FieldRow>
          <FieldRow>
            <TextField label="Phone" {...fieldProps("phone")} fullWidth />
            <TextField label="LinkedIn URL" {...fieldProps("linkedInUrl")} fullWidth />
          </FieldRow>
          <FieldRow>
            <TextField
              select
              label="Country"
              size="small"
              value={profile.country}
              onChange={(e) => {
                const country = e.target.value;
                if (isSupportedCountry(country)) setProfile({ ...profile, country });
              }}
              sx={{ minWidth: { sm: 200 } }}
            >
              {SUPPORTED_COUNTRIES.map((code) => (
                <MenuItem key={code} value={code}>{COUNTRY_NAMES[code]}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="City"
              {...fieldProps("city")}
              helperText="Job search starts with this country and city."
              fullWidth
            />
          </FieldRow>
          <TextField label="GitHub URL" {...fieldProps("githubUrl")} sx={{ maxWidth: 400 }} />
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
            sx={{ alignSelf: "flex-start" }}
          >
            {saving ? <CircularProgress size={18} color="inherit" /> : "Save profile"}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
