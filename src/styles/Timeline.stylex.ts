import * as stylex from "@stylexjs/stylex";
import { colors, fonts } from "./tokens.stylex";

export const timelineStyles = stylex.create({
  dock: {
    width: "100%", height: "100%", minWidth: 0, color: colors.text, backgroundColor: colors.panelSolid,
    borderTopColor: colors.lineStrong, borderTopStyle: "solid", borderTopWidth: 1, fontFamily: fonts.sans, fontSize: 14,
    padding: 10, overflowX: "hidden", overflowY: "auto", overscrollBehavior: "contain",
  },
  toolbar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0 },
  title: { fontWeight: 500, margin: 0, fontSize: 14 },
  button: {
    minHeight: { default: 32, "@media (pointer: coarse)": 44 }, paddingInline: 9, borderRadius: 4, whiteSpace: "nowrap",
    backgroundColor: { default: colors.surface, ":hover": colors.surfaceHover },
    color: colors.text, fontSize: 14, touchAction: "manipulation",
  },
  close: { marginLeft: "auto" },
  select: { minWidth: 130, width: 130, flexShrink: 0 },
  body: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", minHeight: 128, gap: 12, minWidth: 0, marginTop: 8 },
  tracks: { minWidth: 0 },
  scrubRow: { display: "flex", alignItems: "center", gap: 8 },
  scrub: { flexGrow: 1, minWidth: 80, accentColor: "#dedee3", cursor: "pointer", height: 24 },
  clock: { width: 72, color: colors.textSecondary, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  lane: { position: "relative", height: 38, marginInline: 14, borderBottomColor: colors.lineStrong, borderBottomStyle: "solid", borderBottomWidth: 1, backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "25% 100%" },
  cursorClip: { position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" },
  playhead: { position: "absolute", top: 0, bottom: 0, width: "100%", borderLeftColor: colors.textMuted, borderLeftStyle: "solid", borderLeftWidth: 1, pointerEvents: "none" },
  key: { position: "absolute", top: 3, width: 28, height: 32, transform: "translateX(-50%)", padding: 0, color: { default: colors.textSecondary, ":hover": "#ffffff" }, backgroundColor: "transparent", touchAction: "none", userSelect: "none", fontSize: 20 },
  selectedKey: { color: "#ffffff", backgroundColor: colors.surfaceSelected, borderRadius: 4 },
  fields: { display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" },
  label: { display: "flex", alignItems: "center", gap: 5, color: colors.textSecondary, fontSize: 14, whiteSpace: "nowrap" },
  number: { width: 64, minHeight: 28, paddingInline: 5, backgroundColor: "#1d1d20", color: colors.text, borderColor: colors.line, borderStyle: "solid", borderWidth: 1, borderRadius: 6, fontSize: 14, fontVariantNumeric: "tabular-nums" },
  easing: { display: "flex", alignItems: "center", gap: 8, borderLeftColor: colors.line, borderLeftStyle: "solid", borderLeftWidth: 1, paddingLeft: 10 },
  graph: { position: "relative", width: 108, height: 108, flexShrink: 0, backgroundColor: "#1b1b1e" },
  curve: { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" },
  handle: { position: "absolute", width: 28, height: 28, transform: "translate(-50%, -50%)", borderRadius: "50%", backgroundColor: "transparent", padding: 0, touchAction: "none", userSelect: "none", color: { default: "#ffffff", ":hover": "#aaaaaa" }, fontSize: 20 },
  coordinates: { display: "grid", gap: 4 },
  coordinate: { width: 55 },
  empty: { color: colors.textMuted, marginTop: 8, marginBottom: 0, fontSize: 14 },
});
