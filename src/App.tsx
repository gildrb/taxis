import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { Controls } from "./components/Controls";
import { Icon } from "./components/Icon";
import { Preview } from "./components/Preview";
import { downloadBlob, downloadText, canvasToBlob } from "./export/download";
import { encodeMp4, recordWebM } from "./export/video";
import { useAudioMeter } from "./hooks/useAudioMeter";
import { useOrbHistory } from "./hooks/useOrbHistory";
import { geometryToSvg } from "./model/geometry";
import { createRadialMask, fileToMask } from "./model/mask";
import { DEFAULT_PARAMS, parsePreset, randomizeParams } from "./model/params";
import type { MaskData, OrbParams, RenderInput } from "./model/types";
import { drawCanvas } from "./render/canvas";

type ExportKind = "SVG" | "PNG" | "JSON" | "WebM" | "MP4";

export default function App() {
  const history = useOrbHistory();
  const [mask, setMask] = useState<MaskData>(() => createRadialMask());
  const [locks, setLocks] = useState<Set<keyof OrbParams>>(() => new Set());
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<{ kind: ExportKind; progress: number }>();
  const importRef = useRef<HTMLInputElement>(null);
  const readRenderInput = useRef<() => RenderInput>(() => ({ params: DEFAULT_PARAMS, mask, time: 0, pointer: [0, 0], audio: 0 }));
  const audio = useAudioMeter();

  const change = useCallback(<Key extends keyof OrbParams>(key: Key, value: OrbParams[Key]) => {
    history.commit((params) => ({ ...params, [key]: value }));
  }, [history.commit]);

  const loadImage = async (file: File) => {
    try {
      setMask(await fileToMask(file));
      setNotice(`${file.name} mapped locally`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Image import failed.");
    }
  };

  const exportFile = async (kind: ExportKind) => {
    setBusy({ kind, progress: 0 });
    try {
      const input = { ...readRenderInput.current(), time: 0 };
      if (kind === "SVG") {
        downloadText(geometryToSvg(input), "orb-lab.svg", "image/svg+xml");
      } else if (kind === "JSON") {
        downloadText(JSON.stringify({ app: "Orb Lab", version: 1, params: history.params }, null, 2), "orb-lab-preset.json", "application/json");
      } else if (kind === "PNG") {
        const canvas = document.createElement("canvas");
        drawCanvas(canvas, input, { size: history.params.resolution, background: null });
        downloadBlob(await canvasToBlob(canvas), "orb-lab.png");
      } else if (kind === "WebM") {
        const blob = await recordWebM(readRenderInput.current, (progress) => setBusy({ kind, progress }));
        downloadBlob(blob, "orb-lab.webm");
      } else {
        const blob = await encodeMp4(readRenderInput.current, (progress) => setBusy({ kind, progress }));
        downloadBlob(blob, "orb-lab.mp4");
      }
      setNotice(`${kind} exported`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${kind} export failed.`);
    } finally {
      setBusy(undefined);
    }
  };

  const importPreset = async (file?: File) => {
    if (!file) return;
    try {
      history.commit(parsePreset(JSON.parse(await file.text())));
      setNotice("Preset loaded");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Preset import failed.");
    }
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Orb Lab home">
          <span className="brand-mark" aria-hidden="true">◒</span>
          <span><h1>Orb Lab</h1><small>image → living geometry</small></span>
        </a>
        <div className="header-meta"><span><i /> local processing</span><span>01 / FORM</span></div>
        <div className="history-actions">
          <button type="button" disabled={!history.canUndo} onClick={history.undo} aria-label="Undo"><Icon name="undo" /></button>
          <button type="button" disabled={!history.canRedo} onClick={history.redo} aria-label="Redo"><Icon name="redo" /></button>
          <button type="button" onClick={() => history.commit((params) => randomizeParams(params, locks))}><Icon name="shuffle" /> Randomize</button>
          <button type="button" onClick={history.reset}><Icon name="reset" /> Reset</button>
        </div>
      </header>

      <div className="workspace">
        <Preview
          params={history.params}
          mask={mask}
          audioLevel={audio.level}
          onFile={(file) => void loadImage(file)}
          onRenderInput={(reader) => { readRenderInput.current = reader; }}
        />
        <Controls
          params={history.params}
          locks={locks}
          audioEnabled={audio.enabled}
          onToggleAudio={() => void audio.toggle()}
          onChange={change}
          onToggleLock={(key) => setLocks((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
          })}
          onPreset={(partial) => history.commit((params) => ({ ...params, ...partial }))}
        />
      </div>

      <footer className="export-bar">
        <div><strong>Export form</strong><span>Transparent where supported · geometry stays editable</span></div>
        <div className="export-actions">
          {(["SVG", "PNG", "JSON", "WebM", "MP4"] as const).map((kind) => (
            <button key={kind} type="button" disabled={Boolean(busy)} onClick={() => void exportFile(kind)} className={kind === "SVG" ? "primary" : ""}>
              {busy?.kind === kind ? `${Math.round(busy.progress * 100)}%` : kind}
              {kind === "SVG" && <Icon name="download" />}
            </button>
          ))}
          <button type="button" onClick={() => importRef.current?.click()}>Import preset</button>
        </div>
        <input ref={importRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={(event) => void importPreset(event.target.files?.[0])} />
        {busy && <motion.div className="export-progress" initial={{ scaleX: 0 }} animate={{ scaleX: busy.progress }} />}
      </footer>

      <AnimatePresence>
        {(notice || audio.error) && (
          <motion.button
            type="button"
            className="toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            onClick={() => setNotice(undefined)}
          >
            {audio.error ?? notice}
          </motion.button>
        )}
      </AnimatePresence>
    </main>
  );
}
