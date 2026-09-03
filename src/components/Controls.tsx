import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef } from "react";
import { PRESETS, type PatternRecipe } from "../model/params";
import type { PatternParams, SourceData } from "../model/types";
import { controlStyles } from "../styles/Controls.stylex";
import { sharedStyles } from "../styles/shared.stylex";
import { Icon } from "./Icon";

export type PanelSelection = "pattern" | "source" | "canvas";
const PANEL_SELECTIONS: readonly PanelSelection[] = ["pattern", "source", "canvas"];

interface ControlsProps {
  selected: PanelSelection;
  params: PatternParams;
  source: SourceData;
  onChange: <Key extends keyof PatternParams>(key: Key, value: PatternParams[Key]) => void;
  onChangeEnd: () => void;
  onChangeStart: () => void;
  renderError?: string;
  onSelect: (selected: PanelSelection) => void;
  onPreset: (recipe: PatternRecipe) => void;
  onChooseSource: () => void;
}

interface RangeProps {
  id: string;
  label: string;
  error?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  stacked?: boolean;
  onChange: (value: number) => void;
  onChangeEnd: () => void;
  onChangeStart: () => void;
}

interface NumericInputProps {
  ariaLabel: string;
  describedBy?: string;
  dimension?: boolean;
  id?: string;
  invalid?: boolean;
  integer?: boolean;
  max: number;
  min: number;
  name: string;
  onChange: (value: number) => void;
  step: number;
  value: number;
}

function formatNumber(value: number, step: number): string {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return Number(value.toFixed(decimals)).toString();
}

