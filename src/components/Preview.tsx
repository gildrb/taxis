import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PatternParams, PatternPrimitive, SourceData } from "../model/types";
import { previewStyles } from "../styles/Preview.stylex";
import { drawCanvas } from "../render/canvas";
import type { SvgRenderer } from "../render/native";
import { Icon } from "./Icon";

interface PreviewProps {
  renderer: SvgRenderer;
  params: PatternParams;
  source: SourceData;
  zoom: number;
  playing: boolean;
  onFrameTime: (time: number) => void;
  selection?: PatternPrimitive;
  onPickCell?: (x: number, y: number) => void;
  onStepCell?: (column: number, row: number) => void;
  onClearCell?: () => void;
  onFile: (file: File) => void;
  onChooseSource: () => void;
  onError: (message?: string) => void;
}

export function Preview({ renderer, params, source, zoom, playing, onFrameTime, selection, onPickCell, onStepCell, onClearCell, onFile, onChooseSource, onError }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [frameSize, setFrameSize] = useState<{ height: number; width: number }>();
  const [dragging, setDragging] = useState(false);
  const [rendered, setRendered] = useState(() => ({ height: params.height, preset: params.preset, width: params.width, useCells: params.useCells, cellShape: params.cellShape }));

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const bounds = stage.getBoundingClientRect();
      const styles = getComputedStyle(stage);
      const availableWidth = bounds.width - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight);
      const availableHeight = bounds.height - Number.parseFloat(styles.paddingTop) - Number.parseFloat(styles.paddingBottom);
      const aspect = rendered.width / rendered.height;
      const compact = matchMedia("(max-width: 900px) and (max-height: 520px)").matches;
      const width = Math.max(1, Math.min(availableWidth, compact ? 160 : 820, availableHeight * aspect));
      const height = width / aspect;
      setFrameSize((current) => current?.width === width && current.height === height ? current : { height, width });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [rendered.height, rendered.width]);

  const hasFrame = frameSize !== undefined;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let request = 0;
    let elapsed = 0;
    let previousTime: number | undefined;
    let renderedTime: number | undefined;
    const render = (time: number) => {
      try {
        drawCanvas(canvas, { params: { ...params, animationTime: time }, source }, renderer);
        canvas.dataset.time = String(time);
        canvas.dataset.phase = String((params.animationPhase + time / params.animationDuration) % 1);
        onFrameTime(time);
        renderedTime = time;
        return true;
      } catch (error) {
        onError(error instanceof Error ? error.message : "The pattern could not be rendered.");
        return false;
      }
    };
    if (!render(params.animationTime)) return;
    setRendered((current) => current.width === params.width && current.height === params.height && current.preset === params.preset && current.useCells === params.useCells && current.cellShape === params.cellShape
      ? current
      : { height: params.height, preset: params.preset, width: params.width, useCells: params.useCells, cellShape: params.cellShape });
    onError(undefined);
    if (!playing) return;

    const tick = (timestamp: number) => {
      if (previousTime !== undefined && !document.hidden) elapsed += timestamp - previousTime;
      previousTime = document.hidden ? undefined : timestamp;
      const time = Number(Math.min(86_400, params.animationTime + elapsed / 1000).toFixed(6));
      if (time !== renderedTime && !render(time)) return;
      if (time === 86_400) { onError("The timeline reached 24 hours. Restart the animation to continue."); return; }
      request = requestAnimationFrame(tick);
    };
    const visibilityChanged = () => { previousTime = undefined; };
    document.addEventListener("visibilitychange", visibilityChanged);
    request = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(request);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [hasFrame, onError, onFrameTime, params, playing, renderer, source]);

  const accept = (file?: File) => {
    if (file) onFile(file);
    setDragging(false);
  };

  return (
    <section
      {...stylex.props(previewStyles.stage)}
      ref={stageRef}
      aria-label={zoom > 1 ? "Pattern canvas viewport; use arrow keys to pan" : "Pattern canvas"}
      tabIndex={zoom > 1 ? 0 : -1}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        accept(event.dataTransfer.files[0]);
      }}
    >
      <div {...stylex.props(previewStyles.stageBackdrop)} aria-hidden="true" />
      {frameSize && (
        <div
          {...stylex.props(previewStyles.zoomSizer)}
          style={{ height: frameSize.height * zoom, width: frameSize.width * zoom }}
        >
          <div
            {...stylex.props(previewStyles.canvasFrame)}
            data-testid="canvas-frame"
            style={{
              position: "relative",
              aspectRatio: `${rendered.width} / ${rendered.height}`,
              height: frameSize.height,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              width: frameSize.width,
            }}
          >
            <canvas
              {...stylex.props(previewStyles.canvas)} ref={canvasRef}
              aria-label={`Pattern preview, ${rendered.width} by ${rendered.height} pixels`}
              aria-description={onPickCell ? "Arrow keys select cells. Escape clears selection." : undefined}
              tabIndex={onPickCell ? 0 : undefined}
              onClick={onPickCell ? (event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                onPickCell((event.clientX - bounds.left) / bounds.width * rendered.width, (event.clientY - bounds.top) / bounds.height * rendered.height);
              } : undefined}
              onKeyDown={(event) => {
                const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], Enter: [0, 0] }[event.key];
                if (step && onStepCell) { event.preventDefault(); onStepCell(step[0]!, step[1]!); }
                else if (event.key === "Escape" && onClearCell) { event.preventDefault(); onClearCell(); }
              }}
            />
            {!playing && selection && <div aria-hidden="true" style={{
              position: "absolute", pointerEvents: "none", boxSizing: "border-box",
              left: `${selection.x / rendered.width * 100}%`, top: `${selection.y / rendered.height * 100}%`,
              width: `${selection.width / rendered.width * 100}%`, height: `${selection.height / rendered.height * 100}%`,
              outline: "1px solid #e3e3e7", boxShadow: "0 0 0 2px #111113",
            }} />}
          </div>
        </div>
      )}
      <div {...stylex.props(previewStyles.canvasInfo)} aria-hidden="true">
        <span>{rendered.width} × {rendered.height}</span>
        <span>{rendered.useCells ? `${rendered.cellShape} cells` : { bars: "Horizontal raster", candles: "Vertical raster", shapes: "Shape mosaic", stripes: "Uniform stripes", radial: "Radial rays", rings: "Concentric rings" }[rendered.preset]}</span>
        {playing && <span>Playing</span>}
      </div>
      <button {...stylex.props(previewStyles.changeSource)} type="button" aria-label={`Replace source image (${source.name})`} onClick={onChooseSource}>
        <Icon name="image" size={14} /> {source.name}
      </button>
      {dragging && (
        <div {...stylex.props(previewStyles.dropLayer)}>
          <div {...stylex.props(previewStyles.dropContent)}>
            <Icon name="upload" size={22} />
            <strong {...stylex.props(previewStyles.dropTitle)}>Drop source image</strong>
          </div>
        </div>
      )}
    </section>
  );
}
