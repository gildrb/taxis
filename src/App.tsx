import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls, type PanelSelection } from "./components/Controls";
import { Icon } from "./components/Icon";
import { Preview } from "./components/Preview";
import { canvasToBlob, downloadBlob, downloadText } from "./export/download";
import { usePatternHistory } from "./hooks/usePatternHistory";
import { patternToSvg, projectFor } from "./model/pattern";
import { parseProject } from "./model/project";
import { createRadialSource, dataUrlToSource, fileToSource, legacyFingerprintPixels, legacyUsesAlpha } from "./model/source";
import { DEFAULT_PARAMS, applyPreset, legacyProjectFingerprint, outputSizeForSource, parsePreset, projectFingerprint, type PatternRecipe } from "./model/params";
import type { PatternParams, SourceData } from "./model/types";
import { drawCanvas } from "./render/canvas";
import { appStyles } from "./styles/App.stylex";
import { sharedStyles } from "./styles/shared.stylex";

type ExportKind = "SVG" | "PNG" | "JSON";
interface UnresolvedSource {
  fingerprint: string;
  usesAlpha?: boolean;
  radialSize?: number;
}

function sourceCacheKey(source: Pick<SourceData, "fingerprint" | "usesAlpha">): string {
  return `${source.fingerprint}:${source.usesAlpha ? 1 : 0}`;
}

const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const SOURCE_CACHE_BYTES = 96 * 1024 * 1024;

function sourceMemorySize(source: SourceData): number {
  return source.pixels.byteLength + (source.dataUrl?.length ?? 0) * 2;
}

