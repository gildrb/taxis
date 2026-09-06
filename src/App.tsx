import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls, type PanelSelection } from "./components/Controls";
import { Icon } from "./components/Icon";
import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { ExportMenu, type ExportRequest } from "./components/ExportMenu";
import { exportScene, getExportSupport, type ExportFormat, type ExportSupport } from "./export/encode";
import { downloadBlob, downloadText } from "./export/download";
import { usePatternHistory } from "./hooks/usePatternHistory";
import { generatePattern, projectFor } from "./model/pattern";
import type { TaxisApi } from "./api";
import { fingerprintText } from "./model/fingerprint";
import { parseProject } from "./model/project";
import { readSceneSettings, writeSceneSettings } from "./model/scene-link";
import { createRadialSource, dataUrlToSource, fileToSource } from "./model/source";
import { DEFAULT_PARAMS, PARAMETER_SCHEMA, applyPreset, outputSizeForSource, parsePreset, projectFingerprint, type PatternRecipe } from "./model/params";
import type { PatternParams, SourceData } from "./model/types";
import type { SvgRenderer } from "./render/native";
import { renderScene } from "./render/scene";
import { appStyles } from "./styles/App.stylex";
import { sharedStyles } from "./styles/shared.stylex";

interface UnresolvedSource {
  fingerprint: string;
  usesAlpha?: boolean;
  radialSize?: number;
  vectorFingerprint?: string;
}

function sourceCacheKey(source: SourceData): string {
  return `${source.fingerprint}:${source.usesAlpha ? 1 : 0}:${source.vectorMask ? fingerprintText(JSON.stringify(source.vectorMask)) : ""}`;
}

const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const SOURCE_CACHE_BYTES = 96 * 1024 * 1024;

function sourceMemorySize(source: SourceData): number {
  return source.pixels.byteLength + (source.dataUrl?.length ?? 0) * 2 + (source.vectorMask ? JSON.stringify(source.vectorMask).length * 2 : 0);
}

function parseZoom(value: string | null): number {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.round(Math.min(2, Math.max(0.5, parsed)) * 10) / 10;
}

function hasSceneMotion(params: PatternParams): boolean {
  if (params.animation !== "none") return true;
  if (!params.useCells) return false;
  return params.keyframeTracks.length > 0 || params.cellAnimations.some((cell) => cell.animation !== undefined && cell.animation !== "none");
}

function parseCellSelection(value: string | null): string | undefined {
  const match = /^cell:(0|[1-9]\d*):(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value ?? "");
  if (!match || Number(match[1]) >= 144 || Number(match[2]) >= 1024 || Number(match[3]) >= 1024) return undefined;
  return value ?? undefined;
}

function parseRadialSize(query: URLSearchParams): number | undefined {
  if (query.get("sourceKind") !== "radial") return undefined;
  const size = Number(query.get("sourceSize"));
  return Number.isInteger(size) && size >= 1 && size <= 4096 ? size : undefined;
}

