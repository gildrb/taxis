import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PatternParams, SourceData } from "../model/types";
import { previewStyles } from "../styles/Preview.stylex";
import { drawCanvas } from "../render/canvas";
import { Icon } from "./Icon";

interface PreviewProps {
  params: PatternParams;
  source: SourceData;
  zoom: number;
  onFile: (file: File) => void;
  onChooseSource: () => void;
  onError: (message?: string) => void;
}

export function Preview({ params, source, zoom, onFile, onChooseSource, onError }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [frameSize, setFrameSize] = useState<{ height: number; width: number }>();
  const [dragging, setDragging] = useState(false);
  const [rendered, setRendered] = useState(() => ({ height: params.height, preset: params.preset, width: params.width }));

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      drawCanvas(canvas, { params, source });
      setRendered((current) => current.width === params.width && current.height === params.height && current.preset === params.preset
        ? current
        : { height: params.height, preset: params.preset, width: params.width });
      onError(undefined);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The pattern could not be rendered.");
    }
  }, [frameSize, onError, params, source]);

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
              aspectRatio: `${rendered.width} / ${rendered.height}`,
              height: frameSize.height,
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
              width: frameSize.width,
            }}
          >
            <canvas {...stylex.props(previewStyles.canvas)} ref={canvasRef} aria-label={`Pattern preview, ${rendered.width} by ${rendered.height} pixels`} />
          </div>
        </div>
      )}
      <div {...stylex.props(previewStyles.canvasInfo)} aria-hidden="true">
        <span>{rendered.width} × {rendered.height}</span>
        <span>{rendered.preset === "candles" ? "Vertical" : rendered.preset === "bars" ? "Horizontal" : "Shape"} raster</span>
      </div>
      <button {...stylex.props(previewStyles.changeSource)} type="button" aria-label={`Replace source image (${source.name})`} onClick={onChooseSource}>
        <Icon name="image" size={14} /> {source.name}
      </button>
      {dragging && (
        <div {...stylex.props(previewStyles.dropLayer)}>
          <div {...stylex.props(previewStyles.dropContent)}>
            <Icon name="upload" size={22} />
            <strong {...stylex.props(previewStyles.dropTitle)}>Drop source image</strong>
            <span {...stylex.props(previewStyles.dropDetail)}>Aspect ratio stays intact · large images resize to 1600 px</span>
          </div>
        </div>
      )}
    </section>
  );
}
