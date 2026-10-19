"use client";

import { createTheme, alpha, type Components, type Theme } from "@mui/material/styles";

import { ui, fonts } from "./tokens";

type ComponentOverrides = Components<Omit<Theme, "components">>;

const ACCENT_PRESSED = "#D69A24";
const TOOLTIP_BACKGROUND = "#2E2E2B";
const INPUT_FILL = "rgba(255,255,245,0.025)";
const BACKDROP_SCRIM = "rgba(8,8,7,0.7)";
const DIALOG_SHADOW = "0 24px 64px -16px rgba(0,0,0,0.75)";
const MENU_SHADOW = "0 16px 40px -12px rgba(0,0,0,0.7)";

const radius = { tag: 4, control: 6, panel: 8, dialog: 10 } as const;

const textSize = {
  xxs: "0.6875rem",
  xs: "0.75rem",
  sm: "0.8125rem",
  md: "0.84375rem",
  lg: "0.9375rem",
} as const;

const border = {
  subtle: `1px solid ${ui.line}`,
  strong: `1px solid ${ui.lineStrong}`,
} as const;

const hoverHighlight = { backgroundColor: ui.hover, color: ui.text } as const;
const accentSelectedFill = alpha(ui.accent, 0.1);
const errorHoverFill = alpha(ui.red, 0.08);

const quickTransition = (...properties: string[]) =>
  properties.map((property) => `${property} 120ms ease`).join(", ");

const paletteColor = (main: string) => ({ main, contrastText: ui.accentInk });

const chipTone = (color: string) => ({
  color,
  borderColor: alpha(color, 0.35),
  backgroundColor: alpha(color, 0.07),
});

const alertTone = (color: string, borderOpacity = 0.3) => ({
  backgroundColor: alpha(color, 0.06),
  borderColor: alpha(color, borderOpacity),
  color: ui.text,
  "& .MuiAlert-icon": { color },
});

const buttonOverrides: ComponentOverrides = {
  MuiButtonBase: { defaultProps: { disableRipple: true } },
  MuiButton: {
    defaultProps: { disableElevation: true },
    styleOverrides: {
      root: {
        borderRadius: radius.control,
        padding: "6px 14px",
        minWidth: 0,
        lineHeight: 1.6,
        transition: quickTransition("background-color", "border-color", "color"),
      },
      sizeSmall: { padding: "3px 10px", fontSize: textSize.sm },
      sizeLarge: { padding: "9px 18px", fontSize: textSize.lg },
      contained: {
        "&.Mui-disabled": { backgroundColor: ui.raised, color: ui.textFaint },
      },
      containedPrimary: {
        backgroundColor: ui.accent,
        color: ui.accentInk,
        "&:hover": { backgroundColor: ui.accentHover },
      },
      outlined: {
        borderColor: ui.line,
        color: ui.text,
        "&:hover": { borderColor: ui.lineStrong, backgroundColor: ui.hover },
        "&.Mui-disabled": { borderColor: ui.line, color: ui.textFaint },
      },
      outlinedError: {
        color: ui.red,
        borderColor: alpha(ui.red, 0.4),
        "&:hover": { borderColor: ui.red, backgroundColor: errorHoverFill },
      },
      text: {
        color: ui.textMuted,
        "&:hover": { color: ui.text, backgroundColor: ui.hover },
      },
      textError: {
        color: ui.red,
        "&:hover": { color: ui.red, backgroundColor: errorHoverFill },
      },
      startIcon: { marginRight: 6, "& > *:nth-of-type(1)": { fontSize: 17 } },
      endIcon: { marginLeft: 6, "& > *:nth-of-type(1)": { fontSize: 16 } },
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        borderRadius: radius.control,
        color: ui.textMuted,
        transition: quickTransition("background-color", "color"),
        "&:hover": hoverHighlight,
      },
      colorError: { color: ui.red },
      sizeSmall: { padding: 5 },
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: {
        textTransform: "none",
        fontSize: textSize.sm,
        fontWeight: 500,
        lineHeight: 1.5,
        padding: "5px 12px",
        color: ui.textMuted,
        borderColor: ui.line,
        "&:hover": hoverHighlight,
        "&.Mui-selected": {
          color: ui.text,
          backgroundColor: ui.raised,
          "&:hover": { backgroundColor: ui.hover },
        },
      },
    },
  },
};