export default function App({ renderer }: { renderer: SvgRenderer }) {
  const initialSource = useMemo(() => {
    const query = new URLSearchParams(window.location.search);
    const generated = createRadialSource(parseRadialSize(query) ?? 512);
    const linkedFingerprint = query.get("source");
    const alphaValue = query.get("sourceAlpha");
    if (linkedFingerprint === generated.fingerprint && (alphaValue === "0" || alphaValue === "1")) {
      return { ...generated, usesAlpha: alphaValue === "1" };
    }
    return generated;
  }, []);
  const initialSettings = useMemo(() => {
    try {
      return { params: readSceneSettings(new URL(window.location.href)) ?? DEFAULT_PARAMS, invalid: false };
    } catch {
      return { params: DEFAULT_PARAMS, invalid: true };
    }
  }, []);
  const requestedSourceFingerprint = useMemo(() => new URLSearchParams(window.location.search).get("source"), []);
  const requestedSourceUsesAlpha = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("sourceAlpha");
    return value === "1" ? true : value === "0" ? false : undefined;
  }, []);
  const requestedRadialSize = useMemo(() => parseRadialSize(new URLSearchParams(window.location.search)), []);
  const requestedVectorFingerprint = useMemo(() => new URLSearchParams(window.location.search).get("sourceVector") ?? undefined, []);
  const history = usePatternHistory(initialSource, initialSettings.params);
  const source = history.source;
  const vectorFingerprint = useMemo(() => source.vectorMask ? fingerprintText(JSON.stringify(source.vectorMask)) : undefined, [source.vectorMask]);
  const [playing, setPlaying] = useState(false);
  const playbackTimeRef = useRef(history.params.animationTime);
  const [unresolvedSource, setUnresolvedSource] = useState<UnresolvedSource | undefined>(() => requestedSourceFingerprint && (requestedSourceFingerprint !== source.fingerprint || requestedSourceUsesAlpha !== undefined && requestedSourceUsesAlpha !== source.usesAlpha)
    ? { fingerprint: requestedSourceFingerprint, usesAlpha: requestedSourceUsesAlpha, radialSize: requestedRadialSize, vectorFingerprint: requestedVectorFingerprint }
    : undefined);
  const initialSourceKey = sourceCacheKey(initialSource);
  const currentSourceKey = sourceCacheKey(source);
  const sourceCacheRef = useRef(new Map<string, typeof source>([[initialSourceKey, initialSource]]));
  const sourceCache = sourceCacheRef.current;
  sourceCache.delete(currentSourceKey);
  sourceCache.set(currentSourceKey, source);
  let cachedBytes = [...sourceCache.values()].reduce((total, cached) => total + sourceMemorySize(cached), 0);
  for (const [key, cached] of sourceCache) {
    if (cachedBytes <= SOURCE_CACHE_BYTES) break;
    if (key === currentSourceKey) continue;
    sourceCache.delete(key);
    cachedBytes -= sourceMemorySize(cached);
  }
  const lastUrlSignatureRef = useRef<string | undefined>(undefined);
  const preserveInitialInvalidUrlRef = useRef(initialSettings.invalid);
  const urlGroupTimerRef = useRef<number | undefined>(undefined);
  const unlinkedSettingsRef = useRef(false);
  const [selected, setSelected] = useState<PanelSelection>(() => {
    const panel = new URLSearchParams(window.location.search).get("panel");
    return panel === "source" || panel === "canvas" ? panel : "pattern";
  });
  const [zoom, setZoom] = useState(() => parseZoom(new URLSearchParams(window.location.search).get("zoom")));
  const [selectedCellId, setSelectedCellId] = useState(() => parseCellSelection(new URLSearchParams(window.location.search).get("cell")));
  const [timelineOpen, setTimelineOpen] = useState(() => new URLSearchParams(window.location.search).get("timeline") === "1");
  const timelineButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!history.params.useCells) setTimelineOpen(false); }, [history.params.useCells]);
  const [notice, setNoticeState] = useState<{ id: number; message: string } | undefined>(() => initialSettings.invalid
    ? { id: 1, message: "This link does not contain valid Taxis settings." }
    : undefined);
  const noticeIdRef = useRef(initialSettings.invalid ? 1 : 0);
  const setNotice = useCallback((message?: string) => {
    setNoticeState(message === undefined ? undefined : { id: ++noticeIdRef.current, message });
  }, []);
  const [renderError, setRenderError] = useState<string>();
  const [busy, setBusy] = useState<ExportRequest["format"]>();
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string>();
  const exportControllerRef = useRef<AbortController | undefined>(undefined);
  const [exportCapabilities, setExportCapabilities] = useState<Record<ExportFormat, ExportSupport>>(() => Object.fromEntries(
    ["svg", "png", "jpeg", "webp", "mp4", "webm"].map((format) => [format, { supported: false, reason: "Checking export support…" }]),
  ) as Record<ExportFormat, ExportSupport>);
  useEffect(() => {
    let current = true;
    void getExportSupport(history.params.width, history.params.height).then((support) => {
      if (current) setExportCapabilities(support);
    }).catch((error: unknown) => {
      if (current) setExportError(error instanceof Error ? error.message : "Export support could not be checked. Reopen Export to try again.");
    });
    return () => { current = false; };
  }, [history.params.width, history.params.height]);
  useEffect(() => () => exportControllerRef.current?.abort(), []);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const toastButtonRef = useRef<HTMLButtonElement>(null);
  const noticeOriginRef = useRef<HTMLElement | undefined>(undefined);

  useEffect(() => {
    if (!notice) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== toastButtonRef.current) noticeOriginRef.current = active;
    const timeout = window.setTimeout(() => {
      if (document.activeElement === toastButtonRef.current) {
        const origin = noticeOriginRef.current;
        (origin?.isConnected ? origin : resetButtonRef.current)?.focus();
      }
      setNotice(undefined);
    }, 6_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (requestedSourceFingerprint && (requestedSourceFingerprint !== source.fingerprint || requestedSourceUsesAlpha !== undefined && requestedSourceUsesAlpha !== source.usesAlpha)) {
      setNotice(initialSettings.invalid
        ? "This link does not contain valid Taxis settings, and its original source image is unavailable."
        : "The linked settings were restored. Reopen the original source image to restore its pixels.");
    }
  }, []);

  useEffect(() => {
    const sourceFingerprint = unresolvedSource?.fingerprint ?? source.fingerprint;
    const sourceUsesAlpha = unresolvedSource ? unresolvedSource.usesAlpha : source.usesAlpha;
    const radialSize = unresolvedSource ? unresolvedSource.radialSize : source.kind === "radial" ? source.width : undefined;
    const sourceVector = unresolvedSource ? unresolvedSource.vectorFingerprint : vectorFingerprint;
    const signature = JSON.stringify([history.params, sourceFingerprint, sourceUsesAlpha ?? null, radialSize ?? null, sourceVector ?? null, selected, zoom, selectedCellId, timelineOpen]);
    if (preserveInitialInvalidUrlRef.current) {
      preserveInitialInvalidUrlRef.current = false;
      lastUrlSignatureRef.current = signature;
      return;
    }
    if (signature === lastUrlSignatureRef.current) return;
    let url = new URL(window.location.href);
    url.searchParams.set("source", sourceFingerprint);
    if (sourceVector) url.searchParams.set("sourceVector", sourceVector);
    else url.searchParams.delete("sourceVector");
    if (sourceUsesAlpha === undefined) url.searchParams.delete("sourceAlpha");
    else url.searchParams.set("sourceAlpha", sourceUsesAlpha ? "1" : "0");
    if (radialSize === undefined) {
      url.searchParams.delete("sourceKind");
      url.searchParams.delete("sourceSize");
    } else {
      url.searchParams.set("sourceKind", "radial");
      url.searchParams.set("sourceSize", String(radialSize));
    }
    if (selected === "pattern") url.searchParams.delete("panel");
    else url.searchParams.set("panel", selected);
    if (zoom === 1) url.searchParams.delete("zoom");
    else url.searchParams.set("zoom", zoom.toFixed(1));
    if (selectedCellId) url.searchParams.set("cell", selectedCellId);
    else url.searchParams.delete("cell");
    if (timelineOpen) url.searchParams.set("timeline", "1");
    else url.searchParams.delete("timeline");

    try {
      url = writeSceneSettings(url, history.params);
      const initialized = lastUrlSignatureRef.current !== undefined;
      if (!initialized) {
        window.history.replaceState(null, "", url);
        lastUrlSignatureRef.current = signature;
        return;
      }
      window.history[urlGroupTimerRef.current === undefined ? "pushState" : "replaceState"](null, "", url);
      lastUrlSignatureRef.current = signature;
      if (urlGroupTimerRef.current !== undefined) window.clearTimeout(urlGroupTimerRef.current);
      urlGroupTimerRef.current = window.setTimeout(() => { urlGroupTimerRef.current = undefined; }, 400);
      unlinkedSettingsRef.current = false;
    } catch (error) {
      unlinkedSettingsRef.current = true;
      lastUrlSignatureRef.current = signature;
      setNotice(error instanceof Error ? error.message : "Scene link could not be saved. Export Project JSON to preserve this scene.");
    }
  }, [history.params, selected, source.fingerprint, source.kind, source.usesAlpha, unresolvedSource, vectorFingerprint, zoom, selectedCellId, timelineOpen]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (source.kind === "radial" && !unlinkedSettingsRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [source.fingerprint, source.kind]);

  const sourceRequestRef = useRef(0);
  const revisionRef = useRef({ dimensions: 0, offsetX: 0, offsetY: 0, scale: 0, sourceRotation: 0, scene: 0 });
  const markParamChanges = useCallback((keys: readonly (keyof PatternParams)[]) => {
    const revisions = revisionRef.current;
    revisions.scene++;
    if (keys.includes("width") || keys.includes("height")) revisions.dimensions++;
    if (keys.includes("scale")) revisions.scale++;
    if (keys.includes("offsetX")) revisions.offsetX++;
    if (keys.includes("offsetY")) revisions.offsetY++;
    if (keys.includes("sourceRotation")) revisions.sourceRotation++;
  }, []);
  const paramsRef = useRef(history.params);
  const sourceRef = useRef(source);
  paramsRef.current = history.params;
  sourceRef.current = source;
  useEffect(() => {
    const restore = () => {
      try {
        const query = new URLSearchParams(window.location.search);
        const nextParams = readSceneSettings(new URL(window.location.href)) ?? DEFAULT_PARAMS;
        const panel = query.get("panel");
        const nextPanel: PanelSelection = panel === "source" || panel === "canvas" ? panel : "pattern";
        const nextZoom = parseZoom(query.get("zoom"));
        const linkedFingerprint = query.get("source") ?? initialSource.fingerprint;
        const alphaValue = query.get("sourceAlpha");
        const linkedUsesAlpha = alphaValue === "1" ? true : alphaValue === "0" ? false : undefined;
        const linkedRadialSize = parseRadialSize(query);
        const linkedVector = query.get("sourceVector") ?? undefined;
        let cachedSource = [...sourceCacheRef.current.values()].find((candidate) => candidate.fingerprint === linkedFingerprint
          && (linkedUsesAlpha === undefined || candidate.usesAlpha === linkedUsesAlpha)
          && (!linkedVector || candidate.vectorMask && fingerprintText(JSON.stringify(candidate.vectorMask)) === linkedVector));
        if (!cachedSource && linkedRadialSize !== undefined) {
          const generated = createRadialSource(linkedRadialSize);
          if (generated.fingerprint === linkedFingerprint) {
            cachedSource = { ...generated, usesAlpha: linkedUsesAlpha ?? generated.usesAlpha };
          }
        }
        sourceRequestRef.current++;
        setPlaying(false);
        history.endTransaction();
        markParamChanges(Object.keys(nextParams) as (keyof PatternParams)[]);
        if (cachedSource) {
          setUnresolvedSource(undefined);
          history.commitScene({ params: nextParams, source: cachedSource });
        } else {
          setUnresolvedSource({ fingerprint: linkedFingerprint, usesAlpha: linkedUsesAlpha, radialSize: linkedRadialSize, vectorFingerprint: linkedVector });
          history.commit(nextParams);
          setNotice("The linked settings were restored. Reopen the original source image to restore its pixels.");
        }
        setSelected(nextPanel);
        setZoom(nextZoom);
        const nextCell = parseCellSelection(query.get("cell"));
        setSelectedCellId(nextCell);
        const nextTimeline = query.get("timeline") === "1" && nextParams.useCells;
        setTimelineOpen(nextTimeline);
        lastUrlSignatureRef.current = JSON.stringify([nextParams, linkedFingerprint, linkedUsesAlpha ?? cachedSource?.usesAlpha ?? null, linkedRadialSize ?? (cachedSource?.kind === "radial" ? cachedSource.width : null), linkedVector ?? null, nextPanel, nextZoom, nextCell, nextTimeline]);
        if (urlGroupTimerRef.current !== undefined) window.clearTimeout(urlGroupTimerRef.current);
        urlGroupTimerRef.current = undefined;
      } catch {
        setNotice("This history entry does not contain valid Taxis settings.");
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [history.commit, history.commitScene, history.endTransaction, initialSource.fingerprint, markParamChanges, setNotice]);

  const hasAnimation = hasSceneMotion(history.params) || (timelineOpen && history.params.useCells);
  const playbackEnd = history.params.useCells && (timelineOpen || history.params.keyframeTracks.length > 0) && !history.params.keyframeLoop ? history.params.keyframeDuration : 86400;
  const cellEntities = useMemo(() => {
    if (!history.params.useCells) return [];
    try { return generatePattern({ params: history.params, source }).entities ?? []; }
    catch { return []; } // Preview reports the same evaluator error; do not replace its last valid frame.
  }, [history.params, source]);

  const pausePlayback = useCallback(() => {
    const params = playing ? { ...paramsRef.current, animationTime: playbackTimeRef.current } : paramsRef.current;
    setPlaying(false);
    if (playing) {
      history.endTransaction();
      markParamChanges(["animationTime"]);
      history.commit(params);
      paramsRef.current = params;
    }
    return params;
  }, [history.commit, history.endTransaction, markParamChanges, playing]);

  const pickCell = useCallback((x: number, y: number) => {
    try {
      const params = pausePlayback();
      const entities = generatePattern({ params, source: sourceRef.current }).entities ?? [];
      const hit = [...entities].reverse().find((entity) => {
        const shape = entity.primitive;
        return entity.visible && shape && shape.opacity > 0 && x >= shape.x && x <= shape.x + shape.width && y >= shape.y && y <= shape.y + shape.height;
      });
      setSelectedCellId(hit?.id);
      if (hit) setSelected("pattern");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Cell selection failed."); }
  }, [pausePlayback, setNotice]);

  const stepCell = useCallback((column: number, row: number) => {
    try {
      const params = pausePlayback();
      const entities = (generatePattern({ params, source: sourceRef.current }).entities ?? []).filter((entity) => entity.visible);
      const current = entities.find((entity) => entity.id === selectedCellId);
      const next = current
        ? entities.find((entity) => entity.repeatIndex === current.repeatIndex && entity.row === current.row + row && entity.column === current.column + column)
        : entities.reduce<(typeof entities)[number] | undefined>((closest, entity) => {
          const distance = (cell: (typeof entities)[number]) => (cell.pose.x - params.width / 2) ** 2 + (cell.pose.y - params.height / 2) ** 2;
          return !closest || distance(entity) < distance(closest) ? entity : closest;
        }, undefined);
      if (next) { setSelectedCellId(next.id); setSelected("pattern"); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Cell selection failed."); }
  }, [pausePlayback, selectedCellId, setNotice]);

  const commitParams = useCallback((patch: unknown) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Parameter edits must be an object.");
    const keys = Object.keys(patch);
    for (const key of keys) {
      if (!Object.hasOwn(DEFAULT_PARAMS, key)) throw new Error(`Unknown pattern parameter “${key}”.`);
    }
    const resizesCanvas = keys.includes("width") || keys.includes("height");
    let committed = paramsRef.current;
    history.commit((params) => {
      const next = parsePreset({ ...params, ...(playing ? { animationTime: playbackTimeRef.current } : {}), ...patch });
      if (resizesCanvas && !keys.includes("fit") && params.fit === "contain"
        && next.width * sourceRef.current.height !== next.height * sourceRef.current.width) next.fit = "cover";
      committed = next;
      return next;
    });
    paramsRef.current = committed;
    markParamChanges((resizesCanvas ? [...keys, "fit"] : keys) as (keyof PatternParams)[]);
    setPlaying(false);
    return projectFor({ params: committed, source: sourceRef.current });
  }, [history.commit, markParamChanges, playing]);

  const reportRenderError = useCallback((message?: string) => {
    setRenderError(message);
    if (message) {
      setNotice(undefined);
      setPlaying(false);
    }
  }, []);

  const togglePlayback = useCallback(() => {
    if (playing) { pausePlayback(); return; }
    if (!hasAnimation || renderError) return;
    if (paramsRef.current.animationTime >= playbackEnd) commitParams({ animationTime: 0 });
    history.endTransaction();
    setPlaying(true);
  }, [playing, pausePlayback, hasAnimation, renderError, playbackEnd, commitParams, history.endTransaction]);

  const reportPlaybackTime = useCallback((time: number) => {
    playbackTimeRef.current = time;
  }, []);

  const loadImage = async (file: File) => {
    pausePlayback();
    const request = ++sourceRequestRef.current;
    const sourceAtRequest = sourceRef.current;
    const unresolvedAtRequest = unresolvedSource;
    const revisionsAtRequest = { ...revisionRef.current };
    const next = await fileToSource(file, renderer);
    if (request !== sourceRequestRef.current) throw new DOMException("Source import superseded by a newer scene request.", "AbortError");
    if (sourceRef.current !== sourceAtRequest) throw new Error("Source import canceled because the scene changed.");
    const latest = paramsRef.current;
    let nextScene: { source: SourceData; params: PatternParams };
    if (unresolvedAtRequest) {
      const nextVector = next.vectorMask ? fingerprintText(JSON.stringify(next.vectorMask)) : undefined;
      if (next.fingerprint !== unresolvedAtRequest.fingerprint || unresolvedAtRequest.vectorFingerprint && nextVector !== unresolvedAtRequest.vectorFingerprint) {
        throw new Error("That image does not match the linked source. Reopen the original image, or Reset to start a new scene.");
      }
      nextScene = { source: { ...next, usesAlpha: unresolvedAtRequest.usesAlpha ?? next.usesAlpha }, params: latest };
    } else {
      const mappedSize = outputSizeForSource(next);
      const revisions = revisionRef.current;
      const dimensionsChanged = revisions.dimensions !== revisionsAtRequest.dimensions;
      nextScene = {
        source: next,
        params: {
          ...latest,
          width: dimensionsChanged ? latest.width : mappedSize.width,
          height: dimensionsChanged ? latest.height : mappedSize.height,
          scale: revisions.scale === revisionsAtRequest.scale ? 1 : latest.scale,
          offsetX: revisions.offsetX === revisionsAtRequest.offsetX ? 0 : latest.offsetX,
          offsetY: revisions.offsetY === revisionsAtRequest.offsetY ? 0 : latest.offsetY,
          sourceRotation: revisions.sourceRotation === revisionsAtRequest.sourceRotation ? 0 : latest.sourceRotation,
          sourceMode: !latest.useCells && latest.sourceMode === "mask" && !next.vectorMask && next.kind !== "radial" ? "sample" : latest.sourceMode,
        },
      };
    }
    setUnresolvedSource(undefined);
    history.commitScene(nextScene, true);
    paramsRef.current = nextScene.params;
    sourceRef.current = nextScene.source;
    setNotice(unresolvedAtRequest
      ? `${file.name} restored for the linked settings`
      : !latest.useCells && latest.sourceMode === "mask" && !next.vectorMask && next.kind !== "radial"
        ? `${file.name} imported in Sample mode. Precise masking needs an SVG with supported filled paths.`
        : `${file.name} loaded.`);
    return projectFor(nextScene);
  };

  const exportFile = async (request: ExportRequest) => {
    if (exportControllerRef.current) return;
    if (request.format !== "json" && renderError) { setExportError(renderError); return; }
    const controller = new AbortController();
    exportControllerRef.current = controller;
    const pausedParams = pausePlayback();
    const fullClip = (request.format === "mp4" || request.format === "webm") && pausedParams.useCells && pausedParams.keyframeTracks.length > 0;
    const exportParams = fullClip ? { ...pausedParams, animationTime: 0 } : pausedParams;
    const exportSource = sourceRef.current;
    const exportFingerprint = projectFingerprint(exportParams, exportSource);
    setBusy(request.format);
    setExportProgress(0);
    setExportError(undefined);
    try {
      const input = { params: exportParams, source: exportSource };
      const baseName = `taxis-${exportFingerprint}`;
      if (request.format === "json") {
        downloadText(JSON.stringify(projectFor(input), null, 2), `${baseName}.json`, "application/json");
      } else {
        const blob = await exportScene(input, renderer, {
          ...request,
          format: request.format,
          signal: controller.signal,
          onProgress: ({ completed, total }) => setExportProgress(completed / total),
        });
        controller.signal.throwIfAborted();
        downloadBlob(blob, `${baseName}.${request.format === "jpeg" ? "jpg" : request.format}`);
      }
      setNotice("Export complete.");
    } catch (error) {
      if (controller.signal.aborted) setNotice("Export canceled.");
      else {
        const message = error instanceof Error ? error.message : "Export failed. Try again.";
        setExportError(message);
        setNotice(message);
      }
    } finally {
      exportControllerRef.current = undefined;
      setBusy(undefined);
    }
  };

  const importProject = async (value: unknown) => {
    const paramsAtRequest = JSON.stringify(pausePlayback());
    const request = ++sourceRequestRef.current;
    const sceneRevisionAtRequest = revisionRef.current.scene;
    const sourceAtRequest = sourceRef.current;
    if (value instanceof File && value.size > MAX_PROJECT_BYTES) throw new Error("Project files must be smaller than 64 MB.");
    const project = parseProject(value instanceof File ? JSON.parse(await value.text()) : value);
    if (request !== sourceRequestRef.current) throw new DOMException("Project import superseded by a newer scene request.", "AbortError");
    const decodedSource = project.source
      ? project.source.dataUrl ? await dataUrlToSource(project.source.dataUrl, project.source.name, renderer) : createRadialSource(project.source.size)
      : sourceAtRequest;
    if (request !== sourceRequestRef.current) throw new DOMException("Project import superseded by a newer scene request.", "AbortError");
    if (revisionRef.current.scene !== sceneRevisionAtRequest
      || JSON.stringify(paramsRef.current) !== paramsAtRequest || sourceRef.current !== sourceAtRequest) {
      throw new Error("Project import canceled because the scene changed.");
    }
    const nextSource = project.source ? {
      ...decodedSource,
      name: project.source.name,
      usesAlpha: project.source.usesAlpha!,
      ...(project.source.vectorMask ? { vectorMask: project.source.vectorMask } : {}),
    } : sourceAtRequest;
    if (project.source) {
      if (project.source.fingerprint !== nextSource.fingerprint) throw new Error("The embedded source does not match this project fingerprint.");
      if (project.fingerprint !== projectFingerprint(project.params, nextSource)) throw new Error("The project settings or source have changed since export.");
      setUnresolvedSource(undefined);
    }
    markParamChanges(Object.keys(project.params) as (keyof PatternParams)[]);
    history.commitScene({ params: project.params, source: nextSource });
    paramsRef.current = project.params;
    sourceRef.current = nextSource;
    const restored = projectFor({ params: project.params, source: nextSource });
    setNotice(project.source ? "Project restored." : "Settings imported.");
    return restored;
  };

  const apiHandlers = useRef({ commitParams, importProject, loadImage });
  apiHandlers.current = { commitParams, importProject, loadImage };
  useEffect(() => {
    const api: TaxisApi = {
      version: 1,
      renderer: "Kor/Archetypon",
      schema: structuredClone(PARAMETER_SCHEMA),
      getScene: () => projectFor({ params: paramsRef.current, source: sourceRef.current }),
      setParams: (patch) => apiHandlers.current.commitParams(patch),
      setScene: (scene) => apiHandlers.current.importProject(scene),
      setSource: (file) => apiHandlers.current.loadImage(file),
      evaluate: (time = 0) => generatePattern({ params: paramsRef.current, source: sourceRef.current, time }),
      svg: (time = 0) => new TextDecoder().decode(renderScene({ params: paramsRef.current, source: sourceRef.current, time }, renderer, "svg")),
      render: (time = 0) => renderScene({ params: paramsRef.current, source: sourceRef.current, time }, renderer, "rgba"),
      png: (time = 0) => renderScene({ params: paramsRef.current, source: sourceRef.current, time }, renderer, "png"),
      export: (options, time = 0) => exportScene({ params: paramsRef.current, source: sourceRef.current, time }, renderer, options),
    };
    window.taxis = api;
    return () => { if (window.taxis === api) Reflect.deleteProperty(window, "taxis"); };
  }, [renderer]);

  const reportImportError = (error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    setNotice(error instanceof Error ? error.message : "Import failed.");
  };

  const applyRecipe = (recipe: PatternRecipe) => {
    if (recipe.params.sourceMode === "mask" && source.kind !== "radial" && !source.vectorMask) {
      setNotice("This recipe needs an SVG source with supported filled paths, or the generated sphere.");
      return;
    }
    setPlaying(false);
    markParamChanges(Object.keys(recipe.params) as (keyof PatternParams)[]);
    history.commit((params) => applyPreset(playing ? { ...params, animationTime: playbackTimeRef.current } : params, recipe.params));
  };

  const undo = () => {
    setPlaying(false);
    sourceRequestRef.current++;
    markParamChanges(["width", "height", "scale", "offsetX", "offsetY"]);
    history.undo();
  };

  const redo = () => {
    setPlaying(false);
    sourceRequestRef.current++;
    markParamChanges(["width", "height", "scale", "offsetX", "offsetY"]);
    history.redo();
  };

  const layers: ReadonlyArray<{ id: PanelSelection; name: string; detail: string; icon: "grid" | "image" | "canvas" }> = [
    { id: "pattern", name: "Pattern", detail: history.params.useCells ? `${history.params.cellShape} cells` : { bars: "Horizontal raster", candles: "Vertical raster", shapes: "Shape mosaic", stripes: "Uniform stripes", radial: "Radial rays", rings: "Concentric rings" }[history.params.preset], icon: "grid" },
    { id: "source", name: "Source", detail: source.name, icon: "image" },
    { id: "canvas", name: "Canvas", detail: `${history.params.width} × ${history.params.height}`, icon: "canvas" },
  ];

  const statusMessage = notice?.message;

  return (
    <main {...stylex.props(appStyles.appShell)}>
      <a {...stylex.props(appStyles.skipLink)} href="#properties-panel">Skip to properties</a>
      <h1 {...stylex.props(sharedStyles.visuallyHidden)}>Taxis</h1>

      <div role="group" {...stylex.props(sharedStyles.glassPanel, appStyles.topToolbar)} aria-label="Canvas tools">
        <span {...stylex.props(appStyles.toolbarGroup)}>
          <button {...stylex.props(appStyles.toolbarButton)} type="button" disabled={!history.canUndo} onClick={undo} aria-label="Undo"><Icon name="undo" /></button>
          <button {...stylex.props(appStyles.toolbarButton)} type="button" disabled={!history.canRedo} onClick={redo} aria-label="Redo"><Icon name="redo" /></button>
        </span>
        <span {...stylex.props(appStyles.toolbarSeparator)} aria-hidden="true" />
        <span {...stylex.props(appStyles.toolbarGroup)}>
          <button {...stylex.props(appStyles.toolbarButton, appStyles.narrowZoomButton)} type="button" aria-label="Zoom out" aria-disabled={zoom <= 0.5} onClick={() => { if (zoom > 0.5) setZoom((value) => Math.max(0.5, value - 0.1)); }}><Icon name="zoomOut" /></button>
          <button {...stylex.props(appStyles.zoomOutput)} type="button" aria-label={`Canvas zoom ${Math.round(zoom * 100)}%. Fit canvas`} aria-disabled={zoom === 1} onClick={() => { if (zoom !== 1) setZoom(1); }}>{Math.round(zoom * 100)}%</button>
          <button {...stylex.props(appStyles.toolbarButton, appStyles.narrowZoomButton)} type="button" aria-label="Zoom in" aria-disabled={zoom >= 2} onClick={() => { if (zoom < 2) setZoom((value) => Math.min(2, value + 0.1)); }}><Icon name="zoomIn" /></button>
        </span>
        <span {...stylex.props(appStyles.toolbarSeparator)} aria-hidden="true" />
        <button {...stylex.props(appStyles.toolbarButton)} ref={resetButtonRef} type="button" aria-label="Reset project" onClick={() => { setPlaying(false); sourceRequestRef.current++; markParamChanges(["width", "height", "scale", "offsetX", "offsetY", "sourceRotation"]); history.reset(createRadialSource()); setSelectedCellId(undefined); setUnresolvedSource(undefined); setZoom(1); setRenderError(undefined); setNotice("Scene reset."); }}><Icon name="reset" /></button>
      </div>

      <aside {...stylex.props(sharedStyles.glassPanel, appStyles.layersPanel)} aria-label="Layers">
        <header {...stylex.props(sharedStyles.panelHeader)}>
          <span>Layers</span>
          <button {...stylex.props(sharedStyles.panelHeaderButton)} type="button" aria-label="Add source image" onClick={() => sourceInputRef.current?.click()}><Icon name="plus" size={14} /></button>
        </header>
        <div {...stylex.props(appStyles.layerList)}>
          {layers.map((layer) => (
            <button key={layer.id} type="button" {...stylex.props(appStyles.layer, selected === layer.id && appStyles.activeLayer)} aria-pressed={selected === layer.id} onClick={() => setSelected(layer.id)}>
              <span {...stylex.props(appStyles.layerGrip)} aria-hidden="true">⠿</span>
              <span {...stylex.props(appStyles.layerIcon)}><Icon name={layer.icon} size={14} /></span>
              <span {...stylex.props(appStyles.layerCopy)}><strong {...stylex.props(appStyles.layerName)}>{layer.name}</strong><small {...stylex.props(appStyles.layerDetail)}>{layer.detail}</small></span>
            </button>
          ))}
        </div>
        <footer {...stylex.props(appStyles.layersFooter)}><a href="/public/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noopener noreferrer" aria-label="Taxis licenses" style={{ color: "inherit", textDecoration: "none" }}>Taxis</a></footer>
      </aside>

      <Preview
        renderer={renderer}
        params={history.params}
        source={source}
        zoom={zoom}
        playing={playing}
        onFrameTime={reportPlaybackTime}
        onPlaybackEnd={pausePlayback}
        playbackEnd={playbackEnd}
        timelineOpen={timelineOpen}
        selection={cellEntities.find((entity) => entity.id === selectedCellId && entity.visible)?.primitive ?? undefined}
        onPickCell={history.params.useCells && !renderError ? pickCell : undefined}
        onStepCell={history.params.useCells && !renderError ? stepCell : undefined}
        onClearCell={() => setSelectedCellId(undefined)}
        onFile={(file) => { void loadImage(file).catch(reportImportError); }}
        onChooseSource={() => sourceInputRef.current?.click()}
        onError={reportRenderError}
      />

      <div {...stylex.props(appStyles.propertiesContainer, timelineOpen && appStyles.propertiesHiddenForTimeline)}>
      <Controls
        entities={cellEntities}
        selectedCellId={selectedCellId}
        onSelectCell={(id) => { pausePlayback(); setSelectedCellId(id); }}
        selected={selected}
        params={history.params}
        source={source}
        onChange={(key, value) => { commitParams({ [key]: value }); }}
        onChangeEnd={history.endTransaction}
        onChangeStart={history.beginTransaction}
        renderError={renderError}
        onSelect={setSelected}
        onPreset={applyRecipe}
        playing={playing}
        onTogglePlayback={hasAnimation && !renderError ? togglePlayback : undefined}
        onResetPlayback={() => { commitParams({ animationTime: 0, animationPhase: 0 }); }}
        onChooseSource={() => sourceInputRef.current?.click()}
      />
      </div>
      {timelineOpen && <div id="cell-timeline" {...stylex.props(appStyles.timelineDock)}>
        <Timeline
          params={history.params}
          selectedCellId={selectedCellId}
          playing={playing}
          getTime={() => playing ? playbackTimeRef.current : paramsRef.current.animationTime}
          onPatch={(patch) => {
            const resume = playing;
            const next = commitParams(patch).params;
            if (resume && (hasSceneMotion(next) || (timelineOpen && next.useCells))) setPlaying(true);
          }}
          onSeek={(time) => { commitParams({ animationTime: time }); }}
          onTogglePlayback={togglePlayback}
          onClose={() => { pausePlayback(); setTimelineOpen(false); requestAnimationFrame(() => timelineButtonRef.current?.focus()); }}
          onInteractionStart={history.beginTransaction}
          onInteractionEnd={history.endTransaction}
        />
      </div>}

      <footer {...stylex.props(sharedStyles.glassPanel, appStyles.exportToolbar)}>
        <span {...stylex.props(appStyles.toolbarSeparator, appStyles.mobileToolbarSeparator)} aria-hidden="true" />
        <button {...stylex.props(appStyles.exportButton)} type="button" onClick={() => projectInputRef.current?.click()}><Icon name="folder" size={14} /> Open Project</button>
        <button {...stylex.props(appStyles.exportButton, timelineOpen && appStyles.timelineButtonActive)} ref={timelineButtonRef} type="button" aria-expanded={timelineOpen} aria-controls={timelineOpen ? "cell-timeline" : undefined} disabled={!history.params.useCells} onClick={() => { pausePlayback(); setTimelineOpen((open) => !open); }}>Timeline</button>
        <ExportMenu
          capabilities={{ ...Object.fromEntries(Object.entries(exportCapabilities).map(([format, support]) => [format, renderError ? { supported: false, reason: renderError } : support])), json: { supported: true } }}
          animationDuration={history.params.useCells && history.params.keyframeTracks.length > 0 ? history.params.keyframeDuration : history.params.animationDuration}
          backgroundColor={history.params.backgroundColor}
          busy={Boolean(busy)}
          progress={exportProgress}
          error={exportError}
          onOpen={() => { pausePlayback(); setExportError(undefined); }}
          onExport={(request) => { void exportFile(request); }}
          onCancel={() => exportControllerRef.current?.abort()}
        />
      </footer>

      <input hidden ref={sourceInputRef} type="file" name="source-image" aria-label="Choose source image" accept=".png,.jpg,.jpeg,.webp,.avif,.svg,image/png,image/jpeg,image/webp,image/avif,image/svg+xml" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void loadImage(file).catch(reportImportError);
      }} />
      <input hidden ref={projectInputRef} type="file" name="project-file" aria-label="Open Taxis project" accept=".json,application/json" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void importProject(file).catch(reportImportError);
      }} />

      {statusMessage && (
        <div {...stylex.props(appStyles.toast)} role="status" aria-live="polite">
          <span {...stylex.props(appStyles.toastMessage)} key={notice?.id}>{statusMessage}</span>
          <button {...stylex.props(appStyles.toastButton)} ref={toastButtonRef} type="button" onClick={(event) => {
            if (event.detail === 0 && document.activeElement === toastButtonRef.current) {
              const origin = noticeOriginRef.current;
              (origin?.isConnected ? origin : resetButtonRef.current)?.focus();
            }
            setNotice(undefined);
          }} aria-label="Dismiss notification">×</button>
        </div>
      )}
    </main>
  );
}
