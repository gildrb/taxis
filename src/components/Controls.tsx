import { motion } from "motion/react";
import type { OrbParams } from "../model/types";
import { PALETTES, PRESETS } from "../model/params";
import { Icon } from "./Icon";

interface ControlsProps {
  params: OrbParams;
  locks: ReadonlySet<keyof OrbParams>;
  audioEnabled: boolean;
  onToggleAudio: () => void;
  onChange: <Key extends keyof OrbParams>(key: Key, value: OrbParams[Key]) => void;
  onToggleLock: (key: keyof OrbParams) => void;
  onPreset: (params: Partial<OrbParams>) => void;
}

interface RangeProps {
  label: string;
  paramKey: keyof OrbParams;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  locked: boolean;
  onChange: (value: number) => void;
  onToggleLock: () => void;
}

function RangeControl({ label, paramKey, value, min, max, step, display, locked, onChange, onToggleLock }: RangeProps) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <div className="control-row">
      <div className="control-label">
        <label htmlFor={`control-${paramKey}`}>{label}</label>
        <span>{display ?? value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}</span>
        <button className={locked ? "lock active" : "lock"} type="button" onClick={onToggleLock} aria-label={`${locked ? "Unlock" : "Lock"} ${label}`} aria-pressed={locked}>
          <Icon name="lock" size={12} />
        </button>
      </div>
      <input
        id={`control-${paramKey}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

export function Controls({ params, locks, audioEnabled, onToggleAudio, onChange, onToggleLock, onPreset }: ControlsProps) {
  const range = (key: keyof OrbParams, label: string, min: number, max: number, step: number, display?: string) => ({
    label,
    paramKey: key,
    value: params[key] as number,
    min,
    max,
    step,
    display,
    locked: locks.has(key),
    onChange: (value: number) => onChange(key, value as never),
    onToggleLock: () => onToggleLock(key),
  });

  return (
    <aside className="controls" aria-label="Orb controls">
      <section className="control-section preset-section">
        <div className="section-heading"><span>Presets</span><small>starting points</small></div>
        <div className="preset-grid">
          {PRESETS.map((preset) => (
            <motion.button key={preset.name} whileTap={{ scale: 0.97 }} type="button" onClick={() => onPreset(preset.params)}>
              <i style={{ background: `linear-gradient(135deg, ${preset.params.palette?.[0]}, ${preset.params.palette?.[1]})` }} />
              {preset.name}
            </motion.button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading"><span>Structure</span><small>geometry</small></div>
        <div className="mode-switch" role="group" aria-label="Orb structure mode">
          {(["slices", "dots", "hybrid"] as const).map((mode) => (
            <button key={mode} type="button" className={params.mode === mode ? "active" : ""} onClick={() => onChange("mode", mode)}>{mode}</button>
          ))}
        </div>
        <RangeControl {...range("slices", "Slices", 6, 64, 1)} />
        <RangeControl {...range("dots", "Dot columns", 8, 72, 1)} />
        <RangeControl {...range("thickness", "Thickness", 0.1, 1, 0.01)} />
        <RangeControl {...range("spacing", "Spacing", 0, 0.9, 0.01)} />
        <RangeControl {...range("taper", "Taper", 0, 1, 0.01)} />
        <RangeControl {...range("curvature", "Curvature", -0.6, 0.6, 0.01)} />
      </section>

      <section className="control-section">
        <div className="section-heading"><span>Source</span><small>sampling</small></div>
        <RangeControl {...range("threshold", "Threshold", 0, 1, 0.01)} />
        <RangeControl {...range("contrast", "Contrast", 0.2, 3, 0.05)} />
        <RangeControl {...range("crop", "Crop", 0.5, 1.6, 0.01)} />
        <div className="toggle-row">
          <span>Invert luminance</span>
          <button type="button" className={params.inversion ? "toggle active" : "toggle"} role="switch" aria-checked={params.inversion} onClick={() => onChange("inversion", !params.inversion)}><i /></button>
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading"><span>Color</span><small>two-stop</small></div>
        <div className="palette-grid" role="radiogroup" aria-label="Color palette">
          {PALETTES.map((palette) => (
            <button
              key={palette.name}
              type="button"
              role="radio"
              aria-checked={palette.colors.join() === params.palette.join()}
              aria-label={palette.name}
              className={palette.colors.join() === params.palette.join() ? "active" : ""}
              style={{ background: `linear-gradient(135deg, ${palette.colors[0]}, ${palette.colors[1]})` }}
              onClick={() => onChange("palette", [...palette.colors])}
            />
          ))}
          {params.palette.map((color, index) => (
            <label className="color-input" key={index} title={`Custom color ${index + 1}`}>
              <input type="color" value={color} onChange={(event) => {
                const colors: [string, string] = [...params.palette];
                colors[index] = event.currentTarget.value;
                onChange("palette", colors);
              }} />
            </label>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading"><span>Motion</span><small>seamless loop</small></div>
        <RangeControl {...range("breathing", "Breathing", 0, 0.25, 0.005)} />
        <RangeControl {...range("wave", "Wave", 0, 0.35, 0.005)} />
        <RangeControl {...range("phase", "Phase", 0, 1, 0.01)} />
        <RangeControl {...range("rotation", "Rotation", -180, 180, 1, `${params.rotation}°`)} />
        <RangeControl {...range("noise", "Noise", 0, 0.5, 0.01)} />
        <RangeControl {...range("pointer", "Pointer react", 0, 1, 0.01)} />
        <RangeControl {...range("audio", "Audio react", 0, 1, 0.01)} />
        <button className={audioEnabled ? "audio-button active" : "audio-button"} type="button" onClick={onToggleAudio}>
          <Icon name="mic" /> {audioEnabled ? "Listening locally" : "Enable audio input"}
        </button>
      </section>

      <section className="control-section output-section">
        <div className="section-heading"><span>Output</span><small>render</small></div>
        <label className="select-row"><span>Resolution</span><select value={params.resolution} onChange={(event) => onChange("resolution", Number(event.currentTarget.value))}>{[512, 1024, 2048, 4096].map((size) => <option key={size} value={size}>{size} × {size}</option>)}</select></label>
        <RangeControl {...range("seed", "Seed", 0, 9999, 1)} />
        <RangeControl {...range("duration", "Duration", 1, 12, 0.5, `${params.duration.toFixed(1)} s`)} />
        <label className="select-row"><span>Frame rate</span><select value={params.fps} onChange={(event) => onChange("fps", Number(event.currentTarget.value))}>{[24, 30, 60].map((fps) => <option key={fps} value={fps}>{fps} FPS</option>)}</select></label>
      </section>
    </aside>
  );
}
