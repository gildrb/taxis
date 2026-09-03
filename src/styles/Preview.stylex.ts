import * as stylex from "@stylexjs/stylex";
import { colors, fonts } from "./tokens.stylex";

export const previewStyles = stylex.create({
  stage: {
    position: {
      default: "absolute",
      "@media (max-width: 900px) and (max-height: 520px)": "relative",
    },
    top: {
      default: 0,
      "@media (max-width: 900px) and (max-height: 520px)": "auto",
    },
    right: {
      default: 0,
      "@media (max-width: 900px) and (max-height: 520px)": "auto",
    },
    bottom: {
      default: 0,
      "@media (max-width: 900px) and (max-height: 520px)": "auto",
    },
    left: {
      default: 0,
      "@media (max-width: 900px) and (max-height: 520px)": "auto",
    },
    width: "100%",
    height: {
      default: "auto",
      "@media (max-width: 900px) and (max-height: 520px)": 184,
    },
    flexShrink: 0,
    order: {
      default: 0,
      "@media (max-width: 900px) and (max-height: 520px)": 2,
    },
    display: "flex",
    alignItems: {
      default: "center",
      "@media (max-width: 900px)": "flex-start",
    },
    paddingTop: {
      default: 76,
      "@media (min-height: 521px) and (max-width: 900px)": 70,
      "@media (max-width: 900px) and (max-height: 520px)": 8,
    },
    paddingRight: {
      default: 312,
      "@media (max-width: 900px)": 12,
    },
    paddingBottom: {
      default: 78,
      "@media (min-height: 521px) and (min-width: 521px) and (max-width: 900px)": "calc(43dvh + 82px)",
      "@media (min-height: 521px) and (max-width: 520px)": "calc(46dvh + 80px)",
      "@media (max-width: 900px) and (max-height: 520px)": 8,
    },
    paddingLeft: {
      default: 270,
      "@media (max-width: 900px)": 12,
    },
    overflow: "auto",
    scrollbarColor: "#3b3b41 transparent",
    scrollbarWidth: "thin",
    boxShadow: {
      default: "none",
      ":focus-visible": "inset 0 0 0 2px rgba(255, 255, 255, 0.72)",
    },
    outline: "none",
    isolation: "isolate",
  },
  stageBackdrop: {
    position: "absolute",
    inset: 0,
    zIndex: -2,
    backgroundImage: "radial-gradient(rgba(255, 255, 255, 0.035) 0.6px, transparent 0.7px)",
    backgroundSize: "7px 7px",
    opacity: 0.18,
    maskImage: "radial-gradient(circle at center, #000000 0, transparent 68%)",
    pointerEvents: "none",
  },
  canvasFrame: {
    display: "inline-grid",
    placeItems: "center",
    overflow: "hidden",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderStyle: "solid",
    borderWidth: 1,
    backgroundColor: "#ededed",
    backgroundImage: "linear-gradient(45deg, #d4d4d4 25%, transparent 25%), linear-gradient(-45deg, #d4d4d4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d4 75%), linear-gradient(-45deg, transparent 75%, #d4d4d4 75%)",
    backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
    backgroundSize: "16px 16px",
    boxShadow: "0 22px 70px rgba(0, 0, 0, 0.28)",

  },
  zoomSizer: {
    position: "relative",
    flexShrink: 0,
    marginTop: {
      default: "auto",
      "@media (max-width: 900px)": 0,
    },
    marginRight: "auto",
    marginBottom: "auto",
    marginLeft: "auto",
  },
  canvas: {
    width: "100%",
    height: "100%",
    display: "block",
    objectFit: "contain",
  },
  canvasInfo: {
    position: "absolute",
    left: {
      default: 270,
      "@media (max-width: 900px)": 14,
    },
    bottom: {
      default: 67,
      "@media (min-width: 521px) and (max-width: 900px)": "calc(43dvh + 75px)",
      "@media (max-width: 520px)": "calc(46dvh + 72px)",
    },
    display: {
      default: "flex",
      "@media (max-width: 900px) and (max-height: 520px)": "none",
    },
    gap: 12,
    color: colors.textMuted,
    fontFamily: fonts.mono,
    fontSize: 9,
    lineHeight: 1,
    textTransform: "uppercase",
  },
  changeSource: {
    position: "absolute",
    right: {
      default: 311,
      "@media (max-width: 900px)": 14,
    },
    bottom: {
      default: 62,
      "@media (min-width: 521px) and (max-width: 900px)": "calc(43dvh + 61px)",
      "@media (max-width: 520px)": "calc(46dvh + 58px)",
    },
    maxWidth: {
      default: 220,
      "@media (max-width: 900px)": 160,
    },
    height: 28,
    display: {
      default: "inline-flex",
      "@media (max-width: 900px)": "none",
    },
    alignItems: "center",
    gap: 7,
    paddingTop: 0,
    paddingRight: 9,
    paddingBottom: 0,
    paddingLeft: 9,
    overflow: "hidden",
    borderColor: {
      default: colors.line,
      ":hover": colors.lineStrong,
    },
    borderRadius: 7,
    borderStyle: "solid",
    borderWidth: 1,
    color: {
      default: colors.textMuted,
      ":hover": colors.text,
    },
    backgroundColor: {
      default: "rgba(22, 22, 24, 0.8)",
      ":hover": colors.surface,
    },
    fontSize: 9,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    transition: "none",
  },
  dropLayer: {
    position: "absolute",
    top: {
      default: 66,
      "@media (min-height: 521px) and (max-width: 900px)": 58,
      "@media (max-width: 900px) and (max-height: 520px)": 8,
    },
    right: {
      default: 296,
      "@media (max-width: 900px)": 8,
    },
    bottom: {
      default: 62,
      "@media (min-height: 521px) and (min-width: 521px) and (max-width: 900px)": "calc(43dvh + 70px)",
      "@media (min-height: 521px) and (max-width: 520px)": "calc(46dvh + 68px)",
      "@media (max-width: 900px) and (max-height: 520px)": 8,
    },
    left: {
      default: 256,
      "@media (max-width: 900px)": 8,
    },
    display: "grid",
    placeItems: "center",
    borderColor: "rgba(255, 255, 255, 0.45)",
    borderRadius: 12,
    borderStyle: "dashed",
    borderWidth: 1,
    backgroundColor: "rgba(18, 18, 20, 0.88)",
    backdropFilter: "blur(14px)",
  },
  dropContent: {
    display: "grid",
    justifyItems: "center",
    gap: 9,
  },
  dropTitle: {
    fontSize: 12,
    fontWeight: 500,
  },
  dropDetail: {
    color: colors.textMuted,
    fontSize: 9,
  },
});
