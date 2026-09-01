"use client";

import {
  Box,
  Button,
  Divider,
  TextField,
  Typography,
} from "@mui/material";
import BoltIcon from "@mui/icons-material/Bolt";
import GoogleIcon from "@mui/icons-material/Google";
import { signIn } from "next-auth/react";
import { ios } from "@/theme/theme";
import { useState } from "react";

export function LoginForm({ error }: { error?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [credError, setCredError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setCredError("");
    setLoading(true);
    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl: "/",
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setCredError("Invalid email or password.");
    } else {
      window.location.href = result?.url ?? "/";
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: ios.bg,
      }}
    >
      <Box
        sx={{
          p: 4,
          background: ios.surface1,
          borderRadius: "10px",
          border: `1px solid ${ios.separator}`,
          boxShadow: "0 2px 8px rgba(34,32,27,0.06)",
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          animation: "fadeSlideUp 0.4s cubic-bezier(0.34,1.2,0.64,1) both",
        }}
      >
        {/* App icon */}
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, mb: 0.5 }}>
          <Box sx={{
            width: 56,
            height: 56,
            borderRadius: "12px",
            background: ios.label1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <BoltIcon sx={{ color: ios.surface1, fontSize: 28 }} />
          </Box>
          <Box sx={{ textAlign: "center" }}>
            <Typography sx={{ color: ios.label1, fontFamily: "'Charter', 'Iowan Old Style', Georgia, serif", fontSize: 24, fontWeight: 600, lineHeight: 1.2 }}>
              2LLazy
            </Typography>
            <Typography sx={{ color: ios.label2, fontSize: 13, mt: 0.25 }}>
              Job Tracker
            </Typography>
          </Box>
        </Box>

        {/* Divider */}
        <Box sx={{ height: "1px", background: ios.separator }} />

        <Typography sx={{ color: ios.label2, fontSize: 13, textAlign: "center" }}>
          Sign in to access your personal job tracker workspace.
        </Typography>

        {error && (
          <Typography sx={{ color: ios.red, fontSize: 13, textAlign: "center" }}>
            Sign-in failed. Please try again.
          </Typography>
        )}

        <Button
          variant="contained"
          fullWidth
          onClick={() => signIn("google", { callbackUrl: "/" })}
          startIcon={<GoogleIcon />}
          sx={{
            mt: 0.5,
            py: 1.1,
            fontSize: "0.9375rem",
            background: "#FFFFFF",
            color: ios.label1,
            border: `1px solid ${ios.separatorOpaque}`,
            "&:hover": { background: ios.surface2 },
          }}
        >
          Continue with Google
        </Button>

        <Divider sx={{ borderColor: ios.separator }}>
          <Typography sx={{ color: ios.label2, fontSize: 12, px: 1 }}>or</Typography>
        </Divider>

        <Box component="form" onSubmit={handleCredentials} sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <TextField
            label="Email"
            type="email"
            size="small"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            inputProps={{ "data-testid": "credentials-email" }}
            sx={{
              "& .MuiOutlinedInput-root": { borderRadius: "6px" },
              "& .MuiInputLabel-root": { color: ios.label2 },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: ios.separator },
            }}
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
            sx={{
              "& .MuiOutlinedInput-root": { borderRadius: "6px" },
              "& .MuiInputLabel-root": { color: ios.label2 },
              "& .MuiOutlinedInput-notchedOutline": { borderColor: ios.separator },
            }}
          />
          {(credError || error) && (
            <Typography sx={{ color: ios.red, fontSize: 13, textAlign: "center" }}>
              {credError || "Sign-in failed. Please try again."}
            </Typography>
          )}
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={loading}
            sx={{
              py: 1.1,
              fontSize: "0.9375rem",
              background: ios.blue,
              "&:hover": { background: "#0060df" },
              "&:disabled": { opacity: 0.6 },
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
