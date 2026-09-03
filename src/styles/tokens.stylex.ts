import * as stylex from "@stylexjs/stylex";

export const colors = stylex.defineVars({
  canvas: "#1b1b1c",
  panel: "rgba(20, 20, 22, 0.9)",
  panelSolid: "#151517",
  surface: "#202023",
  surfaceHover: "#29292d",
  surfaceSelected: "#323237",
  line: "rgba(255, 255, 255, 0.1)",
  lineStrong: "rgba(255, 255, 255, 0.17)",
  text: "#f1f1f2",
  textSecondary: "#aaaab0",
  textMuted: "#a0a0a8",
});

export const fonts = stylex.defineVars({
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"SFMono-Regular", "Roboto Mono", "Liberation Mono", monospace',
});