const surfaceOverrides: ComponentOverrides = {
  MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
  MuiCard: {
    styleOverrides: {
      root: {
        backgroundImage: "none",
        backgroundColor: ui.surface,
        border: border.subtle,
        borderRadius: radius.panel,
        boxShadow: "none",
      },
    },
  },
  MuiCardContent: {
    styleOverrides: { root: { padding: "16px 18px", "&:last-child": { paddingBottom: 16 } } },
  },
  MuiDrawer: {
    styleOverrides: { paper: { backgroundColor: ui.sidebar, borderRight: border.subtle } },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        backgroundColor: ui.surface,
        border: border.strong,
        borderRadius: radius.dialog,
        boxShadow: DIALOG_SHADOW,
      },
    },
  },
  MuiDialogTitle: {
    styleOverrides: {
      root: {
        fontSize: "1.0625rem",
        fontWeight: 650,
        letterSpacing: "-0.015em",
        padding: "18px 22px 8px",
      },
    },
  },
  MuiDialogContent: { styleOverrides: { root: { padding: "8px 22px 12px" } } },
  MuiDialogActions: { styleOverrides: { root: { padding: "10px 22px 18px" } } },
  MuiBackdrop: {
    styleOverrides: { root: { "&:not(.MuiBackdrop-invisible)": { backgroundColor: BACKDROP_SCRIM } } },
  },
};

const formOverrides: ComponentOverrides = {
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: radius.control,
        backgroundColor: INPUT_FILL,
        "& .MuiOutlinedInput-notchedOutline": {
          borderColor: ui.line,
          transition: quickTransition("border-color"),
        },
        "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: ui.lineStrong },
        "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
          borderColor: ui.accent,
          borderWidth: 1,
        },
        "&.Mui-error .MuiOutlinedInput-notchedOutline": { borderColor: ui.red },
        "&.Mui-disabled .MuiOutlinedInput-notchedOutline": { borderColor: ui.line },
      },
      input: {
        "&::placeholder": { color: ui.textFaint, opacity: 1 },
      },
    },
  },
  MuiInputLabel: {
    styleOverrides: { root: { color: ui.textMuted, "&.Mui-focused": { color: ui.text } } },
  },
  MuiInputAdornment: {
    styleOverrides: {
      root: {
        "& .MuiTypography-root": {
          fontFamily: fonts.mono,
          fontSize: textSize.xs,
          color: ui.textFaint,
        },
      },
    },
  },
  MuiSelect: { styleOverrides: { icon: { color: ui.textFaint } } },
  MuiFormControlLabel: {
    styleOverrides: {
      root: { marginLeft: 0, gap: 8 },
      label: { fontSize: textSize.sm, color: ui.textMuted },
    },
  },
  MuiSwitch: {
    styleOverrides: {
      root: {
        width: 30,
        height: 18,
        padding: 0,
        overflow: "visible",
        "& .MuiSwitch-switchBase": {
          padding: 2,
          color: ui.text,
          "&:hover": { backgroundColor: "transparent" },
          "&.Mui-checked": {
            transform: "translateX(12px)",
            color: ui.accentInk,
            "& + .MuiSwitch-track": { backgroundColor: ui.accent, opacity: 1 },
          },
          "&.Mui-disabled + .MuiSwitch-track": { opacity: 0.35 },
          "&.Mui-focusVisible + .MuiSwitch-track": {
            outline: `2px solid ${ui.accent}`,
            outlineOffset: 2,
          },
        },
        "& .MuiSwitch-thumb": { width: 14, height: 14, boxShadow: "none" },
        "& .MuiSwitch-track": {
          borderRadius: 9,
          backgroundColor: ui.lineStrong,
          opacity: 1,
        },
      },
    },
  },
};

const menuOverrides: ComponentOverrides = {
  MuiMenu: {
    styleOverrides: {
      paper: {
        marginTop: 4,
        backgroundColor: ui.raised,
        border: border.subtle,
        borderRadius: radius.panel,
        boxShadow: MENU_SHADOW,
      },
      list: { padding: 4 },
    },
  },
  MuiMenuItem: {
    styleOverrides: {
      root: {
        borderRadius: radius.tag,
        minHeight: 32,
        padding: "6px 10px",
        fontSize: textSize.md,
        "&:hover, &.Mui-focusVisible": { backgroundColor: ui.hover },
        "&.Mui-selected": {
          backgroundColor: accentSelectedFill,
          "&:hover, &.Mui-focusVisible": { backgroundColor: alpha(ui.accent, 0.15) },
        },
      },
    },
  },
};

