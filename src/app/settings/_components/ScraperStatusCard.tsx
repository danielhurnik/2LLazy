"use client";

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PublicIcon from "@mui/icons-material/Public";
import BlockIcon from "@mui/icons-material/Block";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { BoardStatus } from "@/types";

interface Props {
  country: string;
  countryName: string;
  boards: BoardStatus[];
  playwrightEnabled: boolean;
}

/** Flag emoji from an ISO 3166-1 alpha-2 code via regional indicator symbols. */
function flagOf(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

function BoardRow({ board }: { board: BoardStatus }) {
  const worldwide = board.countries.includes("*");
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        py: 0.75,
        opacity: board.enabled ? 1 : 0.55,
      }}
    >
      {board.enabled ? (
        <CheckCircleIcon fontSize="small" color="success" />
      ) : (
        <BlockIcon fontSize="small" color="disabled" />
      )}

      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
          <Link
            href={board.homepage}
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            fontWeight={500}
            underline="hover"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}
          >
            {board.name}
            <OpenInNewIcon sx={{ fontSize: 12 }} />
          </Link>

          {worldwide && (
            <Tooltip title="Covers every country">
              <Chip
                size="small"
                icon={<PublicIcon sx={{ fontSize: 14 }} />}
                label="worldwide"
                variant="outlined"
              />
            </Tooltip>
          )}
          {board.remoteOnly && <Chip size="small" label="remote only" variant="outlined" />}
          {board.requiresBrowser && (
            <Tooltip title="Renders JavaScript; needs PLAYWRIGHT_ENABLED=true">
              <Chip size="small" label="needs browser" variant="outlined" />
            </Tooltip>
          )}
        </Stack>

        <Typography variant="caption" color="text.secondary" display="block">
          {board.disabledReason ?? board.note ?? ""}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * Which job boards a search will actually hit, and why the rest are skipped.
 *
 * This replaces the old "AI Status" card. Nothing here needs an API key to
 * work — the only thing a key ever unlocks is one extra board — so the card is
 * about coverage rather than credentials.
 */
export function ScraperStatusCard({ country, countryName, boards, playwrightEnabled }: Props) {
  const active = boards.filter((b) => b.enabled);
  const inactive = boards.filter((b) => !b.enabled);
  const browserBlocked = inactive.filter((b) => b.requiresBrowser && !playwrightEnabled);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <Typography variant="h6">Job sources</Typography>
          <Chip size="small" label={`${flagOf(country)} ${countryName}`} />
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {active.length} of {boards.length} boards are active for your country. Change your country
          in the profile below to search a different market.
        </Typography>

        {active.map((board) => (
          <BoardRow key={board.id} board={board} />
        ))}

        {inactive.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="overline" color="text.secondary">
              Not searched
            </Typography>
            {inactive.map((board) => (
              <BoardRow key={board.id} board={board} />
            ))}
          </>
        )}

        {browserBlocked.length > 0 && (
          <Alert severity="info" sx={{ mt: 2, py: 0.5 }}>
            Set <code>PLAYWRIGHT_ENABLED=true</code> to add {browserBlocked.length} more{" "}
            {browserBlocked.length === 1 ? "board" : "boards"} that need a real browser to render
            their listings. Optional — everything else works without it.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
