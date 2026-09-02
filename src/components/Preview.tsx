import { useEffect, useRef, useState } from "react";
import type { PatternParams, SourceData } from "../model/types";
import { drawCanvas } from "../render/canvas";
import { Icon } from "./Icon";

interface PreviewProps {
  params: PatternParams;
  source: SourceData;
  zoom: number;
  onFile: (file: File) => void;
  onChooseSource: () => void;
  onError: (message: string) => void;
}

export function Preview({ params, source, zoom, onFile, onChooseSource, onError }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      drawCanvas(canvas, { params, source });
    } catch (error) {
      onError(error instanceof Error ? error.message : "The pattern could not be rendered.");
    }
  }, [onError, params, source]);

  const accept = (file?: File) => {
    if (file) onFile(file);
    setDragging(false);
  };

  return (
    <section
      className="stage"
      aria-label="Pattern canvas"
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
      <div
        className="canvas-frame"
        style={{
          aspectRatio: `${params.width} / ${params.height}`,
          "--canvas-aspect": params.width / params.height,
          "--canvas-zoom": zoom,
        } as React.CSSProperties}
      >
        <canvas ref={canvasRef} aria-label={`Pattern preview, ${params.width} by ${params.height} pixels`} />
      </div>
      <div className="canvas-info" aria-hidden="true">
        <span>{params.width} × {params.height}</span>
        <span>{params.preset === "candles" ? "Vertical" : params.preset === "bars" ? "Horizontal" : "Shape"} raster</span>
      </div>
      <button className="change-source" type="button" onClick={onChooseSource}>
        <Icon name="image" size={14} /> {source.name}
      </button>
      {dragging && (
        <div className="drop-layer">
          <div>
            <Icon name="upload" size={22} />
            <strong>Drop source image</strong>
            <span>Aspect ratio and pixels stay intact</span>
          </div>
        </div>
      )}
    </section>
  );
}
