import { PRESETS, type PatternRecipe } from "../model/params";
import type { PatternParams, SourceData } from "../model/types";
import { Icon } from "./Icon";

export type PanelSelection = "pattern" | "source" | "canvas";

interface ControlsProps {
  selected: PanelSelection;
  params: PatternParams;
  source: SourceData;
  onChange: <Key extends keyof PatternParams>(key: Key, value: PatternParams[Key]) => void;
  onSelect: (selected: PanelSelection) => void;
  onPreset: (recipe: PatternRecipe) => void;
  onChooseSource: () => void;
}

interface RangeProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

function RangeControl({ id, label, value, min, max, step, unit, onChange }: RangeProps) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return (
    <div className="property-row">
      <div className="property-label">
        <label htmlFor={id}>{label}</label>
        <span className="number-field">
          <input
            aria-label={`${label} value`}
            autoComplete="off"
            inputMode="decimal"
            name={`${id}-value`}
            min={min}
            max={max}
            step={step}
            type="number"
            value={Number(value.toFixed(decimals))}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
            }}
          />
          {unit && <span>{unit}</span>}
        </span>
      </div>
      <input
        id={id}
        aria-label={label}
        min={min}
        max={max}
        name={id}
        step={step}
        type="range"
        value={value}
        style={{ "--range-progress": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="toggle-row">
      <label htmlFor={id}>{label}</label>
      <button id={id} className={checked ? "switch active" : "switch"} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  );
}

function PanelHeader({ selected }: { selected: PanelSelection }) {
  const names: Record<PanelSelection, string> = {
    pattern: "Pattern",
    source: "Source",
    canvas: "Canvas",
  };
  return (
    <header className="panel-header">
      <span>Properties</span>
      <small>{names[selected]}</small>
    </header>
  );
}

