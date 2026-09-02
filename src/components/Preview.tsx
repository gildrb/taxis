import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { MaskData, OrbParams, RenderInput } from "../model/types";
import { drawCanvas } from "../render/canvas";
import { mountWebGpu } from "../render/webgpu";
import { Icon } from "./Icon";

interface PreviewProps {
  params: OrbParams;
  mask: MaskData;
  audioLevel: React.RefObject<number>;
  onFile: (file: File) => void;
  onRenderInput: (reader: () => RenderInput) => void;
}

export function Preview({ params, mask, audioLevel, onFile, onRenderInput }: PreviewProps) {
  const fallbackRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const input = useRef<RenderInput>({ params, mask, time: 0, pointer: [0, 0], audio: 0 });
  const [renderer, setRenderer] = useState<"checking" | "webgpu" | "canvas">("checking");
  const [dragging, setDragging] = useState(false);
  const start = useRef(performance.now());

  input.current = { ...input.current, params, mask, audio: audioLevel.current ?? 0 };
  const readInput = useRef((): RenderInput => ({
    ...input.current,
    audio: audioLevel.current ?? 0,
    time: ((performance.now() - start.current) / 1_000 / input.current.params.duration) % 1,
  }));

  useEffect(() => onRenderInput(readInput.current), [onRenderInput]);

  useEffect(() => {
    const canvas = gpuRef.current;
    if (!canvas) return;
    let active = true;
    let dispose: () => void = () => undefined;
    void mountWebGpu(canvas, readInput.current, () => {
      if (active) setRenderer("canvas");
    })
      .then((controller) => {
        if (!active) return controller.dispose();
        dispose = controller.dispose;
        setRenderer("webgpu");
      })
      .catch(() => {
        if (active) setRenderer("canvas");
      });
    return () => {
      active = false;
      dispose();
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const render = () => {
      const canvas = fallbackRef.current;
      if (canvas && renderer !== "webgpu") drawCanvas(canvas, readInput.current());
      frame = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [renderer]);

  const accept = (file?: File) => {
    if (file) onFile(file);
    setDragging(false);
  };

  return (
    <section
      className="stage"
      aria-label="Orb preview and image drop zone"
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); accept(event.dataTransfer.files[0]); }}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        input.current.pointer = [
          ((event.clientX - bounds.left) / bounds.width - 0.5) * 2,
          ((event.clientY - bounds.top) / bounds.height - 0.5) * 2,
        ];
      }}
      onPointerLeave={() => { input.current.pointer = [0, 0]; }}
    >
      <div className="stage-grid" aria-hidden="true" />
      <div className="canvas-shell">
        <canvas ref={fallbackRef} className={renderer === "webgpu" ? "preview-canvas hidden" : "preview-canvas"} />
        <canvas ref={gpuRef} className={renderer === "webgpu" ? "preview-canvas" : "preview-canvas hidden"} />
      </div>
      <div className="stage-topline">
        <span className="live-mark"><i /> live form</span>
        <span>{mask.name}</span>
      </div>
      <button className="source-chip" type="button" onClick={() => fileRef.current?.click()}>
        <Icon name="image" /> Change source
      </button>
      <div className="render-chip">
        <i className={renderer === "webgpu" ? "active" : ""} />
        {renderer === "checking" ? "Detecting renderer" : renderer === "webgpu" ? "WebGPU · vgpu" : "Canvas fallback"}
      </div>
      <input
        ref={fileRef}
        className="visually-hidden"
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.avif,.svg,image/*"
        onChange={(event) => accept(event.target.files?.[0])}
      />
      <AnimatePresence>
        {dragging && (
          <motion.div className="drop-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ scale: 0.94 }} animate={{ scale: 1 }} exit={{ scale: 0.94 }}>
              <Icon name="upload" size={25} />
              <strong>Release to map image</strong>
              <span>Alpha or luminance · processed locally</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