function parseZoom(value: string | null): number {
  const parsed = Number(value ?? 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.round(Math.min(2, Math.max(0.5, parsed)) * 10) / 10;
}

function parseRadialSize(query: URLSearchParams): number | undefined {
  if (query.get("sourceKind") !== "radial") return undefined;
  const size = Number(query.get("sourceSize"));
  return Number.isInteger(size) && size >= 1 && size <= 4096 ? size : undefined;
}

export default function App() {
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
      const encoded = new URLSearchParams(window.location.search).get("settings");
      return { params: encoded ? parsePreset(JSON.parse(encoded)) : DEFAULT_PARAMS, invalid: false };
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
  const history = usePatternHistory(initialSource, initialSettings.params);
  const source = history.source;
  const [unresolvedSource, setUnresolvedSource] = useState<UnresolvedSource | undefined>(() => requestedSourceFingerprint && (requestedSourceFingerprint !== source.fingerprint || requestedSourceUsesAlpha !== undefined && requestedSourceUsesAlpha !== source.usesAlpha)
    ? { fingerprint: requestedSourceFingerprint, usesAlpha: requestedSourceUsesAlpha, radialSize: requestedRadialSize }
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
  const [selected, setSelected] = useState<PanelSelection>(() => {
    const panel = new URLSearchParams(window.location.search).get("panel");
    return panel === "source" || panel === "canvas" ? panel : "pattern";
  });
  const [zoom, setZoom] = useState(() => parseZoom(new URLSearchParams(window.location.search).get("zoom")));
  const [notice, setNoticeState] = useState<{ id: number; message: string } | undefined>(() => initialSettings.invalid
    ? { id: 1, message: "This link does not contain valid Pattern Lab settings." }
    : undefined);
  const noticeIdRef = useRef(initialSettings.invalid ? 1 : 0);
  const setNotice = useCallback((message?: string) => {
    setNoticeState(message === undefined ? undefined : { id: ++noticeIdRef.current, message });
  }, []);
  const [renderError, setRenderError] = useState<string>();
  const [busy, setBusy] = useState<ExportKind>();
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
        ? "This link does not contain valid Pattern Lab settings, and its original source image is unavailable."
        : "The linked settings were restored. Reopen the original source image to restore its pixels.");
    }
  }, []);

  useEffect(() => {
    const sourceFingerprint = unresolvedSource?.fingerprint ?? source.fingerprint;
    const sourceUsesAlpha = unresolvedSource ? unresolvedSource.usesAlpha : source.usesAlpha;
    const radialSize = unresolvedSource ? unresolvedSource.radialSize : source.kind === "radial" ? source.width : undefined;
    const signature = JSON.stringify([history.params, sourceFingerprint, sourceUsesAlpha ?? null, radialSize ?? null, selected, zoom]);
    if (preserveInitialInvalidUrlRef.current) {
      preserveInitialInvalidUrlRef.current = false;
      lastUrlSignatureRef.current = signature;
      return;
    }
    if (signature === lastUrlSignatureRef.current) return;
    const url = new URL(window.location.href);
    url.searchParams.set("settings", JSON.stringify(history.params));
    url.searchParams.set("source", sourceFingerprint);
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
  }, [history.params, selected, source.fingerprint, source.kind, source.usesAlpha, unresolvedSource, zoom]);

  useEffect(() => {
    if (source.kind === "radial") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [source.fingerprint, source.kind]);

  const sourceRequestRef = useRef(0);
  const revisionRef = useRef({ dimensions: 0, offsetX: 0, offsetY: 0, scale: 0, scene: 0 });
  const markParamChanges = useCallback((keys: readonly (keyof PatternParams)[]) => {
    const revisions = revisionRef.current;
    revisions.scene++;
    if (keys.includes("width") || keys.includes("height")) revisions.dimensions++;
    if (keys.includes("scale")) revisions.scale++;
    if (keys.includes("offsetX")) revisions.offsetX++;
    if (keys.includes("offsetY")) revisions.offsetY++;
  }, []);
  const paramsRef = useRef(history.params);
  const sourceRef = useRef(source);
  paramsRef.current = history.params;
  sourceRef.current = source;
  useEffect(() => {
    const restore = () => {
      try {
        const query = new URLSearchParams(window.location.search);
        const encoded = query.get("settings");
        const nextParams = encoded ? parsePreset(JSON.parse(encoded)) : DEFAULT_PARAMS;
        const panel = query.get("panel");
        const nextPanel: PanelSelection = panel === "source" || panel === "canvas" ? panel : "pattern";
        const nextZoom = parseZoom(query.get("zoom"));
        const linkedFingerprint = query.get("source") ?? initialSource.fingerprint;
        const alphaValue = query.get("sourceAlpha");
        const linkedUsesAlpha = alphaValue === "1" ? true : alphaValue === "0" ? false : undefined;
        const linkedRadialSize = parseRadialSize(query);
        let cachedSource = linkedUsesAlpha === undefined
          ? [...sourceCacheRef.current.values()].find((candidate) => candidate.fingerprint === linkedFingerprint)
          : sourceCacheRef.current.get(`${linkedFingerprint}:${linkedUsesAlpha ? 1 : 0}`);
        if (!cachedSource && linkedRadialSize !== undefined) {
          const generated = createRadialSource(linkedRadialSize);
          if (generated.fingerprint === linkedFingerprint) {
            cachedSource = { ...generated, usesAlpha: linkedUsesAlpha ?? generated.usesAlpha };
          }
        }
        sourceRequestRef.current++;
        history.endTransaction();
        markParamChanges(Object.keys(nextParams) as (keyof PatternParams)[]);
        if (cachedSource) {
          setUnresolvedSource(undefined);
          history.commitScene({ params: nextParams, source: cachedSource });
        } else {
          setUnresolvedSource({ fingerprint: linkedFingerprint, usesAlpha: linkedUsesAlpha, radialSize: linkedRadialSize });
          history.commit(nextParams);
          setNotice("The linked settings were restored. Reopen the original source image to restore its pixels.");
        }
        setSelected(nextPanel);
        setZoom(nextZoom);
        lastUrlSignatureRef.current = JSON.stringify([nextParams, linkedFingerprint, linkedUsesAlpha ?? cachedSource?.usesAlpha ?? null, linkedRadialSize ?? (cachedSource?.kind === "radial" ? cachedSource.width : null), nextPanel, nextZoom]);
        if (urlGroupTimerRef.current !== undefined) window.clearTimeout(urlGroupTimerRef.current);
        urlGroupTimerRef.current = undefined;
      } catch {
        setNotice("This history entry does not contain valid Pattern Lab settings.");
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [history.commit, history.commitScene, history.endTransaction, initialSource.fingerprint, markParamChanges, setNotice]);

  const fingerprint = useMemo(() => projectFingerprint(history.params, source), [history.params, source]);

  const change = useCallback(<Key extends keyof PatternParams>(key: Key, value: PatternParams[Key]) => {
    const resizesCanvas = key === "width" || key === "height";
    markParamChanges(resizesCanvas ? [key, "fit"] : [key]);
    history.commit((params) => {
      const next = { ...params, [key]: value };
      if (
        resizesCanvas
        && params.fit === "contain"
        && next.width * source.height !== next.height * source.width
      ) {
        next.fit = "cover";
      }
      return next;
    });
  }, [history.commit, markParamChanges, source.height, source.width]);

  const reportRenderError = useCallback((message?: string) => {
    setRenderError(message);
    if (message) setNotice(undefined);
  }, []);

  const loadImage = async (file: File) => {
    const request = ++sourceRequestRef.current;
    const sourceAtRequest = sourceRef.current;
    const unresolvedAtRequest = unresolvedSource;
    const revisionsAtRequest = { ...revisionRef.current };
    try {
      const next = await fileToSource(file);
      if (request !== sourceRequestRef.current) return;
      if (sourceRef.current !== sourceAtRequest) {
        setNotice("Source import canceled because the scene changed.");
        return;
      }
      const latest = paramsRef.current;
      if (unresolvedAtRequest) {
        if (next.fingerprint !== unresolvedAtRequest.fingerprint) {
          setNotice("That image does not match the linked source. Reopen the original image, or Reset to start a new scene.");
          return;
        }
        const restoredSource = { ...next, usesAlpha: unresolvedAtRequest.usesAlpha ?? next.usesAlpha };
        setUnresolvedSource(undefined);
        history.commitScene({ source: restoredSource, params: latest }, true);
      } else {
        const mappedSize = outputSizeForSource(next);
        const revisions = revisionRef.current;
        const dimensionsChanged = revisions.dimensions !== revisionsAtRequest.dimensions;
        history.commitScene({
          source: next,
          params: {
            ...latest,
            width: dimensionsChanged ? latest.width : mappedSize.width,
            height: dimensionsChanged ? latest.height : mappedSize.height,
            scale: revisions.scale === revisionsAtRequest.scale ? 1 : latest.scale,
            offsetX: revisions.offsetX === revisionsAtRequest.offsetX ? 0 : latest.offsetX,
            offsetY: revisions.offsetY === revisionsAtRequest.offsetY ? 0 : latest.offsetY,
          },
        }, true);
      }
      setNotice(unresolvedAtRequest
        ? `${file.name} restored for the linked settings`
        : `${file.name} mapped at its original aspect ratio`);
    } catch (error) {
      if (request !== sourceRequestRef.current) return;
      setNotice(error instanceof Error ? error.message : "Image import failed.");
    }
  };

  const exportFile = async (kind: ExportKind) => {
    const busyStartedAt = performance.now();
    setBusy(kind);
    if (kind === "PNG") await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const input = { params: history.params, source };
      const baseName = `pattern-${fingerprint}`;
      if (kind === "SVG") {
        downloadText(patternToSvg(input), `${baseName}.svg`, "image/svg+xml");
      } else if (kind === "JSON") {
        downloadText(JSON.stringify(projectFor(input), null, 2), `${baseName}.json`, "application/json");
      } else {
        const canvas = document.createElement("canvas");
        drawCanvas(canvas, input);
        downloadBlob(await canvasToBlob(canvas), `${baseName}.png`);
      }
      setNotice(`${kind} exported · ${fingerprint}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${kind} export failed.`);
    } finally {
      if (kind === "PNG") {
        const remaining = 200 - (performance.now() - busyStartedAt);
        if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      setBusy(undefined);
    }
  };

  const importProject = async (file?: File) => {
    if (!file) return;
    const request = ++sourceRequestRef.current;
    const sceneRevisionAtRequest = revisionRef.current.scene;
    const paramsAtRequest = paramsRef.current;
    const sourceAtRequest = sourceRef.current;
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error("Project files must be smaller than 64 MB.");
      const project = parseProject(JSON.parse(await file.text()));
      if (request !== sourceRequestRef.current) return;

      if (!project.source) {
        if (revisionRef.current.scene !== sceneRevisionAtRequest || paramsRef.current !== paramsAtRequest || sourceRef.current !== sourceAtRequest) {
          setNotice("Settings import canceled because the scene changed.");
          return;
        }
        history.commit(project.params);
        setNotice("Settings imported without replacing the source image");
        return;
      }

      const decodedSource = project.source.dataUrl
        ? await dataUrlToSource(project.source.dataUrl, project.source.name)
        : createRadialSource(project.source.size ?? 512);
      if (request !== sourceRequestRef.current) return;
      if (revisionRef.current.scene !== sceneRevisionAtRequest || paramsRef.current !== paramsAtRequest || sourceRef.current !== sourceAtRequest) {
        setNotice("Project import canceled because the scene changed.");
        return;
      }
      const nextSource = {
        ...decodedSource,
        usesAlpha: project.version === 1
          ? legacyUsesAlpha(decodedSource.pixels)
          : project.source.usesAlpha ?? decodedSource.usesAlpha,
      };
      const sourceFingerprint = project.version === 1
        ? legacyFingerprintPixels(nextSource.width, nextSource.height, nextSource.pixels)
        : nextSource.fingerprint;
      if (project.source.fingerprint !== sourceFingerprint) {
        throw new Error("The embedded source does not match this project fingerprint.");
      }
      const importedFingerprint = project.version === 1
        ? legacyProjectFingerprint(project.legacyParams ?? project.params, sourceFingerprint)
        : projectFingerprint(project.params, nextSource);
      if (project.fingerprint !== importedFingerprint) {
        throw new Error("The project settings or source have changed since export.");
      }
      setUnresolvedSource(undefined);
      history.commitScene({ params: project.params, source: nextSource });
      setNotice(`Project restored · ${projectFingerprint(project.params, nextSource)}`);
    } catch (error) {
      if (request !== sourceRequestRef.current) return;
      setNotice(error instanceof Error ? error.message : "Project import failed.");
    }
  };

  const applyRecipe = (recipe: PatternRecipe) => {
    markParamChanges(Object.keys(recipe.params) as (keyof PatternParams)[]);
    history.commit((params) => applyPreset(params, recipe.params));
  };

  const undo = () => {
    sourceRequestRef.current++;
    markParamChanges(["width", "height", "scale", "offsetX", "offsetY"]);
    history.undo();
  };

  const redo = () => {
    sourceRequestRef.current++;
    markParamChanges(["width", "height", "scale", "offsetX", "offsetY"]);
    history.redo();
  };

  const layers: ReadonlyArray<{ id: PanelSelection; name: string; detail: string; icon: "grid" | "image" | "canvas" }> = [
    { id: "pattern", name: "Pattern", detail: history.params.preset === "candles" ? "Vertical raster" : history.params.preset === "bars" ? "Horizontal raster" : "Shape mosaic", icon: "grid" },
    { id: "source", name: "Source", detail: source.name, icon: "image" },
    { id: "canvas", name: "Canvas", detail: `${history.params.width} × ${history.params.height}`, icon: "canvas" },
  ];

  const statusMessage = notice?.message;

  return (
    <main {...stylex.props(appStyles.appShell)}>
      <a {...stylex.props(appStyles.skipLink)} href="#properties-panel">Skip to properties</a>
      <h1 {...stylex.props(sharedStyles.visuallyHidden)}>Pattern Lab</h1>

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
        <button {...stylex.props(appStyles.toolbarButton)} ref={resetButtonRef} type="button" aria-label="Reset project" onClick={() => { sourceRequestRef.current++; markParamChanges(["width", "height", "scale", "offsetX", "offsetY"]); history.reset(createRadialSource()); setUnresolvedSource(undefined); setZoom(1); setRenderError(undefined); setNotice("Scene reset."); }}><Icon name="reset" /></button>
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
        <footer {...stylex.props(appStyles.layersFooter)}><span>Pattern Lab</span><small {...stylex.props(appStyles.layersFooterDetail)}>local · deterministic</small></footer>
      </aside>

      <Preview
        params={history.params}
        source={source}
        zoom={zoom}
        onFile={(file) => void loadImage(file)}
        onChooseSource={() => sourceInputRef.current?.click()}
        onError={reportRenderError}
      />

      <Controls
        selected={selected}
        params={history.params}
        source={source}
        onChange={change}
        onChangeEnd={history.endTransaction}
        onChangeStart={history.beginTransaction}
        renderError={renderError}
        onSelect={setSelected}
        onPreset={applyRecipe}
        onChooseSource={() => sourceInputRef.current?.click()}
      />

      <footer {...stylex.props(sharedStyles.glassPanel, appStyles.exportToolbar)}>
        <span {...stylex.props(appStyles.fingerprint)} data-testid="fingerprint" translate="no" title="Same source and settings always produce this ID"><i {...stylex.props(appStyles.fingerprintDot)} /><span {...stylex.props(sharedStyles.visuallyHidden)}>Scene fingerprint: </span>{fingerprint}<span {...stylex.props(sharedStyles.visuallyHidden)}>. Same source and settings always produce this ID.</span></span>
        <span {...stylex.props(appStyles.toolbarSeparator, appStyles.mobileToolbarSeparator)} aria-hidden="true" />
        <button {...stylex.props(appStyles.exportButton)} type="button" onClick={() => projectInputRef.current?.click()}><Icon name="folder" size={14} /> Open Project</button>
        <button {...stylex.props(appStyles.exportButton)} type="button" aria-disabled={Boolean(busy)} onClick={() => { if (!busy) void exportFile("JSON"); }}><Icon name="copy" size={14} /> Export Project</button>
        <button {...stylex.props(appStyles.exportButton)} type="button" aria-disabled={Boolean(busy || renderError)} onClick={() => { if (!busy && !renderError) void exportFile("SVG"); }}>SVG</button>
        <button {...stylex.props(appStyles.exportButton, appStyles.primaryExportButton)} type="button" aria-disabled={Boolean(busy || renderError)} onClick={() => { if (!busy && !renderError) void exportFile("PNG"); }}>
          {busy === "PNG" ? "Export PNG · Rendering…" : "Export PNG"} <Icon name="download" size={14} />
        </button>
      </footer>

      <input hidden ref={sourceInputRef} type="file" name="source-image" aria-label="Choose source image" accept=".png,.jpg,.jpeg,.webp,.avif,.svg,image/png,image/jpeg,image/webp,image/avif,image/svg+xml" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void loadImage(file);
      }} />
      <input hidden ref={projectInputRef} type="file" name="project-file" aria-label="Open Pattern Lab project" accept=".json,application/json" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        void importProject(file);
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
