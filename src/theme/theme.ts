"use client";

import { createTheme, alpha } from "@mui/material/styles";

/**
 * Paper-and-ink design system.
 *
 * Warm paper surfaces, near-black ink for text and primary actions, serif
 * display headings, hairline borders. One rule above all: no gradients, no
 * glow, no blur — colour is reserved for status (green/amber/red), and the
 * interface earns hierarchy through type and spacing instead.
 *
 * The export is still named `ios` from the previous iOS-dark theme; every
 * component references these keys, so the name stays while the values moved.
 * `blue` is the accent slot (now ink), `label1..3` are the three text tiers.
 */
export const ios = {
  // Accent slots — the primary accent is ink itself.
  blue:       "#23211C",
  indigo:     "#5A5788",
  green:      "#467A3C",
  orange:     "#A8742C",
  red:        "#A94438",
  teal:       "#3E7C8A",
  purple:     "#7A5C8E",
  // Backgrounds
  bg:         "#F6F3EC",
  surface1:   "#FCFBF7",
  surface2:   "#F0ECE1",
  // Labels
  label1:     "#22201B",
  label2:     "#6E695F",
  label3:     "#A29C8F",
  // Separator
  separator:  "#E3DED1",
  separatorOpaque: "#D9D3C4",
};

/** Serif stack for display type — system faces only, no webfont to load. */
const serif =
  "'Charter', 'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Georgia, 'Times New Roman', serif";