const dataDisplayOverrides: ComponentOverrides = {
  MuiChip: {
    styleOverrides: {
      root: {
        height: 22,
        borderRadius: radius.tag,
        fontFamily: fonts.mono,
        fontSize: textSize.xxs,
        fontWeight: 500,
        letterSpacing: 0,
        color: ui.textMuted,
        backgroundColor: "transparent",
        border: border.subtle,
        "&.MuiChip-colorPrimary":   chipTone(ui.accent),
        "&.MuiChip-colorSecondary": chipTone(ui.blue),
        "&.MuiChip-colorInfo":      chipTone(ui.blue),
        "&.MuiChip-colorSuccess":   chipTone(ui.green),
        "&.MuiChip-colorWarning":   chipTone(ui.orange),
        "&.MuiChip-colorError":     chipTone(ui.red),
        "&.MuiChip-clickable:hover": { backgroundColor: ui.hover, borderColor: ui.lineStrong },
      },
      sizeSmall: { height: 20 },
      label: { paddingLeft: 7, paddingRight: 7 },
      labelSmall: { paddingLeft: 6, paddingRight: 6 },
      icon: { color: "inherit", marginLeft: 7, marginRight: -2 },
      iconSmall: { marginLeft: 6, marginRight: -2 },
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: { borderRadius: radius.control, "&.Mui-focusVisible": { backgroundColor: ui.hover } },
    },
  },
  MuiListItemIcon: { styleOverrides: { root: { minWidth: 30, color: "inherit" } } },
  MuiDivider: { styleOverrides: { root: { borderColor: ui.line } } },
  MuiAvatar: {
    styleOverrides: {
      root: { backgroundColor: ui.raised, color: ui.textMuted, fontSize: textSize.xs, fontWeight: 600 },
    },
  },
};

const feedbackOverrides: ComponentOverrides = {
  MuiLinearProgress: {
    styleOverrides: {
      root: { height: 2, borderRadius: 0, backgroundColor: ui.line },
      bar: { borderRadius: 0, backgroundColor: ui.accent },
    },
  },
  MuiSkeleton: {
    styleOverrides: {
      root: { backgroundColor: ui.raised },
      rounded: { borderRadius: radius.control },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: {
        borderRadius: radius.control,
        border: "1px solid",
        padding: "4px 12px",
        fontSize: textSize.md,
        alignItems: "center",
      },
      icon: { padding: "6px 0", marginRight: 10, fontSize: 18 },
      message: { padding: "6px 0" },
      action: { paddingTop: 0, marginRight: -4 },
      standardInfo: {
        backgroundColor: ui.surface,
        borderColor: ui.line,
        color: ui.textMuted,
        "& .MuiAlert-icon": { color: ui.textFaint },
      },
      standardSuccess: alertTone(ui.green),
      standardWarning: alertTone(ui.orange),
      standardError: alertTone(ui.red, 0.32),
    },
  },
  MuiTooltip: {
    defaultProps: { enterDelay: 400 },
    styleOverrides: {
      tooltip: {
        backgroundColor: TOOLTIP_BACKGROUND,
        color: ui.text,
        border: border.strong,
        borderRadius: radius.tag,
        fontSize: textSize.xs,
        fontWeight: 500,
        padding: "4px 8px",
      },
    },
  },
};

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary:   { main: ui.accent, light: ui.accentHover, dark: ACCENT_PRESSED, contrastText: ui.accentInk },
    secondary: paletteColor(ui.blue),
    success:   paletteColor(ui.green),
    warning:   paletteColor(ui.orange),
    error:     paletteColor(ui.red),
    info:      paletteColor(ui.blue),
    background: { default: ui.bg, paper: ui.surface },
    text: { primary: ui.text, secondary: ui.textMuted, disabled: ui.textFaint },
    divider: ui.line,
    action: {
      hover: ui.hover,
      selected: accentSelectedFill,
      disabled: ui.textFaint,
      disabledBackground: ui.raised,
    },
  },
  shape: { borderRadius: radius.control },
  typography: {
    fontFamily: fonts.sans,
    h4: { fontSize: "1.625rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15 },
    h5: { fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1.25 },
    h6: { fontSize: textSize.lg, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.35 },
    subtitle1: { fontSize: textSize.lg, fontWeight: 500 },
    subtitle2: { fontSize: textSize.sm, fontWeight: 600 },
    body1: { fontSize: textSize.lg, lineHeight: 1.55 },
    body2: { fontSize: textSize.md, lineHeight: 1.55 },
    caption: { fontSize: textSize.xs, lineHeight: 1.45, letterSpacing: 0 },
    overline: {
      fontFamily: fonts.mono,
      fontSize: textSize.xxs,
      fontWeight: 500,
      letterSpacing: "0.08em",
      lineHeight: 1.5,
    },
    button: { fontSize: textSize.md, fontWeight: 600, letterSpacing: 0, textTransform: "none" },
  },
  components: {
    ...buttonOverrides,
    ...surfaceOverrides,
    ...formOverrides,
    ...menuOverrides,
    ...dataDisplayOverrides,
    ...feedbackOverrides,
  },
});
