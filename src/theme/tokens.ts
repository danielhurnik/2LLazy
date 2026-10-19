import type { CSSProperties } from "react";

export const ui = {
  bg:          "#141413",
  sidebar:     "#0F0F0E",
  surface:     "#1B1B19",
  raised:      "#222220",
  hover:       "#272724",
  line:        "#2C2C29",
  lineStrong:  "#3D3D39",
  text:        "#ECEAE4",
  textMuted:   "#A3A198",
  textFaint:   "#86847C",
  accent:      "#F0B43C",
  accentHover: "#F5C463",
  accentInk:   "#1C1608",
  green:       "#62B98C",
  red:         "#E2614F",
  orange:      "#DB8443",
  blue:        "#82A7D6",
} as const;

export const fonts = {
  sans: "var(--font-sans), 'Segoe UI', system-ui, sans-serif",
  mono: "var(--font-mono), ui-monospace, 'Cascadia Mono', Consolas, monospace",
} as const;

export const cssColorVariables: CSSProperties & Record<`--${string}`, string> = {
  "--bg": ui.bg,
  "--text": ui.text,
  "--line-strong": ui.lineStrong,
  "--accent": ui.accent,
  "--accent-ink": ui.accentInk,
};
