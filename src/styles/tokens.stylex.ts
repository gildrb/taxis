import * as stylex from "@stylexjs/stylex";

export const colors = stylex.defineVars({
  canvas: "#161617",
  panel: "rgba(17, 17, 19, 0.96)",
  panelSolid: "#111113",
  surface: "#1b1b1e",
  surfaceHover: "#242428",
  surfaceSelected: "#2d2d32",
  line: "rgba(255, 255, 255, 0.1)",
  lineStrong: "rgba(255, 255, 255, 0.17)",
  text: "#e3e3e7",
  textSecondary: "#aaaab0",
  textMuted: "#a0a0a8",
});

export const layout = stylex.defineVars({
  timelineDockHeight: "min(240px, 40dvh)",
  timelineDockGap: "12px",
});

export const fonts = stylex.defineVars({
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
});