export function Controls({ selected, params, source, onChange, onSelect, onPreset, onChooseSource }: ControlsProps) {
  return (
    <aside className="properties-panel glass-panel" aria-label="Properties">
      <PanelHeader selected={selected} />
      <nav className="mobile-panel-tabs" aria-label="Property panels">
        {(["pattern", "source", "canvas"] as const).map((panel) => (
          <button key={panel} type="button" className={selected === panel ? "active" : ""} aria-pressed={selected === panel} onClick={() => onSelect(panel)}>
            {panel === "pattern" ? "Pattern" : panel === "source" ? "Source" : "Canvas"}
          </button>
        ))}
      </nav>
      <div className="properties-scroll">
        {selected === "pattern" && (
          <>
            <section className="panel-section preset-section">
              <p className="overline">Recipes</p>
              <div className="recipe-grid">
                {PRESETS.map((preset) => (
                  <button key={preset.name} type="button" onClick={() => onPreset(preset)}>
                    <span className={`recipe-preview ${preset.params.preset ?? "bars"}`} style={{ backgroundColor: preset.params.backgroundColor }} aria-hidden="true" />
                    <strong>{preset.name}</strong>
                    <small>{preset.description}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel-section">
              <p className="overline">Pattern</p>
              <div className="segmented" role="group" aria-label="Pattern preset">
                {(["bars", "candles", "shapes"] as const).map((preset) => (
                  <button key={preset} type="button" className={params.preset === preset ? "active" : ""} aria-pressed={params.preset === preset} onClick={() => onChange("preset", preset)}>
                    {preset === "bars" ? "Horizontal" : preset === "candles" ? "Vertical" : "Shapes"}
                  </button>
                ))}
              </div>
              <RangeControl id="cell-size" label="Cell Size" value={params.cellSize} min={4} max={160} step={1} unit="px" onChange={(value) => onChange("cellSize", value)} />
              {params.preset === "bars" && <RangeControl id="row-shift" label="Row Shift" value={params.rowShift} min={0} max={240} step={1} unit="px" onChange={(value) => onChange("rowShift", value)} />}
            </section>

            <section className="panel-section">
              <p className="overline">Sampling</p>
              <RangeControl id="contrast" label="Contrast" value={params.contrast} min={0.1} max={4} step={0.01} onChange={(value) => onChange("contrast", value)} />
              <RangeControl id="luminance-bias" label="Luminance Bias" value={params.luminanceBias} min={-1} max={1} step={0.01} onChange={(value) => onChange("luminanceBias", value)} />
              <Toggle id="invert" label="Invert" checked={params.invert} onChange={(value) => onChange("invert", value)} />
            </section>

            <section className="panel-section">
              <p className="overline">Color</p>
              <label className="select-control" htmlFor="color-mode"><span>Mode</span><select id="color-mode" name="color-mode" value={params.colorMode} onChange={(event) => onChange("colorMode", event.currentTarget.value as PatternParams["colorMode"])}><option value="custom">Custom</option><option value="monochrome">Monochrome</option><option value="source">Source</option></select></label>
              {params.colorMode === "custom" && (
                <>
                  <div className="segmented compact" role="group" aria-label="Color count">
                    {([2, 3, 4] as const).map((count) => <button key={count} type="button" className={params.colorCount === count ? "active" : ""} aria-pressed={params.colorCount === count} onClick={() => onChange("colorCount", count)}>{count} colors</button>)}
                  </div>
                  <div className="color-list">
                    <label><span>Background</span><input name="background-color" type="color" value={params.backgroundColor} onChange={(event) => onChange("backgroundColor", event.currentTarget.value)} /></label>
                    {params.colors.slice(0, params.colorCount).map((color, index) => (
                      <label key={index}><span>{index === 0 ? "Shadows" : index === params.colorCount - 1 ? "Highlights" : `Midtone ${index}`}</span><input name={`palette-${index}`} type="color" value={color} onChange={(event) => {
                        const colors: PatternParams["colors"] = [...params.colors];
                        colors[index] = event.currentTarget.value;
                        onChange("colors", colors);
                      }} /></label>
                    ))}
                  </div>
                </>
              )}
              {params.colorMode === "monochrome" && <div className="color-list"><label><span>Tint</span><input name="mono-color" type="color" value={params.monoColor} onChange={(event) => onChange("monoColor", event.currentTarget.value)} /></label></div>}
              {params.colorMode === "source" && <RangeControl id="source-background" label="Background" value={params.sourceBackground} min={0} max={1} step={0.01} onChange={(value) => onChange("sourceBackground", value)} />}
            </section>
          </>
        )}

        {selected === "source" && (
          <>
            <section className="panel-section source-summary">
              <div className="source-icon"><Icon name="image" size={18} /></div>
              <div><strong>{source.name}</strong><span>{source.width} × {source.height} · {source.usesAlpha ? "alpha" : "luminance"}</span></div>
              <button type="button" onClick={onChooseSource}>Replace</button>
            </section>
            <section className="panel-section">
              <p className="overline">Placement</p>
              <div className="segmented" role="group" aria-label="Source fit">
                {(["contain", "cover", "stretch"] as const).map((fit) => <button key={fit} type="button" className={params.fit === fit ? "active" : ""} aria-pressed={params.fit === fit} onClick={() => onChange("fit", fit)}>{fit}</button>)}
              </div>
              <RangeControl id="source-scale" label="Scale" value={params.scale} min={0.1} max={4} step={0.01} onChange={(value) => onChange("scale", value)} />
              <RangeControl id="source-x" label="Offset X" value={params.offsetX} min={-1} max={1} step={0.01} onChange={(value) => onChange("offsetX", value)} />
              <RangeControl id="source-y" label="Offset Y" value={params.offsetY} min={-1} max={1} step={0.01} onChange={(value) => onChange("offsetY", value)} />
            </section>
            <section className="panel-section">
              <p className="overline">Channel</p>
              <label className="select-control" htmlFor="sample-channel"><span>Sample</span><select id="sample-channel" name="sample-channel" value={params.sampleChannel} onChange={(event) => onChange("sampleChannel", event.currentTarget.value as PatternParams["sampleChannel"])}><option value="auto">Auto</option><option value="luminance">Luminance</option><option value="alpha">Alpha</option></select></label>
              <p className="helper-copy">Auto uses alpha for transparent artwork and luminance for opaque images.</p>
            </section>
          </>
        )}

        {selected === "canvas" && (
          <>
            <section className="panel-section">
              <p className="overline">Output</p>
              <div className="dimension-grid">
                <label htmlFor="canvas-width"><span>Width</span><span className="dimension-input"><input id="canvas-width" name="canvas-width" autoComplete="off" inputMode="numeric" type="number" min="1" max="4096" value={params.width} onChange={(event) => onChange("width", Math.min(4096, Math.max(1, Number(event.currentTarget.value))))} /><small>px</small></span></label>
                <label htmlFor="canvas-height"><span>Height</span><span className="dimension-input"><input id="canvas-height" name="canvas-height" autoComplete="off" inputMode="numeric" type="number" min="1" max="4096" value={params.height} onChange={(event) => onChange("height", Math.min(4096, Math.max(1, Number(event.currentTarget.value))))} /><small>px</small></span></label>
              </div>
              <Toggle id="transparent-canvas" label="Transparent" checked={params.transparent} onChange={(value) => onChange("transparent", value)} />
            </section>
            <section className="panel-section">
              <p className="overline">Deterministic Output</p>
              <p className="helper-copy">Cell sampling happens in fixed output coordinates. Viewport size, refresh rate, and pointer position do not change the result.</p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
