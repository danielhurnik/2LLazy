"use client";

import { Box, ButtonBase, Stack, Typography } from "@mui/material";
import { ui, fonts } from "@/theme/tokens";
import { calloutSx, panelLinkSx } from "./panelStyles";
import { hostOfUrl, useBoardSignIns, type BoardSignIn } from "./useBoardSignIns";

const WAITING_FOR_SIGN_IN = "sign in in the apply window; this updates once you are in";
const NOT_SIGNED_IN = "not signed in, so it may ask for a CAPTCHA";

interface BoardSignInLineProps {
  board: BoardSignIn;
  isPending: boolean;
  onSignIn: (host: string) => void;
}

function describeSignIn(board: BoardSignIn, isPending: boolean): string {
  if (board.signedIn) return "signed in";
  return isPending ? WAITING_FOR_SIGN_IN : NOT_SIGNED_IN;
}

function BoardSignInLine({ board, isPending, onSignIn }: BoardSignInLineProps) {
  return (
    <Typography variant="body2" sx={{ color: ui.text }}>
      <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: "0.72rem", color: ui.textFaint, mr: 1 }}>
        sign-in
      </Box>
      {board.host}
      <Box component="span" sx={{ color: ui.textMuted }}> · {describeSignIn(board, isPending)}</Box>
      {!board.signedIn && !isPending && (
        <>
          {" "}
          <ButtonBase onClick={() => onSignIn(board.host)} sx={{ ...panelLinkSx, verticalAlign: "baseline" }}>
            sign in
          </ButtonBase>
        </>
      )}
    </Typography>
  );
}

function SignInError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Typography variant="body2" role="alert" sx={{ color: ui.red }}>
      {error}
    </Typography>
  );
}

export function BoardSignInStrip() {
  const { boards, pendingHosts, error, signIn } = useBoardSignIns();
  if (boards.length === 0) return null;

  return (
    <Stack spacing={0.5} sx={{ mb: 2 }}>
      {boards.map((board) => (
        <BoardSignInLine
          key={board.host}
          board={board}
          isPending={board.pending || pendingHosts.has(board.host)}
          onSignIn={signIn}
        />
      ))}
      <SignInError error={error} />
    </Stack>
  );
}

export function PostingSignInHint({ sourceUrl }: { sourceUrl: string }) {
  const { boards, pendingHosts, error, signIn } = useBoardSignIns();
  const postingHost = hostOfUrl(sourceUrl);
  const board = boards.find((candidate) => candidate.host === postingHost);
  if (!board) return null;

  return (
    <Box sx={calloutSx(board.signedIn ? ui.green : ui.blue)}>
      <BoardSignInLine
        board={board}
        isPending={board.pending || pendingHosts.has(board.host)}
        onSignIn={signIn}
      />
      <SignInError error={error} />
    </Box>
  );
}