function NumericInput({ ariaLabel, describedBy, dimension = false, id, integer = false, invalid = false, max, min, name, onChange, step, value }: NumericInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.value = formatNumber(value, step);
  }, [step, value]);

  const commit = (input: HTMLInputElement) => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed) || input.value.trim() === "") {
      input.value = formatNumber(value, step);
      return;
    }
    const clamped = Math.min(max, Math.max(min, integer ? Math.round(parsed) : parsed));
    const normalized = Number(formatNumber(clamped, step));
    input.value = formatNumber(normalized, step);
    if (normalized !== value) onChange(normalized);
  };

  return (
    <input
      {...stylex.props(dimension ? controlStyles.dimensionNumberInput : controlStyles.numberInput)}
      ref={inputRef}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-label={ariaLabel}
      autoComplete="off"
      defaultValue={formatNumber(value, step)}
      id={id}
      inputMode={integer ? "numeric" : "decimal"}
      max={max}
      min={min}
      name={name}
      step={step}
      type="number"
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = formatNumber(value, step);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function RangeControl({ id, label, error, value, min, max, step, unit, stacked = false, onChange, onChangeEnd, onChangeStart }: RangeProps) {
  return (
    <div {...stylex.props(stacked && controlStyles.stackedPropertyRow)}>
      <div {...stylex.props(controlStyles.propertyLabel)}>
        <label {...stylex.props(controlStyles.fieldLabel)} htmlFor={id}>{label}</label>
        <span {...stylex.props(controlStyles.numberField)}>
          <NumericInput
            ariaLabel={`${label} value`}
            describedBy={error ? "pattern-render-error" : undefined}
            invalid={Boolean(error)}
            integer={Number.isInteger(step)}
            max={max}
            min={min}
            name={`${id}-value`}
            onChange={onChange}
            step={step}
            value={value}
          />
          {unit && <span {...stylex.props(controlStyles.numberUnit)}>{unit}</span>}
        </span>
      </div>
      <input
        {...stylex.props(controlStyles.rangeInput)}
        data-range
        id={id}
        aria-describedby={error ? "pattern-render-error" : undefined}
        aria-invalid={error ? true : undefined}
        aria-label={label}
        min={min}
        max={max}
        name={id}
        step={step}
        type="range"
        value={value}
        style={{ "--range-progress": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onBlur={onChangeEnd}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp"].includes(event.key)) onChangeStart();
        }}
        onKeyUp={onChangeEnd}
        onPointerCancel={onChangeEnd}
        onPointerDown={(event) => {
          const active = document.activeElement;
          if (active instanceof HTMLElement && active !== event.currentTarget) active.blur();
          onChangeStart();
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          onChangeEnd();
        }}
      />
    </div>
  );
}

function Toggle({ id, label, checked, spacing, onChange }: { id: string; label: string; checked: boolean; spacing?: "property" | "dimensions"; onChange: (checked: boolean) => void }) {
  return (
    <label {...stylex.props(
      controlStyles.toggleRow,
      spacing === "property" && controlStyles.toggleAfterProperty,
      spacing === "dimensions" && controlStyles.toggleAfterDimensions,
    )}>
      <span {...stylex.props(controlStyles.fieldLabel)}>{label}</span>
      <button {...stylex.props(controlStyles.switch)} id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
        <span {...stylex.props(controlStyles.switchTrack, checked && controlStyles.activeSwitch)}>
          <span {...stylex.props(controlStyles.switchThumb, checked && controlStyles.activeSwitchThumb)} />
        </span>
      </button>
    </label>
  );
}

function PanelHeader({ selected }: { selected: PanelSelection }) {
  const names: Record<PanelSelection, string> = {
    pattern: "Pattern",
    source: "Source",
    canvas: "Canvas",
  };
  return (
    <header {...stylex.props(sharedStyles.panelHeader)}>
      <span>Properties</span>
      <small {...stylex.props(sharedStyles.panelHeaderSmall)}>{names[selected]}</small>
    </header>
  );
}

export function Controls({ selected, params, source, onChange, onChangeEnd, onChangeStart, renderError, onSelect, onPreset, onChooseSource }: ControlsProps) {
  const propertiesScrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<PanelSelection, number>>({ pattern: 0, source: 0, canvas: 0 });

  useLayoutEffect(() => {
    if (propertiesScrollRef.current) propertiesScrollRef.current.scrollTop = scrollPositionsRef.current[selected];
  }, [selected]);

  return (
    <aside {...stylex.props(sharedStyles.glassPanel, controlStyles.propertiesPanel)} id="properties-panel" tabIndex={-1} aria-label="Properties">
      <PanelHeader selected={selected} />
      <div {...stylex.props(controlStyles.mobilePanelTabs)} role="tablist" aria-label="Property panels">
        {PANEL_SELECTIONS.map((panel, index) => (
          <button
            {...stylex.props(controlStyles.mobilePanelTab, selected === panel && controlStyles.activeMobilePanelTab)}
            id={`property-tab-${panel}`}
            key={panel}
            type="button"
            role="tab"
            aria-controls="property-panel"
            aria-selected={selected === panel}
            tabIndex={selected === panel ? 0 : -1}
            onClick={() => onSelect(panel)}
            onKeyDown={(event) => {
              let nextIndex: number | undefined;
              if (event.key === "ArrowRight") nextIndex = (index + 1) % PANEL_SELECTIONS.length;
              if (event.key === "ArrowLeft") nextIndex = (index - 1 + PANEL_SELECTIONS.length) % PANEL_SELECTIONS.length;
              if (event.key === "Home") nextIndex = 0;
              if (event.key === "End") nextIndex = PANEL_SELECTIONS.length - 1;
              if (nextIndex === undefined) return;
              event.preventDefault();
              const next = PANEL_SELECTIONS[nextIndex]!;
              onSelect(next);
              requestAnimationFrame(() => document.getElementById(`property-tab-${next}`)?.focus());
            }}
          >
            {panel === "pattern" ? "Pattern" : panel === "source" ? "Source" : "Canvas"}
          </button>
        ))}
      </div>
      <div {...stylex.props(controlStyles.propertiesScroll)} id="property-panel" role="tabpanel" aria-label={`${selected === "pattern" ? "Pattern" : selected === "source" ? "Source" : "Canvas"} controls`} ref={propertiesScrollRef} data-testid="properties-scroll" onScroll={(event) => { scrollPositionsRef.current[selected] = event.currentTarget.scrollTop; }}>
        {renderError && <p {...stylex.props(controlStyles.renderError)} id="pattern-render-error" role="alert">{renderError}</p>}
        {selected === "pattern" && (
          <>
            <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Recipes</h2>
              <div {...stylex.props(controlStyles.recipeGrid)} data-recipe-grid>
                {PRESETS.map((preset) => (
                  <button {...stylex.props(controlStyles.recipeButton)} key={preset.name} type="button" onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })} onClick={() => onPreset(preset)}>
                    <span {...stylex.props(
                      controlStyles.recipePreview,
                      preset.params.preset === "candles"
                        ? controlStyles.candlesPreview
                        : preset.params.preset === "shapes"
                          ? controlStyles.shapesPreview
                          : controlStyles.barsPreview,
                    )} style={{ backgroundColor: preset.params.backgroundColor }} aria-hidden="true" />
                    <strong {...stylex.props(controlStyles.recipeName)}>{preset.name}</strong>
                    <small {...stylex.props(controlStyles.recipeDetail)}>{preset.description}</small>
                  </button>
                ))}
              </div>
            </section>

            <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Pattern</h2>
              <div {...stylex.props(controlStyles.segmented)} role="group" aria-label="Pattern preset">
                {(["bars", "candles", "shapes"] as const).map((preset) => (
                  <button {...stylex.props(controlStyles.segmentedButton, params.preset === preset && controlStyles.activeSegmentedButton)} key={preset} type="button" aria-pressed={params.preset === preset} onClick={() => onChange("preset", preset)}>
                    {preset === "bars" ? "Horizontal" : preset === "candles" ? "Vertical" : "Shapes"}
                  </button>
                ))}
              </div>
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="cell-size" label="Cell Size" error={renderError} value={params.cellSize} min={4} max={160} step={1} unit="px" onChange={(value) => onChange("cellSize", value)} />
              {params.preset === "bars" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="row-shift" label="Row Shift" value={params.rowShift} min={0} max={240} step={1} unit="px" onChange={(value) => onChange("rowShift", value)} />}
            </section>

            <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Sampling</h2>
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="contrast" label="Contrast" value={params.contrast} min={0.1} max={4} step={0.01} onChange={(value) => onChange("contrast", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="luminance-bias" label="Luminance Bias" value={params.luminanceBias} min={-1} max={1} step={0.01} onChange={(value) => onChange("luminanceBias", value)} />
              <Toggle id="invert" label="Invert" checked={params.invert} spacing="property" onChange={(value) => onChange("invert", value)} />
            </section>

            <section {...stylex.props(controlStyles.panelSection, controlStyles.lastPanelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Color</h2>
              <label {...stylex.props(controlStyles.selectControl)} htmlFor="color-mode"><span {...stylex.props(controlStyles.fieldLabel)}>Mode</span><select {...stylex.props(controlStyles.select)} id="color-mode" name="color-mode" value={params.colorMode} onChange={(event) => onChange("colorMode", event.currentTarget.value as PatternParams["colorMode"])}><option value="custom">Custom</option><option value="monochrome">Monochrome</option><option value="source">Source</option></select></label>
              {params.colorMode === "custom" && (
                <>
                  <div {...stylex.props(controlStyles.segmented, controlStyles.compactSegmented)} role="group" aria-label="Color count">
                    {([2, 3, 4] as const).map((count) => <button {...stylex.props(controlStyles.segmentedButton, params.colorCount === count && controlStyles.activeSegmentedButton)} key={count} type="button" aria-pressed={params.colorCount === count} onClick={() => onChange("colorCount", count)}>{count} colors</button>)}
                  </div>
                  <div {...stylex.props(controlStyles.colorList)}>
                    <label {...stylex.props(controlStyles.colorRow)}><span>Background</span><input {...stylex.props(controlStyles.colorInput)} name="background-color" type="color" value={params.backgroundColor} onBlur={onChangeEnd} onFocus={onChangeStart} onChange={(event) => onChange("backgroundColor", event.currentTarget.value)} /></label>
                    {params.colors.slice(0, params.colorCount).map((color, index) => (
                      <label {...stylex.props(controlStyles.colorRow)} key={index}><span>{index === 0 ? "Shadows" : index === params.colorCount - 1 ? "Highlights" : `Midtone ${index}`}</span><input {...stylex.props(controlStyles.colorInput)} name={`palette-${index}`} type="color" value={color} onBlur={onChangeEnd} onFocus={onChangeStart} onChange={(event) => {
                        const colors: PatternParams["colors"] = [...params.colors];
                        colors[index] = event.currentTarget.value;
                        onChange("colors", colors);
                      }} /></label>
                    ))}
                  </div>
                </>
              )}
              {params.colorMode === "monochrome" && <div {...stylex.props(controlStyles.colorList)}><label {...stylex.props(controlStyles.colorRow)}><span>Tint</span><input {...stylex.props(controlStyles.colorInput)} name="mono-color" type="color" value={params.monoColor} onBlur={onChangeEnd} onFocus={onChangeStart} onChange={(event) => onChange("monoColor", event.currentTarget.value)} /></label></div>}
              {params.colorMode === "source" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="source-background" label="Background" value={params.sourceBackground} min={0} max={1} step={0.01} onChange={(value) => onChange("sourceBackground", value)} />}
            </section>
          </>
        )}

        {selected === "source" && (
          <>
            <section {...stylex.props(controlStyles.panelSection, controlStyles.sourceSummary)} data-testid="source-summary">
              <div {...stylex.props(controlStyles.sourceIcon)}><Icon name="image" size={18} /></div>
              <div {...stylex.props(controlStyles.sourceCopy)}><strong {...stylex.props(controlStyles.sourceName)}>{source.name}</strong><span {...stylex.props(controlStyles.sourceDetail)}>{source.width} × {source.height} · {source.usesAlpha ? "alpha" : "luminance"}</span></div>
              <button {...stylex.props(controlStyles.sourceButton)} type="button" onClick={onChooseSource}>Replace</button>
            </section>
            <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Placement</h2>
              <div {...stylex.props(controlStyles.segmented)} role="group" aria-label="Source fit">
                {(["contain", "cover", "stretch"] as const).map((fit) => <button {...stylex.props(controlStyles.segmentedButton, params.fit === fit && controlStyles.activeSegmentedButton)} key={fit} type="button" aria-pressed={params.fit === fit} onClick={() => onChange("fit", fit)}>{fit}</button>)}
              </div>
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="source-scale" label="Scale" value={params.scale} min={0.1} max={4} step={0.01} onChange={(value) => onChange("scale", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="source-x" label="Offset X" value={params.offsetX} min={-1} max={1} step={0.01} onChange={(value) => onChange("offsetX", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="source-y" label="Offset Y" value={params.offsetY} min={-1} max={1} step={0.01} onChange={(value) => onChange("offsetY", value)} />
            </section>
            <section {...stylex.props(controlStyles.panelSection, controlStyles.lastPanelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Channel</h2>
              <label {...stylex.props(controlStyles.selectControl)} htmlFor="sample-channel"><span {...stylex.props(controlStyles.fieldLabel)}>Sample</span><select {...stylex.props(controlStyles.select)} id="sample-channel" name="sample-channel" value={params.sampleChannel} onChange={(event) => onChange("sampleChannel", event.currentTarget.value as PatternParams["sampleChannel"])}><option value="auto">Auto</option><option value="luminance">Luminance</option><option value="alpha">Alpha</option></select></label>
              <p {...stylex.props(controlStyles.helperCopy)}>Auto uses alpha for transparent artwork and luminance for opaque images.</p>
            </section>
          </>
        )}

        {selected === "canvas" && (
          <>
            <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Output</h2>
              <div {...stylex.props(controlStyles.dimensionGrid)}>
                <label {...stylex.props(controlStyles.dimensionLabel)} htmlFor="canvas-width">
                  <span {...stylex.props(controlStyles.fieldLabel)}>Width</span>
                  <span {...stylex.props(controlStyles.dimensionInput)}>
                    <NumericInput ariaLabel="Width" dimension id="canvas-width" integer max={4096} min={1} name="canvas-width" onChange={(value) => onChange("width", value)} step={1} value={params.width} />
                    <small {...stylex.props(controlStyles.dimensionUnit)}>px</small>
                  </span>
                </label>
                <label {...stylex.props(controlStyles.dimensionLabel)} htmlFor="canvas-height">
                  <span {...stylex.props(controlStyles.fieldLabel)}>Height</span>
                  <span {...stylex.props(controlStyles.dimensionInput)}>
                    <NumericInput ariaLabel="Height" dimension id="canvas-height" integer max={4096} min={1} name="canvas-height" onChange={(value) => onChange("height", value)} step={1} value={params.height} />
                    <small {...stylex.props(controlStyles.dimensionUnit)}>px</small>
                  </span>
                </label>
              </div>
              <Toggle id="transparent-canvas" label="Transparent" checked={params.transparent} spacing="dimensions" onChange={(value) => onChange("transparent", value)} />
            </section>
            <section {...stylex.props(controlStyles.panelSection, controlStyles.lastPanelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Deterministic Output</h2>
              <p {...stylex.props(controlStyles.helperCopy)}>Canvas dimensions define the full pattern bounds. Resizing switches Contain to Cover when needed; choose Contain afterward for intentional margins. Viewport size, refresh rate, and pointer position do not change the result.</p>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
