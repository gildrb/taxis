import { parsePreset } from "./params";
import type { PatternParams } from "./types";

interface ParsedSource {
  dataUrl?: string;
  fingerprint: string;
  kind?: "radial";
  name: string;
  size?: number;
  usesAlpha?: boolean;
}

export interface ParsedProject {
  fingerprint?: string;
  legacyParams?: PatternParams;
  params: PatternParams;
  source?: ParsedSource;
  version?: 1 | 2;
}

export function parseProject(value: unknown): ParsedProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project data must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.app === undefined) {
    if (["version", "fingerprint", "source"].some((key) => Object.hasOwn(raw, key))) {
      throw new Error("This project envelope is missing its Pattern Lab app marker.");
    }
    return { params: parsePreset(value) };
  }
  if (raw.app !== "Pattern Lab") throw new Error("This file is not a Pattern Lab project.");
  if (raw.version !== 1 && raw.version !== 2) {
    throw new Error("This project version is not supported. Export it again from a compatible Pattern Lab version.");
  }
  if (!Object.hasOwn(raw, "params") || !raw.params || typeof raw.params !== "object" || Array.isArray(raw.params)) {
    throw new Error("This project does not include valid pattern settings.");
  }
  const params = parsePreset({ params: raw.params });
  const legacyParams = raw.version === 1
    ? legacyParamsForFingerprint(params, raw.params as Record<string, unknown>)
    : undefined;
  const fingerprintPattern = raw.version === 1 ? /^[0-9a-f]{8}$/ : /^[0-9a-f]{16}$/;
  if (typeof raw.fingerprint !== "string" || !fingerprintPattern.test(raw.fingerprint)) {
    throw new Error("The project fingerprint is missing or invalid.");
  }
  if (!raw.source || typeof raw.source !== "object" || Array.isArray(raw.source)) {
    throw new Error("This project does not include a valid source image.");
  }

  const source = raw.source as Record<string, unknown>;
  if (typeof source.name !== "string" || source.name.trim() === "") {
    throw new Error("The project source name is missing.");
  }
  if (typeof source.fingerprint !== "string" || !fingerprintPattern.test(source.fingerprint)) {
    throw new Error("The project source fingerprint is missing or invalid.");
  }
  if (raw.version === 2 && typeof source.usesAlpha !== "boolean") {
    throw new Error("The project source channel policy is missing or invalid.");
  }
  if (raw.version === 1 && source.usesAlpha !== undefined && typeof source.usesAlpha !== "boolean") {
    throw new Error("The project source channel policy is invalid.");
  }
  if (source.dataUrl !== undefined && typeof source.dataUrl !== "string") {
    throw new Error("The embedded project source must be an image data URL.");
  }
  if (source.kind !== undefined && source.kind !== "radial") {
    throw new Error("The project source kind is not supported.");
  }
  if (source.dataUrl === undefined && source.kind !== "radial") {
    throw new Error("This project does not include its source image.");
  }
  if (source.dataUrl !== undefined && source.kind !== undefined) {
    throw new Error("The project source cannot be both embedded and generated.");
  }
  if (source.dataUrl !== undefined && !source.dataUrl.startsWith("data:image/")) {
    throw new Error("The embedded project source must be an image data URL.");
  }

  let size: number | undefined;
  if (source.kind === "radial") {
    if (raw.version === 1 && source.size === undefined) {
      size = 512;
    } else if (typeof source.size === "number" && Number.isInteger(source.size) && source.size >= 1 && source.size <= 4096) {
      size = source.size;
    } else {
      throw new Error("The generated project source size is missing or invalid.");
    }
  }

  return {
    fingerprint: raw.fingerprint,
    ...(legacyParams ? { legacyParams } : {}),
    params,
    version: raw.version,
    source: {
      name: source.name,
      fingerprint: source.fingerprint,
      ...(typeof source.usesAlpha === "boolean" ? { usesAlpha: source.usesAlpha } : {}),
      ...(source.dataUrl !== undefined ? { dataUrl: source.dataUrl } : {}),
      ...(source.kind === "radial" ? { kind: source.kind, size } : {}),
    },
  };
}

function legacyParamsForFingerprint(params: PatternParams, raw: Record<string, unknown>): PatternParams {
  const legacy = { ...params, colors: [...params.colors] } as PatternParams;
  for (const key of ["rowShift", "sourceBackground", "contrast", "luminanceBias", "scale", "offsetX", "offsetY"] as const) {
    if (typeof raw[key] === "number") legacy[key] = raw[key];
  }
  if (typeof raw.monoColor === "string") legacy.monoColor = raw.monoColor;
  if (typeof raw.backgroundColor === "string") legacy.backgroundColor = raw.backgroundColor;
  if (Array.isArray(raw.colors) && raw.colors.length === 4) legacy.colors = [...raw.colors] as PatternParams["colors"];
  return legacy;
}
