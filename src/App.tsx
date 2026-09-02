import { useCallback, useMemo, useRef, useState } from "react";
import { Controls, type PanelSelection } from "./components/Controls";
import { Icon } from "./components/Icon";
import { Preview } from "./components/Preview";
import { canvasToBlob, downloadBlob, downloadText } from "./export/download";
import { usePatternHistory } from "./hooks/usePatternHistory";
import { patternToSvg, projectFor } from "./model/pattern";
import { createRadialSource, dataUrlToSource, fileToSource } from "./model/source";
import { applyPreset, outputSizeForSource, parsePreset, projectFingerprint, type PatternRecipe } from "./model/params";
import type { PatternParams, PatternProject } from "./model/types";
import { drawCanvas } from "./render/canvas";

type ExportKind = "SVG" | "PNG" | "JSON";

export default function App() {
  const initialSource = useMemo(() => createRadialSource(), []);
  const history = usePatternHistory(initialSource);
  const source = history.source;
  const [selected, setSelected] = useState<PanelSelection>("pattern");
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<ExportKind>();
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const fingerprint = useMemo(() => projectFingerprint(history.params, source), [history.params, source]);

  const change = useCallback(<Key extends keyof PatternParams>(key: Key, value: PatternParams[Key]) => {
    history.commit((params) => ({ ...params, [key]: value }));
  }, [history.commit]);

  const reportRenderError = useCallback((message: string) => setNotice(message), []);

  const loadImage = async (file: File) => {
    try {
      const next = await fileToSource(file);
      history.commitScene((scene) => ({
        source: next,
        params: {
          ...scene.params,
          ...outputSizeForSource(next),
          scale: 1,
          offsetX: 0,
          offsetY: 0,
        },
      }));
      setSelected("pattern");
      setNotice(`${file.name} mapped at its original aspect ratio`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Image import failed.");
    }
  };

  const exportFile = async (kind: ExportKind) => {
    setBusy(kind);
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
      setBusy(undefined);
    }
  };

  const importProject = async (file?: File) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as Partial<PatternProject> & { params?: unknown };
      const params = parsePreset(raw);
      let nextSource = source;
      if (raw.source?.dataUrl) {
        if (!raw.source.dataUrl.startsWith("data:image/")) throw new Error("Project source must be an embedded image.");
        nextSource = await dataUrlToSource(raw.source.dataUrl, raw.source.name ?? "Project source");
      } else if (raw.source?.kind === "radial") {
        nextSource = createRadialSource();
      } else if (raw.app === "Pattern Lab") {
        throw new Error("This project does not include its source image.");
      }
      if (raw.source?.fingerprint && raw.source.fingerprint !== nextSource.fingerprint) {
        throw new Error("The embedded source does not match this project fingerprint.");
      }
      history.commitScene({ params, source: nextSource });
      setNotice(`Project restored · ${projectFingerprint(params, nextSource)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project import failed.");
    }
  };

  const applyRecipe = (recipe: PatternRecipe) => {
    if (recipe.source === "radial") {
      history.commitScene((scene) => ({
        params: applyPreset(scene.params, recipe.params),
        source: createRadialSource(),
      }));
      return;
    }
    history.commit((params) => applyPreset(params, recipe.params));
  };

  const layers: ReadonlyArray<{ id: PanelSelection; name: string; detail: string; icon: "grid" | "image" | "canvas" }> = [
    { id: "pattern", name: "Pattern", detail: history.params.preset === "candles" ? "Vertical raster" : history.params.preset === "bars" ? "Horizontal raster" : "Shape mosaic", icon: "grid" },
    { id: "source", name: "Source", detail: source.name, icon: "image" },
    { id: "canvas", name: "Canvas", detail: `${history.params.width} × ${history.params.height}`, icon: "canvas" },
  ];

  return (
    <main className="app-shell">
      <h1 className="visually-hidden">Pattern Lab</h1>

      <nav className="top-toolbar glass-panel" aria-label="Canvas tools">
        <span className="toolbar-group">
          <button type="button" disabled={!history.canUndo} onClick={history.undo} aria-label="Undo"><Icon name="undo" /></button>
          <button type="button" disabled={!history.canRedo} onClick={history.redo} aria-label="Redo"><Icon name="redo" /></button>
        </span>
        <span className="toolbar-separator" aria-hidden="true" />
        <span className="toolbar-group zoom-tools">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}><Icon name="zoomOut" /></button>
          <output aria-label="Canvas zoom">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + 0.1))}><Icon name="zoomIn" /></button>
          <button type="button" aria-label="Fit canvas" onClick={() => setZoom(1)}><Icon name="fit" /></button>
        </span>
        <span className="toolbar-separator" aria-hidden="true" />
        <button type="button" aria-label="Reset project" onClick={() => { history.reset(createRadialSource()); setZoom(1); }}><Icon name="reset" /></button>
      </nav>

      <aside className="layers-panel glass-panel" aria-label="Layers">
        <header className="panel-header">
          <span>Layers</span>
          <button type="button" aria-label="Add source image" onClick={() => sourceInputRef.current?.click()}><Icon name="plus" size={14} /></button>
        </header>
        <div className="layer-list">
          {layers.map((layer) => (
            <button key={layer.id} type="button" className={selected === layer.id ? "layer active" : "layer"} aria-pressed={selected === layer.id} onClick={() => setSelected(layer.id)}>
              <span className="layer-grip" aria-hidden="true">⠿</span>
              <span className="layer-icon"><Icon name={layer.icon} size={14} /></span>
              <span className="layer-copy"><strong>{layer.name}</strong><small>{layer.detail}</small></span>
            </button>
          ))}
        </div>
        <footer><span>Pattern Lab</span><small>local · deterministic</small></footer>
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
        onSelect={setSelected}
        onPreset={applyRecipe}
        onChooseSource={() => sourceInputRef.current?.click()}
      />

      <footer className="export-toolbar glass-panel">
        <span className="fingerprint" title="Same source and settings always produce this ID"><i /> {fingerprint}</span>
        <span className="toolbar-separator" aria-hidden="true" />
        <button type="button" onClick={() => projectInputRef.current?.click()}><Icon name="folder" size={14} /> Open Project</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void exportFile("JSON")}><Icon name="copy" size={14} /> Export Project</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void exportFile("SVG")}>SVG</button>
        <button className="primary" type="button" disabled={Boolean(busy)} onClick={() => void exportFile("PNG")}>
          {busy === "PNG" ? "Rendering…" : "Export PNG"} <Icon name="download" size={14} />
        </button>
      </footer>

      <input ref={sourceInputRef} className="visually-hidden" type="file" name="source-image" aria-label="Choose source image" accept=".png,.jpg,.jpeg,.webp,.avif,.svg,image/png,image/jpeg,image/webp,image/avif,image/svg+xml" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void loadImage(file);
      }} />
      <input ref={projectInputRef} className="visually-hidden" type="file" name="project-file" aria-label="Open Pattern Lab project" accept=".json,application/json" onChange={(event) => void importProject(event.target.files?.[0])} />

      {notice && (
        <div className="toast" role="status" aria-live="polite">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(undefined)} aria-label="Dismiss notification">×</button>
        </div>
      )}
    </main>
  );
}