const sans =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: ios.blue,
      light: "#4A463D",
      dark: "#121110",
      contrastText: "#FCFBF7",
    },
    secondary: {
      main: ios.indigo,
    },
    success: { main: ios.green },
    warning: { main: ios.orange },
    error:   { main: ios.red },
    background: {
      default: ios.bg,
      paper:   ios.surface1,
    },
    text: {
      primary:   ios.label1,
      secondary: ios.label2,
    },
    divider: ios.separator,
  },
  typography: {
    fontFamily: sans,
    h1: { fontFamily: serif, fontWeight: 600 },
    h2: { fontFamily: serif, fontWeight: 600 },
    h3: { fontFamily: serif, fontWeight: 600, letterSpacing: "-0.01em" },
    h4: { fontFamily: serif, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.2 },
    h5: { fontFamily: serif, fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.3 },
    h6: { fontFamily: serif, fontWeight: 600, letterSpacing: "0em", lineHeight: 1.35 },
    body1: { lineHeight: 1.6 },
    body2: { lineHeight: 1.55 },
    caption: { letterSpacing: "0.01em" },
    button: { fontWeight: 600, letterSpacing: "0.01em", textTransform: "none" as const },
  },
  shape: { borderRadius: 6 },
  components: {
    // ─── Buttons ────────────────────────────────────────────────────────────
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
          borderRadius: 6,
          padding: "7px 16px",
          lineHeight: 1.5,
          boxShadow: "none",
          "&:hover": { boxShadow: "none" },
          "&.Mui-disabled": { opacity: 0.45 },
        },
        containedPrimary: {
          background: ios.label1,
          color: ios.surface1,
          "&:hover": { background: "#3A372F" },
        },
        outlined: {
          borderColor: ios.separatorOpaque,
          color: ios.label1,
          background: ios.surface1,
          "&:hover": {
            borderColor: ios.label3,
            background: ios.surface2,
          },
        },
        sizeSmall: {
          padding: "5px 12px",
          fontSize: "0.8125rem",
          borderRadius: 5,
        },
      },
    },
    // ─── Cards ──────────────────────────────────────────────────────────────
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          background: ios.surface1,
          borderRadius: 8,
          border: `1px solid ${ios.separator}`,
          boxShadow: "0 1px 2px rgba(34,32,27,0.04)",
          transition: "border-color 0.15s ease",
          "&:hover": {
            borderColor: ios.separatorOpaque,
          },
        },
      },
    },
    // ─── Paper ──────────────────────────────────────────────────────────────
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    // ─── Drawer ─────────────────────────────────────────────────────────────
    MuiDrawer: {
      styleOverrides: {
        paper: {
          background: ios.bg,
          borderRight: `1px solid ${ios.separator}`,
        },
      },
    },
    // ─── Dialog ─────────────────────────────────────────────────────────────
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 10,
          border: `1px solid ${ios.separator}`,
          background: ios.surface1,
          boxShadow: "0 16px 48px rgba(34,32,27,0.18)",
        },
      },
    },
    // ─── TextField ──────────────────────────────────────────────────────────
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 6,
            background: "#FFFFFF",
            "& fieldset": {
              borderColor: ios.separatorOpaque,
              transition: "border-color 0.15s ease",
            },
            "&:hover fieldset": { borderColor: ios.label3 },
            "&.Mui-focused": {
              boxShadow: `0 0 0 3px ${alpha(ios.label1, 0.08)}`,
              "& fieldset": {
                borderColor: ios.label1,
                borderWidth: "1px",
              },
            },
          },
        },
      },
    },
    // ─── Select ─────────────────────────────────────────────────────────────
    MuiSelect: {
      styleOverrides: {
        root: { borderRadius: 6, background: "#FFFFFF" },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          "& fieldset": { borderColor: ios.separatorOpaque },
        },
      },
    },
    // ─── Menu ───────────────────────────────────────────────────────────────
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 8,
          border: `1px solid ${ios.separator}`,
          background: ios.surface1,
          boxShadow: "0 8px 24px rgba(34,32,27,0.12)",
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 5,
          margin: "1px 4px",
          padding: "7px 12px",
          fontSize: "0.875rem",
          "&:hover": { background: ios.surface2 },
          "&.Mui-selected": {
            background: ios.surface2,
            "&:hover": { background: ios.separator },
          },
        },
      },
    },
    // ─── Chips ──────────────────────────────────────────────────────────────
    // Quiet by default: paper fill, ink text, hairline. Colour only carries
    // status, and even then muted — a chip is metadata, not a highlight.
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          fontWeight: 500,
          fontSize: "0.75rem",
          height: 22,
          "&.MuiChip-colorDefault": {
            background: ios.surface2,
            color: ios.label2,
            border: `1px solid ${ios.separator}`,
          },
          "&.MuiChip-colorSuccess": {
            background: alpha(ios.green, 0.1),
            color: ios.green,
            border: `1px solid ${alpha(ios.green, 0.28)}`,
          },
          "&.MuiChip-colorWarning": {
            background: alpha(ios.orange, 0.1),
            color: ios.orange,
            border: `1px solid ${alpha(ios.orange, 0.28)}`,
          },
          "&.MuiChip-colorError": {
            background: alpha(ios.red, 0.08),
            color: ios.red,
            border: `1px solid ${alpha(ios.red, 0.25)}`,
          },
          "&.MuiChip-colorSecondary": {
            background: alpha(ios.indigo, 0.08),
            color: ios.indigo,
            border: `1px solid ${alpha(ios.indigo, 0.25)}`,
          },
        },
        clickable: {
          cursor: "pointer",
        },
      },
    },
    // ─── List items ─────────────────────────────────────────────────────────
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
        },
      },
    },
    // ─── Divider ────────────────────────────────────────────────────────────
    MuiDivider: {
      styleOverrides: {
        root: { borderColor: ios.separator },
      },
    },
    // ─── Progress ───────────────────────────────────────────────────────────
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          height: 3,
          background: ios.separator,
        },
        bar: {
          borderRadius: 2,
          background: ios.label1,
        },
      },
    },
    // ─── Skeleton ───────────────────────────────────────────────────────────
    MuiSkeleton: {
      styleOverrides: {
        root: {
          background: ios.surface2,
          borderRadius: 6,
          "&::after": {
            background: "linear-gradient(90deg, transparent, rgba(34,32,27,0.03), transparent)",
          },
        },
      },
    },
    // ─── Switch ─────────────────────────────────────────────────────────────
    MuiSwitch: {
      styleOverrides: {
        root: {
          width: 40,
          height: 24,
          padding: 0,
          "& .MuiSwitch-switchBase": {
            padding: 3,
            "&.Mui-checked": {
              transform: "translateX(16px)",
              "& + .MuiSwitch-track": {
                background: ios.label1,
                opacity: 1,
                border: "none",
              },
              "& .MuiSwitch-thumb": { background: ios.surface1 },
            },
          },
          "& .MuiSwitch-thumb": {
            width: 18,
            height: 18,
            background: "#FFFFFF",
            boxShadow: "0 1px 2px rgba(34,32,27,0.25)",
          },
          "& .MuiSwitch-track": {
            borderRadius: 12,
            background: ios.separatorOpaque,
            opacity: 1,
          },
        },
      },
    },
    // ─── Alert ──────────────────────────────────────────────────────────────
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          border: "1px solid",
        },
        standardInfo: {
          background: ios.surface2,
          borderColor: ios.separatorOpaque,
          color: ios.label1,
        },
        standardWarning: {
          background: alpha(ios.orange, 0.08),
          borderColor: alpha(ios.orange, 0.3),
        },
        standardError: {
          background: alpha(ios.red, 0.07),
          borderColor: alpha(ios.red, 0.3),
        },
        standardSuccess: {
          background: alpha(ios.green, 0.08),
          borderColor: alpha(ios.green, 0.3),
        },
      },
    },
    // ─── Tooltip ────────────────────────────────────────────────────────────
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          background: ios.label1,
          color: ios.surface1,
          borderRadius: 5,
          fontSize: "0.75rem",
          fontWeight: 500,
          padding: "5px 10px",
        },
      },
    },
    // ─── Icon button ────────────────────────────────────────────────────────
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          "&:hover": { background: ios.surface2 },
        },
      },
    },
  },
});
