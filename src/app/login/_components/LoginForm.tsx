"use client";

import { Box, Button, TextField, Typography } from "@mui/material";
import GoogleIcon from "@mui/icons-material/Google";
import { signIn } from "next-auth/react";
import { useState, type SubmitEvent } from "react";
import { Wordmark } from "@/components/ui/Wordmark";
import { ui, fonts } from "@/theme/tokens";

const POST_LOGIN_PATH = "/";
const CREDENTIALS_MISMATCH_MESSAGE = "That email and password don't match.";
const SIGN_IN_FAILED_MESSAGE = "Sign-in failed. Please try again.";

interface LoginFormProps {
  error?: string;
}

function HairlineRule() {
  return <Box sx={{ flex: 1, height: "1px", bgcolor: ui.line }} />;
}

export function LoginForm({ error }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [credentialsError, setCredentialsError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleCredentialsSubmit(event: SubmitEvent) {
    event.preventDefault();
    setCredentialsError("");
    setSubmitting(true);
    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl: POST_LOGIN_PATH,
      redirect: false,
    }).finally(() => setSubmitting(false));
    if (result?.error) {
      setCredentialsError(CREDENTIALS_MISMATCH_MESSAGE);
      return;
    }
    window.location.href = result?.url ?? POST_LOGIN_PATH;
  }

  const visibleError = credentialsError || (error ? SIGN_IN_FAILED_MESSAGE : "");

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        py: 6,
      }}
    >
      <Box sx={{ width: "100%", maxWidth: 340 }}>
        <Wordmark size={22} />

        <Typography variant="h5" component="h1" sx={{ mt: 3.5 }}>
          For people too lazy to apply by hand.
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, color: ui.textMuted }}>
          Searches seven Czech job boards at once, ranks what fits, and keeps track of
          everything you send.
        </Typography>

        <Button
          variant="outlined"
          fullWidth
          onClick={() => signIn("google", { callbackUrl: POST_LOGIN_PATH })}
          startIcon={<GoogleIcon />}
          sx={{ mt: 4, py: 1 }}
        >
          Continue with Google
        </Button>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 2.5 }}>
          <HairlineRule />
          <Typography sx={{ fontFamily: fonts.mono, fontSize: "0.6875rem", color: ui.textFaint }}>
            or with email
          </Typography>
          <HairlineRule />
        </Box>

        <Box
          component="form"
          onSubmit={handleCredentialsSubmit}
          sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
        >
          <TextField
            label="Email"
            type="email"
            size="small"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            inputProps={{ "data-testid": "credentials-email" }}
          />
          <TextField
            label="Password"
            type="password"
            size="small"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            inputProps={{ "data-testid": "credentials-password" }}
          />
          {visibleError && (
            <Typography role="alert" variant="body2" sx={{ color: ui.red }}>
              {visibleError}
            </Typography>
          )}
          <Button type="submit" variant="contained" fullWidth disabled={submitting} sx={{ py: 1 }}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
