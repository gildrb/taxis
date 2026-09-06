import { parsePreset } from "./params";
import { parseVectorMask } from "./svg-mask";
import type { PatternParams, VectorMask } from "./types";

interface ParsedSource {
  dataUrl?: string;
  fingerprint: string;
  kind?: "radial";
  name: string;
  size?: number;
  usesAlpha?: boolean;
  vectorMask?: VectorMask;
}

export interface ParsedProject {
  fingerprint?: string;
  params: PatternParams;
  source?: ParsedSource;
  version?: 3;
}

export function parseProject(value: unknown): ParsedProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Project data must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.app === undefined) {
    if (["version", "fingerprint", "source"].some((key) => Object.hasOwn(raw, key))) {
      throw new Error("This project envelope is missing its Taxis app marker.");
    }
    return { params: parsePreset(value) };
  }
  if (raw.app !== "Taxis") throw new Error("This file is not a Taxis project.");
  if (raw.version !== 3) {
    throw new Error("This project version is not supported. Use the current Taxis scene schema.");
  }
  if (!Object.hasOwn(raw, "params") || !raw.params || typeof raw.params !== "object" || Array.isArray(raw.params)) {
    throw new Error("This project does not include valid pattern settings.");
  }
  const params = parsePreset(raw.params);
  const fingerprintPattern = /^[0-9a-f]{16}$/;
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
  if (typeof source.usesAlpha !== "boolean") {
    throw new Error("The project source channel policy is missing or invalid.");
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
  if (typeof source.dataUrl === "string" && source.dataUrl.length > 64 * 1024 * 1024) {
    throw new Error("Embedded source data must be smaller than 64 MB.");
  }
  if (source.dataUrl !== undefined && !source.dataUrl.startsWith("data:image/")) {
    throw new Error("The embedded project source must be an image data URL.");
  }

  if (source.vectorMask !== undefined && source.kind !== undefined) {
    throw new Error("Vector masks require an embedded source.");
  }
  const vectorMask = source.vectorMask === undefined ? undefined : parseVectorMask(source.vectorMask);

  let size: number | undefined;
  if (source.kind === "radial") {
    if (typeof source.size === "number" && Number.isInteger(source.size) && source.size >= 1 && source.size <= 4096) {
      size = source.size;
    } else {
      throw new Error("The generated project source size is missing or invalid.");
    }
  }

  return {
    fingerprint: raw.fingerprint,
    params,
    version: raw.version,
    source: {
      name: source.name,
      fingerprint: source.fingerprint,
      ...(typeof source.usesAlpha === "boolean" ? { usesAlpha: source.usesAlpha } : {}),
      ...(source.dataUrl !== undefined ? { dataUrl: source.dataUrl } : {}),
      ...(source.kind === "radial" ? { kind: source.kind, size } : {}),
      ...(vectorMask ? { vectorMask } : {}),
    },
  };
}
