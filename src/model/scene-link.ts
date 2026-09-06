import { parsePreset } from "./params";
import type { PatternParams } from "./types";

/** Query includes its leading ?. Fragment is never sent in the HTTP request. */
export const MAX_SCENE_QUERY_LENGTH = 6_000;
export const MAX_SCENE_URL_LENGTH = 2_000_000;

/** Reads current-schema JSON from either transport; ambiguous or invalid links never silently win. */
export function readSceneSettings(url: URL): PatternParams | undefined {
  if (url.href.length > MAX_SCENE_URL_LENGTH) throw new Error("Scene link exceeds 2,000,000 characters. Use an exported Project JSON file instead.");
  const values = [...url.searchParams.getAll("settings"), ...new URLSearchParams(url.hash.slice(1)).getAll("settings")];
  if (values.length > 1) throw new Error("Scene link contains multiple settings values. Keep exactly one settings value in the query or fragment.");
  if (values.length === 0) return undefined;
  let value: unknown;
  try { value = JSON.parse(values[0]!); }
  catch { throw new Error("Scene link settings are not valid JSON. Use a valid scene link or Project JSON file."); }
  return parsePreset(value);
}

/** Returns a new URL. Large settings move to the fragment, never into an oversized HTTP query. */
export function writeSceneSettings(url: URL, params: PatternParams): URL {
  const settings = JSON.stringify(parsePreset(params));
  const next = new URL(url.href);
  next.searchParams.delete("settings");
  // Keep unrelated fragment entries (including a plain anchor) byte-for-byte.
  const fragment = next.hash.slice(1).split("&").filter(entry => !new URLSearchParams(entry).has("settings")).join("&");
  next.hash = fragment;
  if (next.search.length > MAX_SCENE_QUERY_LENGTH) throw new Error("Scene link has more than 6,000 query characters without its settings. Shorten the other query parameters or export Project JSON.");
  next.searchParams.set("settings", settings);
  if (next.search.length > MAX_SCENE_QUERY_LENGTH) {
    next.searchParams.delete("settings");
    next.hash = `${fragment}${fragment ? "&" : ""}settings=${encodeURIComponent(settings)}`;
  }
  if (next.href.length > MAX_SCENE_URL_LENGTH) throw new Error("Scene link exceeds 2,000,000 characters. Export Project JSON to preserve this scene.");
  return next;
}
