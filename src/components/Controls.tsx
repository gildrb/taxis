import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PRESETS, type PatternRecipe } from "../model/params";
import type { CellAnimationOverride, LayoutCellOverride, PatternFrame, PatternParams, SourceData } from "../model/types";
import { controlStyles } from "../styles/Controls.stylex";
import { sharedStyles } from "../styles/shared.stylex";
import { Icon } from "./Icon";
import { Select } from "./Select";

export type PanelSelection = "pattern" | "source" | "canvas";
const PANEL_SELECTIONS: readonly PanelSelection[] = ["pattern", "source", "canvas"];
const PATTERN_PRESETS = [
  { value: "bars", label: "Horizontal" },
  { value: "candles", label: "Vertical" },
  { value: "shapes", label: "Shapes" },
  { value: "stripes", label: "Stripes" },
  { value: "radial", label: "Radial" },
  { value: "rings", label: "Rings" },
] as const;

const CELL_SHAPES = [
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "triangle", label: "Triangle" },
  { value: "line", label: "Line" },
  { value: "diamond", label: "Diamond" },
  { value: "hexagon", label: "Hexagon" },
  { value: "octagon", label: "Octagon" },
  { value: "polygon", label: "Polygon" },
] as const;

const MASK_SHAPES = [
  { value: "none", label: "None" },
  { value: "circle", label: "Circle" },
  { value: "triangle", label: "Triangle" },
  { value: "square", label: "Square" },
  { value: "octagon", label: "Octagon" },
  { value: "polygon", label: "Polygon" },
] as const;

interface ControlsProps {
  selected: PanelSelection;
  params: PatternParams;
  source: SourceData;
  entities: NonNullable<PatternFrame["entities"]>;
  selectedCellId?: string;
  onSelectCell: (id?: string) => void;
  onChange: <Key extends keyof PatternParams>(key: Key, value: PatternParams[Key]) => void;
  onChangeEnd: () => void;
  onChangeStart: () => void;
  renderError?: string;
  onSelect: (selected: PanelSelection) => void;
  onPreset: (recipe: PatternRecipe) => void;
  onChooseSource: () => void;
  playing?: boolean;
  onTogglePlayback?: () => void;
  onResetPlayback?: () => void;
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

interface ColorProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
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
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
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

function ColorControl({ label, name, value, onChange, onChangeEnd, onChangeStart }: ColorProps) {
  return (
    <label {...stylex.props(controlStyles.colorRow)}>
      <span>{label}</span>
      <input
        {...stylex.props(controlStyles.colorInput)}
        name={name}
        type="color"
        value={value}
        onBlur={onChangeEnd}
        onFocus={onChangeStart}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
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

export function Controls({ selected, params, source, entities, selectedCellId, onSelectCell, onChange, onChangeEnd, onChangeStart, renderError, onSelect, onPreset, onChooseSource, playing = false, onTogglePlayback, onResetPlayback }: ControlsProps) {
  const matchingPreset = PRESETS.find((recipe) => Object.entries(recipe.params).every(([key, value]) => JSON.stringify(params[key as keyof PatternParams]) === JSON.stringify(value)));
  const atlasPattern = params.preset === "bars" || params.preset === "candles" || params.preset === "shapes";
  const supportsMask = params.useCells || source.kind === "radial" || Boolean(source.vectorMask);
  const preciseSourceMask = params.sourceMode === "mask" && !params.useCells;
  const maskUnavailable = !supportsMask || !params.useCells && params.symmetry !== "none";
  const [selectedRepeat, setSelectedRepeat] = useState(0);
  const cellOverride = params.cellAnimations.find((cell) => cell.id === selectedCellId);
  const selectedEntity = entities.find((cell) => cell.id === selectedCellId);
  const cellAddress = (selectedCellId ?? "cell:0:0:0").split(":").slice(1).map(Number);
  const motion = { ...params, ...cellOverride };
  const visibleCellCount = entities.filter((cell) => cell.visible).length;
  const entityIds = new Set(entities.map((cell) => cell.id));
  const inactiveOverrideCount = params.cellAnimations.filter((cell) => !entityIds.has(cell.id)).length;
  const repeatCount = params.layoutColumns * params.layoutRows;
  const selectedRepeatIndex = Math.min(selectedRepeat, repeatCount - 1);
  const repeatOverride = params.layoutCells.find((cell) => cell.index === selectedRepeatIndex);
  const repeatClipShape = repeatOverride?.maskShape ?? params.maskShape;
  const hasRepeatClip = params.layoutCells.some((cell) => cell.index < repeatCount && cell.maskShape !== undefined && cell.maskShape !== "none");
  const hasPolygonClip = params.maskShape === "polygon" || params.layoutCells.some((cell) => cell.index < repeatCount && cell.maskShape === "polygon");
  const disclosuresRef = useRef({ asymmetry: false, radial: false, gradient: false, repeatSpacing: false, individualRepeat: false, clip: false, repeat: false, motionTimeline: false, motionCell: false, motionInheritance: false });
  const propertiesScrollRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Record<PanelSelection, number>>({ pattern: 0, source: 0, canvas: 0 });

  useLayoutEffect(() => {
    if (propertiesScrollRef.current) propertiesScrollRef.current.scrollTop = scrollPositionsRef.current[selected];
  }, [selected]);

  const changeRepeat = <Key extends Exclude<keyof LayoutCellOverride, "index">>(key: Key, value: LayoutCellOverride[Key]) => {
    const nextRepeat: LayoutCellOverride = { ...repeatOverride, index: selectedRepeatIndex, [key]: value };
    if (value === undefined) delete nextRepeat[key];
    const repeats = params.layoutCells.filter((cell) => cell.index !== selectedRepeatIndex);
    if (Object.keys(nextRepeat).length > 1) repeats.push(nextRepeat);
    onChange("layoutCells", repeats.sort((first, second) => first.index - second.index));
  };

  const changeMotion = <Key extends Exclude<keyof CellAnimationOverride, "id">>(key: Key, value: PatternParams[Key]) => {
    if (!selectedCellId) {
      onChange(key, value);
      return;
    }
    const next: CellAnimationOverride = { ...cellOverride, id: selectedCellId, [key]: value };
    onChange("cellAnimations", [...params.cellAnimations.filter((cell) => cell.id !== selectedCellId), next]);
  };

  const motionInheritance = (key: Exclude<keyof CellAnimationOverride, "id">, label: string) => {
    if (!selectedCellId) return null;
    const inherited = cellOverride?.[key] === undefined;
    return (
      <div {...stylex.props(controlStyles.sectionActions)}>
        <span {...stylex.props(controlStyles.helperCopy)}>{inherited ? `${label}: inherited (${params[key]})` : `${label}: overridden`}</span>
        <button {...stylex.props(controlStyles.sourceButton, controlStyles.actionButton)} type="button" aria-label={`${inherited ? "Override" : "Use default"} ${label.toLowerCase()}`} onClick={() => {
          if (inherited) {
            changeMotion(key, params[key]);
            return;
          }
          const next = { ...cellOverride, id: selectedCellId };
          delete next[key];
          const overrides = params.cellAnimations.filter((cell) => cell.id !== selectedCellId);
          if (Object.keys(next).length > 1) overrides.push(next);
          onChange("cellAnimations", overrides);
        }}>{inherited ? "Override" : "Use default"}</button>
      </div>
    );
  };

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
            <section {...stylex.props(controlStyles.panelSection, controlStyles.modeSection)}>
              <label {...stylex.props(controlStyles.toggleRow)} htmlFor="use-cells">
                <span {...stylex.props(controlStyles.fieldLabel)}>Use cells</span>
                <input {...stylex.props(controlStyles.checkboxInput)} id="use-cells" name="use-cells" type="checkbox" checked={params.useCells} onChange={(event) => onChange("useCells", event.currentTarget.checked)} />
              </label>
            </section>
            <section {...stylex.props(controlStyles.panelSection)}>
              <Select id="recipe" label="Recipe" value={matchingPreset?.name ?? "custom"} options={[{ value: "custom", label: "Custom", disabled: true }, ...PRESETS.map((preset) => ({ value: preset.name, label: preset.name }))]} onChange={(name) => {
                const preset = PRESETS.find((recipe) => recipe.name === name);
                if (preset) onPreset(preset);
              }} />
            </section>

            <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Pattern</h2>
              {params.useCells
                ? <Select id="cell-shape" label="Cell shape" value={params.cellShape} options={CELL_SHAPES} onChange={(value) => onChange("cellShape", value)} />
                : <div {...stylex.props(controlStyles.segmented)} role="group" aria-label="Pattern preset">
                  {PATTERN_PRESETS.map(({ value, label }) => (
                    <button {...stylex.props(controlStyles.segmentedButton, params.preset === value && controlStyles.activeSegmentedButton)} key={value} type="button" aria-pressed={params.preset === value} onClick={() => onChange("preset", value)}>
                      {label}
                    </button>
                  ))}
                </div>}
              {(params.useCells || params.preset !== "radial") && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="cell-size" label="Cell Size" error={renderError} value={params.cellSize} min={4} max={160} step={1} unit="px" onChange={(value) => onChange("cellSize", value)} />}
              {params.useCells ? <>
                <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="motif-scale" label="Motif scale" value={params.motifScale} min={0.1} max={1} step={0.01} onChange={(value) => onChange("motifScale", value)} />
                {params.cellShape === "line" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="line-width" label="Line width" value={params.lineWidth} min={0.02} max={1} step={0.01} onChange={(value) => onChange("lineWidth", value)} />}
                {params.cellShape === "polygon" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="cell-sides" label="Cell sides" value={params.cellSides} min={3} max={32} step={1} onChange={(value) => onChange("cellSides", value)} />}
                {params.cellShape !== "circle" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="cell-rotation" label="Cell rotation" value={params.cellRotation} min={-180} max={180} step={1} unit="°" onChange={(value) => onChange("cellRotation", value)} />}
                {params.sourceMode !== "ignore" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="cell-threshold" label="Cell threshold" value={params.cellThreshold} min={0} max={1} step={0.01} onChange={(value) => onChange("cellThreshold", value)} />}
              </> : <>
                {atlasPattern
                  ? <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="motif-scale" label="Motif scale" value={params.motifScale} min={0.1} max={2} step={0.01} onChange={(value) => onChange("motifScale", value)} />
                  : <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked={params.preset !== "radial"} id="line-width" label="Line width" value={params.lineWidth} min={0.02} max={1} step={0.01} onChange={(value) => onChange("lineWidth", value)} />}
                {params.preset === "radial" && (
                  <>
                    <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="radial-count" label="Repeat count" value={params.radialCount} min={3} max={128} step={1} onChange={(value) => onChange("radialCount", value)} />
                    <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="radial-bands" label="Bands" value={params.radialBands} min={1} max={16} step={1} onChange={(value) => onChange("radialBands", value)} />
                    <details {...stylex.props(controlStyles.nestedDisclosure)} open={disclosuresRef.current.radial} onToggle={(event) => { disclosuresRef.current.radial = event.currentTarget.open; }}>
                      <summary {...stylex.props(controlStyles.disclosureSummary)}>Radial shape</summary>
                      <div {...stylex.props(controlStyles.disclosureBody)}>
                        <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="inner-radius" label="Inner radius" value={params.innerRadius} min={0} max={0.9} step={0.01} onChange={(value) => onChange("innerRadius", value)} />
                        <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="radial-taper" label="Taper" value={params.radialTaper} min={0} max={1} step={0.01} onChange={(value) => onChange("radialTaper", value)} />
                      </div>
                    </details>
                  </>
                )}
                {params.preset === "rings" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="inner-radius" label="Inner radius" value={params.innerRadius} min={0} max={0.9} step={0.01} onChange={(value) => onChange("innerRadius", value)} />}
              </>}
              {(!params.useCells || params.sourceMode !== "ignore") && <Select id="symmetry" label="Symmetry" value={params.symmetry} describedBy={preciseSourceMask ? "symmetry-help" : undefined} options={[{ value: "none", label: "None" }, { value: "x", label: "X (left/right)", disabled: preciseSourceMask }, { value: "y", label: "Y (top/bottom)", disabled: preciseSourceMask }, { value: "both", label: "Both", disabled: preciseSourceMask }]} onChange={(value) => onChange("symmetry", value)} />}
              {preciseSourceMask && <p {...stylex.props(controlStyles.helperCopy)} id="symmetry-help">Symmetry requires Sample mode or Use cells.</p>}
            </section>

            {params.useCells && <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Spacing &amp; padding</h2>
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="cell-gap-x" label="Gap X" value={params.cellGapX} min={0} max={1024} step={1} unit="px" onChange={(value) => onChange("cellGapX", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="cell-gap-y" label="Gap Y" value={params.cellGapY} min={0} max={1024} step={1} unit="px" onChange={(value) => onChange("cellGapY", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="cell-padding" label="Cell padding" value={params.cellPadding} min={0} max={Math.min(128, params.cellSize / 2)} step={0.1} unit="px" onChange={(value) => onChange("cellPadding", value)} />
            </section>}

            <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Transform</h2>
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="pattern-offset-x" label="Position X" value={params.patternOffsetX} min={-4096} max={4096} step={1} unit="px" onChange={(value) => onChange("patternOffsetX", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="pattern-offset-y" label="Position Y" value={params.patternOffsetY} min={-4096} max={4096} step={1} unit="px" onChange={(value) => onChange("patternOffsetY", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="pattern-scale-x" label="Scale X" value={params.patternScaleX} min={0.1} max={4} step={0.01} onChange={(value) => onChange("patternScaleX", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="pattern-scale-y" label="Scale Y" value={params.patternScaleY} min={0.1} max={4} step={0.01} onChange={(value) => onChange("patternScaleY", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="geometry-rotation" label="Rotation" value={params.rotation} min={-180} max={180} step={1} unit="°" onChange={(value) => onChange("rotation", value)} />
            </section>

            <details {...stylex.props(controlStyles.panelSection, controlStyles.disclosureSection)} open={disclosuresRef.current.clip} onToggle={(event) => { disclosuresRef.current.clip = event.currentTarget.open; }}>
              <summary {...stylex.props(controlStyles.disclosureSummary)}>Pattern clip</summary>
              <div {...stylex.props(controlStyles.disclosureBody)}>
                <Select id="mask-shape" label="Pattern clip" value={params.maskShape} options={MASK_SHAPES} onChange={(value) => onChange("maskShape", value)} />
                {hasPolygonClip && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="mask-sides" label="Clip sides" value={params.maskSides} min={3} max={32} step={1} onChange={(value) => onChange("maskSides", value)} />}
                {(params.maskShape !== "none" || hasRepeatClip) && <>
                  <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="mask-scale" label="Clip scale" value={params.maskScale} min={0.1} max={1} step={0.01} onChange={(value) => onChange("maskScale", value)} />
                  <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="mask-rotation" label="Clip rotation" value={params.maskRotation} min={-180} max={180} step={1} unit="°" onChange={(value) => onChange("maskRotation", value)} />
                </>}
              </div>
            </details>

            <details {...stylex.props(controlStyles.panelSection, controlStyles.disclosureSection)} open={disclosuresRef.current.repeat} onToggle={(event) => { disclosuresRef.current.repeat = event.currentTarget.open; }}>
              <summary {...stylex.props(controlStyles.disclosureSummary)}>Repeat pattern</summary>
              <div {...stylex.props(controlStyles.disclosureBody)}>
                <div {...stylex.props(controlStyles.dimensionGrid)}>
                  <label {...stylex.props(controlStyles.dimensionLabel)} htmlFor="repeat-columns">
                    <span {...stylex.props(controlStyles.fieldLabel)}>Repeat columns</span>
                    <span {...stylex.props(controlStyles.dimensionInput)}><NumericInput ariaLabel="Repeat columns" dimension id="repeat-columns" integer max={12} min={1} name="repeat-columns" onChange={(value) => onChange("layoutColumns", value)} step={1} value={params.layoutColumns} /></span>
                  </label>
                  <label {...stylex.props(controlStyles.dimensionLabel)} htmlFor="repeat-rows">
                    <span {...stylex.props(controlStyles.fieldLabel)}>Repeat rows</span>
                    <span {...stylex.props(controlStyles.dimensionInput)}><NumericInput ariaLabel="Repeat rows" dimension id="repeat-rows" integer max={12} min={1} name="repeat-rows" onChange={(value) => onChange("layoutRows", value)} step={1} value={params.layoutRows} /></span>
                  </label>
                </div>
                <details {...stylex.props(controlStyles.nestedDisclosure)} open={disclosuresRef.current.repeatSpacing} onToggle={(event) => { disclosuresRef.current.repeatSpacing = event.currentTarget.open; }}>
                  <summary {...stylex.props(controlStyles.disclosureSummary)}>Repeat spacing &amp; outer padding</summary>
                  <div {...stylex.props(controlStyles.disclosureBody)}>
                    <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="repeat-gap-x" label="Repeat gap X" value={params.layoutGapX} min={0} max={1024} step={1} unit="px" onChange={(value) => onChange("layoutGapX", value)} />
                    <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="repeat-gap-y" label="Repeat gap Y" value={params.layoutGapY} min={0} max={1024} step={1} unit="px" onChange={(value) => onChange("layoutGapY", value)} />
                    <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="padding-top" label="Canvas padding top" value={params.paddingTop} min={0} max={2048} step={1} unit="px" onChange={(value) => onChange("paddingTop", value)} />
                    <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="padding-right" label="Canvas padding right" value={params.paddingRight} min={0} max={2048} step={1} unit="px" onChange={(value) => onChange("paddingRight", value)} />
                    <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="padding-bottom" label="Canvas padding bottom" value={params.paddingBottom} min={0} max={2048} step={1} unit="px" onChange={(value) => onChange("paddingBottom", value)} />
                    <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="padding-left" label="Canvas padding left" value={params.paddingLeft} min={0} max={2048} step={1} unit="px" onChange={(value) => onChange("paddingLeft", value)} />
                  </div>
                </details>
                {(repeatCount > 1 || repeatOverride) && <details {...stylex.props(controlStyles.nestedDisclosure)} open={disclosuresRef.current.individualRepeat} onToggle={(event) => { disclosuresRef.current.individualRepeat = event.currentTarget.open; }}>
                  <summary {...stylex.props(controlStyles.disclosureSummary)}>Individual repeat</summary>
                  <div {...stylex.props(controlStyles.disclosureBody)}>
                    {repeatCount > 1 && <Select
                      id="repeat-selector"
                      label="Repeat selector"
                      stacked
                      value={selectedRepeatIndex}
                      options={Array.from({ length: repeatCount }, (_, index) => ({ value: index, label: `${index + 1}: Row ${Math.floor(index / params.layoutColumns) + 1}, column ${index % params.layoutColumns + 1}` }))}
                      onChange={setSelectedRepeat}
                    />}
                    <div key={selectedRepeatIndex}>
                      <div {...stylex.props(controlStyles.sectionActions)}><button {...stylex.props(controlStyles.sourceButton, controlStyles.actionButton)} type="button" disabled={!repeatOverride} onClick={() => onChange("layoutCells", params.layoutCells.filter((cell) => cell.index !== selectedRepeatIndex))}>Reset selected repeat</button></div>
                      <div {...stylex.props(controlStyles.dimensionGrid, controlStyles.stackedPropertyRow)}>
                        <label {...stylex.props(controlStyles.dimensionLabel)} htmlFor="repeat-offset-x">
                          <span {...stylex.props(controlStyles.fieldLabel)}>Repeat position X</span>
                          <span {...stylex.props(controlStyles.dimensionInput)}><NumericInput ariaLabel="Repeat position X" dimension id="repeat-offset-x" integer max={4096} min={-4096} name="repeat-offset-x" onChange={(value) => changeRepeat("offsetX", value)} step={1} value={repeatOverride?.offsetX ?? 0} /><small {...stylex.props(controlStyles.dimensionUnit)}>px</small></span>
                        </label>
                        <label {...stylex.props(controlStyles.dimensionLabel)} htmlFor="repeat-offset-y">
                          <span {...stylex.props(controlStyles.fieldLabel)}>Repeat position Y</span>
                          <span {...stylex.props(controlStyles.dimensionInput)}><NumericInput ariaLabel="Repeat position Y" dimension id="repeat-offset-y" integer max={4096} min={-4096} name="repeat-offset-y" onChange={(value) => changeRepeat("offsetY", value)} step={1} value={repeatOverride?.offsetY ?? 0} /><small {...stylex.props(controlStyles.dimensionUnit)}>px</small></span>
                        </label>
                        <label {...stylex.props(controlStyles.dimensionLabel)} htmlFor="repeat-scale-x">
                          <span {...stylex.props(controlStyles.fieldLabel)}>Repeat scale X</span>
                          <span {...stylex.props(controlStyles.dimensionInput)}><NumericInput ariaLabel="Repeat scale X" dimension id="repeat-scale-x" max={4} min={0.1} name="repeat-scale-x" onChange={(value) => changeRepeat("scaleX", value)} step={0.01} value={repeatOverride?.scaleX ?? 1} /></span>
                        </label>
                        <label {...stylex.props(controlStyles.dimensionLabel)} htmlFor="repeat-scale-y">
                          <span {...stylex.props(controlStyles.fieldLabel)}>Repeat scale Y</span>
                          <span {...stylex.props(controlStyles.dimensionInput)}><NumericInput ariaLabel="Repeat scale Y" dimension id="repeat-scale-y" max={4} min={0.1} name="repeat-scale-y" onChange={(value) => changeRepeat("scaleY", value)} step={0.01} value={repeatOverride?.scaleY ?? 1} /></span>
                        </label>
                      </div>
                      <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="repeat-rotation" label="Repeat rotation" value={repeatOverride?.rotation ?? 0} min={-180} max={180} step={1} unit="°" onChange={(value) => changeRepeat("rotation", value)} />
                      <Select id="repeat-clip-shape" label="Repeat clip" value={repeatOverride?.maskShape ?? "inherit"} options={[{ value: "inherit", label: "Use pattern clip" }, ...MASK_SHAPES]} onChange={(value) => changeRepeat("maskShape", value === "inherit" ? undefined : value)} />
                      {repeatClipShape !== "none" && <>
                        <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="repeat-clip-scale" label="Repeat clip scale" value={repeatOverride?.maskScale ?? params.maskScale} min={0.1} max={1} step={0.01} onChange={(value) => changeRepeat("maskScale", value)} />
                        <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="repeat-clip-rotation" label="Repeat clip rotation" value={repeatOverride?.maskRotation ?? params.maskRotation} min={-180} max={180} step={1} unit="°" onChange={(value) => changeRepeat("maskRotation", value)} />
                      </>}
                      <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="repeat-padding" label="Repeat padding" value={repeatOverride?.padding ?? 0} min={0} max={1024} step={1} unit="px" onChange={(value) => changeRepeat("padding", value)} />
                    </div>
                  </div>
                </details>}
              </div>
            </details>

            <details {...stylex.props(controlStyles.panelSection, controlStyles.disclosureSection)} open={disclosuresRef.current.asymmetry} onToggle={(event) => { disclosuresRef.current.asymmetry = event.currentTarget.open; }}>
              <summary {...stylex.props(controlStyles.disclosureSummary)}>Asymmetry</summary>
              <div {...stylex.props(controlStyles.disclosureBody)}>
                {(params.useCells || atlasPattern) && (
                  <>
                    <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="row-shift" label="Row Shift" value={params.rowShift} min={0} max={240} step={1} unit="px" onChange={(value) => onChange("rowShift", value)} />
                    <Select id="row-shift-mode" label="Row shift mode" value={params.rowShiftMode} options={[{ value: "alternating", label: "Alternating" }, { value: "wave", label: "Wave" }]} onChange={(value) => onChange("rowShiftMode", value)} />
                  </>
                )}
                {!params.useCells && params.preset === "radial" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="radial-twist" label="Twist per band" value={params.radialTwist} min={-180} max={180} step={1} unit="°" onChange={(value) => onChange("radialTwist", value)} />}
                <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked={params.useCells || atlasPattern || params.preset === "radial"} id="jitter" label="Jitter" value={params.jitter} min={0} max={1} step={0.01} onChange={(value) => onChange("jitter", value)} />
                <div {...stylex.props(controlStyles.selectControl)}>
                  <label {...stylex.props(controlStyles.fieldLabel)} htmlFor="jitter-seed">Jitter seed</label>
                  <span {...stylex.props(controlStyles.numberField)}><NumericInput ariaLabel="Jitter seed" id="jitter-seed" integer max={99999} min={0} name="jitter-seed" onChange={(value) => onChange("seed", value)} step={1} value={params.seed} /></span>
                </div>
              </div>
            </details>

            {params.sourceMode === "sample" && <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Sampling</h2>
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="contrast" label="Contrast" value={params.contrast} min={0.1} max={4} step={0.01} onChange={(value) => onChange("contrast", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="luminance-bias" label="Luminance Bias" value={params.luminanceBias} min={-1} max={1} step={0.01} onChange={(value) => onChange("luminanceBias", value)} />
              <Toggle id="invert" label="Invert" checked={params.invert} spacing="property" onChange={(value) => onChange("invert", value)} />
            </section>}

            <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Color</h2>
              <Select id="color-mode" label="Mode" value={params.colorMode} options={[{ value: "custom", label: "Custom" }, { value: "monochrome", label: "Monochrome" }, { value: "source", label: "Source" }, { value: "gradient", label: "Gradient" }]} onChange={(value) => onChange("colorMode", value)} />
              {params.colorMode === "custom" && (
                <div {...stylex.props(controlStyles.segmented, controlStyles.compactSegmented)} role="group" aria-label="Color count">
                  {([2, 3, 4] as const).map((count) => <button {...stylex.props(controlStyles.segmentedButton, params.colorCount === count && controlStyles.activeSegmentedButton)} key={count} type="button" aria-pressed={params.colorCount === count} onClick={() => onChange("colorCount", count)}>{count} colors</button>)}
                </div>
              )}
              {params.colorMode === "gradient" && <Select id="gradient-type" label="Gradient type" value={params.gradientType} options={[{ value: "linear", label: "Linear" }, { value: "radial", label: "Radial" }]} onChange={(value) => onChange("gradientType", value)} />}
              {(params.colorMode === "custom" || params.colorMode === "gradient") && (
                <div {...stylex.props(controlStyles.colorList)}>
                  <ColorControl label="Background" name="background-color" value={params.backgroundColor} onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} onChange={(value) => onChange("backgroundColor", value)} />
                  {params.colorMode === "custom" && params.colors.slice(0, params.colorCount).map((color, index) => (
                    <ColorControl key={index} label={index === 0 ? "Shadows" : index === params.colorCount - 1 ? "Highlights" : `Midtone ${index}`} name={`palette-${index}`} value={color} onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} onChange={(value) => {
                      const colors: PatternParams["colors"] = [...params.colors];
                      colors[index] = value;
                      onChange("colors", colors);
                    }} />
                  ))}
                  {params.colorMode === "gradient" && <>
                    <ColorControl label="Start color" name="gradient-start" value={params.gradientStart} onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} onChange={(value) => onChange("gradientStart", value)} />
                    <ColorControl label="End color" name="gradient-end" value={params.gradientEnd} onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} onChange={(value) => onChange("gradientEnd", value)} />
                  </>}
                </div>
              )}
              {params.colorMode === "gradient" && <details {...stylex.props(controlStyles.nestedDisclosure)} open={disclosuresRef.current.gradient} onToggle={(event) => { disclosuresRef.current.gradient = event.currentTarget.open; }}>
                <summary {...stylex.props(controlStyles.disclosureSummary)}>Gradient placement</summary>
                <div {...stylex.props(controlStyles.disclosureBody)}>
                  {params.gradientType === "linear" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="gradient-angle" label="Gradient angle" value={params.gradientAngle} min={-180} max={180} step={1} unit="°" onChange={(value) => onChange("gradientAngle", value)} />}
                  <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked={params.gradientType === "linear"} id="gradient-center-x" label="Gradient center X" value={params.gradientCenterX} min={-1} max={1} step={0.01} onChange={(value) => onChange("gradientCenterX", value)} />
                  <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="gradient-center-y" label="Gradient center Y" value={params.gradientCenterY} min={-1} max={1} step={0.01} onChange={(value) => onChange("gradientCenterY", value)} />
                  <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="gradient-span" label="Gradient span" value={params.gradientSpan} min={0.1} max={2} step={0.01} onChange={(value) => onChange("gradientSpan", value)} />
                </div>
              </details>}
              {params.colorMode === "monochrome" && <div {...stylex.props(controlStyles.colorList)}><ColorControl label="Tint" name="mono-color" value={params.monoColor} onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} onChange={(value) => onChange("monoColor", value)} /></div>}
              {params.colorMode === "source" && !params.useCells && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="source-background" label="Background" value={params.sourceBackground} min={0} max={1} step={0.01} onChange={(value) => onChange("sourceBackground", value)} />}
            </section>

            <section {...stylex.props(controlStyles.panelSection, controlStyles.lastPanelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Motion</h2>
              {selectedCellId && <>
                <p {...stylex.props(controlStyles.helperCopy)} role="status">Editing cell: repeat {(cellAddress[0] ?? 0) + 1}, row {(cellAddress[1] ?? 0) + 1}, column {(cellAddress[2] ?? 0) + 1}.</p>
                <div {...stylex.props(controlStyles.sectionActions)}><button {...stylex.props(controlStyles.sourceButton, controlStyles.actionButton)} type="button" onClick={() => onSelectCell(undefined)}>Edit all cells</button></div>
              </>}
              <div key={selectedCellId ?? "all"}>
                <Select id="animation" label="Animation" value={motion.animation} options={[{ value: "none", label: "None" }, { value: "pulse", label: "Pulse" }, { value: "rotate", label: "Rotate" }, { value: "wave", label: "Wave" }]} onChange={(value) => changeMotion("animation", value)} />
                {motion.animation !== "none" && <>
                  <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="animation-duration" label="Duration" value={motion.animationDuration} min={0.5} max={30} step={0.01} unit="s" onChange={(value) => changeMotion("animationDuration", value)} />
                  {motion.animation !== "rotate" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="animation-amount" label="Amount" value={motion.animationAmount} min={0} max={1} step={0.01} onChange={(value) => changeMotion("animationAmount", value)} />}
                </>}
                {motion.animation === "wave" && <>
                  <Select id="animation-axis" label="Wave axis" value={motion.animationAxis} options={[{ value: "x", label: "X (horizontal)" }, { value: "y", label: "Y (vertical)" }]} onChange={(value) => changeMotion("animationAxis", value)} />
                  <Select id="animation-stagger-by" label="Stagger by" value={motion.animationStaggerBy} options={[{ value: "column", label: "Column" }, { value: "row", label: "Row" }, { value: "index", label: "Cell index" }, { value: "none", label: "None" }]} onChange={(value) => changeMotion("animationStaggerBy", value)} />
                  {motion.animationStaggerBy !== "none" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="animation-stagger" label="Phase step" value={motion.animationStagger} min={0} max={1} step={0.001} unit="cycles" onChange={(value) => changeMotion("animationStagger", value)} />}
                </>}
              </div>
              <div {...stylex.props(controlStyles.sectionActions)}>
                <button {...stylex.props(controlStyles.sourceButton, controlStyles.actionButton)} type="button" disabled={!onTogglePlayback} onClick={onTogglePlayback}>{playing ? "Pause" : "Play"}</button>
                <button {...stylex.props(controlStyles.sourceButton, controlStyles.actionButton)} type="button" disabled={!onResetPlayback} onClick={onResetPlayback}>Reset timeline</button>
              </div>
              <details {...stylex.props(controlStyles.nestedDisclosure)} open={disclosuresRef.current.motionTimeline} onToggle={(event) => { disclosuresRef.current.motionTimeline = event.currentTarget.open; }}>
                <summary {...stylex.props(controlStyles.disclosureSummary)}>Timeline &amp; phase</summary>
                <div {...stylex.props(controlStyles.disclosureBody)}>
                  <div {...stylex.props(controlStyles.selectControl)}>
                    <label {...stylex.props(controlStyles.fieldLabel)} htmlFor="animation-time">Timeline</label>
                    <span {...stylex.props(controlStyles.numberField)}><NumericInput ariaLabel="Timeline seconds" id="animation-time" max={86400} min={0} name="animation-time" onChange={(value) => onChange("animationTime", value)} step={0.001} value={params.animationTime} /><span {...stylex.props(controlStyles.numberUnit)}>s</span></span>
                  </div>
                  {motion.animation !== "none" && <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="animation-phase" label="Loop phase" value={motion.animationPhase} min={0} max={1} step={0.001} unit="cycles" onChange={(value) => changeMotion("animationPhase", value)} />}
                </div>
              </details>
              <details {...stylex.props(controlStyles.nestedDisclosure)} open={disclosuresRef.current.motionCell} onToggle={(event) => { disclosuresRef.current.motionCell = event.currentTarget.open; }}>
                <summary {...stylex.props(controlStyles.disclosureSummary)}>Individual cell</summary>
                <div {...stylex.props(controlStyles.disclosureBody)}>
                  <Select id="animation-target" label="Apply to" value={selectedCellId ? "cell" : "all"} options={[{ value: "all", label: "All cells" }, { value: "cell", label: "Individual cell" }]} onChange={(value) => onSelectCell(value === "all" ? undefined : entities.find((cell) => cell.visible)?.id ?? entities[0]?.id ?? "cell:0:0:0")} />
                  <p {...stylex.props(controlStyles.helperCopy)}>{visibleCellCount.toLocaleString()} / {entities.length.toLocaleString()} cells visible, {params.cellAnimations.length.toLocaleString()} overrides</p>
                  {!params.useCells && <p {...stylex.props(controlStyles.helperCopy)}>Cell motion requires Use cells.</p>}
                  {selectedCellId && <>
                    <div {...stylex.props(controlStyles.dimensionGrid, controlStyles.stackedPropertyRow)}>
                      {(["Repeat", "Row", "Column"] as const).map((label, index) => (
                        <label {...stylex.props(controlStyles.dimensionLabel)} key={label} htmlFor={`motion-cell-${label.toLowerCase()}`}>
                          <span {...stylex.props(controlStyles.fieldLabel)}>{label}</span>
                          <span {...stylex.props(controlStyles.dimensionInput)}><NumericInput ariaLabel={`Cell ${label.toLowerCase()}`} dimension id={`motion-cell-${label.toLowerCase()}`} integer max={index === 0 ? 144 : 1024} min={1} name={`motion-cell-${label.toLowerCase()}`} step={1} value={(cellAddress[index] ?? 0) + 1} onChange={(value) => {
                            const address = [...cellAddress];
                            address[index] = value - 1;
                            onSelectCell(`cell:${address.join(":")}`);
                          }} /></span>
                        </label>
                      ))}
                    </div>
                    <p {...stylex.props(controlStyles.helperCopy)} role="status">
                      {selectedCellId}: {selectedEntity
                        ? selectedEntity.visible ? "Visible" : selectedEntity.hiddenReason === "source" ? "Excluded by source" : `Hidden: ${selectedEntity.hiddenReason?.replaceAll("-", " ") ?? "not visible"}`
                        : "Outside current grid"}
                    </p>
                    <div {...stylex.props(controlStyles.sectionActions)}><button {...stylex.props(controlStyles.sourceButton, controlStyles.actionButton)} type="button" disabled={!cellOverride} onClick={() => onChange("cellAnimations", params.cellAnimations.filter((cell) => cell.id !== selectedCellId))}>Reset selected cell</button></div>
                  </>}
                  {inactiveOverrideCount > 0 && <p {...stylex.props(controlStyles.helperCopy)}>{inactiveOverrideCount.toLocaleString()} inactive overrides</p>}
                  {selectedCellId && <details {...stylex.props(controlStyles.nestedDisclosure)} open={disclosuresRef.current.motionInheritance} onToggle={(event) => { disclosuresRef.current.motionInheritance = event.currentTarget.open; }}>
                    <summary {...stylex.props(controlStyles.disclosureSummary)}>Field inheritance</summary>
                    <div {...stylex.props(controlStyles.disclosureBody)}>
                      {motionInheritance("animation", "Animation")}
                      {motionInheritance("animationDuration", "Duration")}
                      {motionInheritance("animationAmount", "Amount")}
                      {motionInheritance("animationPhase", "Loop phase")}
                      {motionInheritance("animationAxis", "Wave axis")}
                      {motionInheritance("animationStaggerBy", "Stagger by")}
                      {motionInheritance("animationStagger", "Phase step")}
                    </div>
                  </details>}
                </div>
              </details>
            </section>
          </>
        )}

        {selected === "source" && (
          <>
            <section {...stylex.props(controlStyles.panelSection, controlStyles.sourceSummary)} data-testid="source-summary">
              <div {...stylex.props(controlStyles.sourceIcon)}><Icon name="image" size={18} /></div>
              <div {...stylex.props(controlStyles.sourceCopy)}><strong {...stylex.props(controlStyles.sourceName)}>{source.name}</strong><span {...stylex.props(controlStyles.sourceDetail)}>{source.width} × {source.height}, {source.usesAlpha ? "alpha" : "luminance"}</span></div>
              <button {...stylex.props(controlStyles.sourceButton)} type="button" onClick={onChooseSource}>Replace</button>
            </section>
            <section {...stylex.props(controlStyles.panelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Source use</h2>
              <Select id="source-mode" label="Source mode" value={params.sourceMode} describedBy={maskUnavailable ? "source-mask-help" : undefined} options={[{ value: "sample", label: "Sample" }, { value: "mask", label: "Mask", disabled: maskUnavailable }, { value: "ignore", label: "Ignore" }]} onChange={(value) => onChange("sourceMode", value)} />
              {!supportsMask
                ? <p {...stylex.props(controlStyles.helperCopy)} id="source-mask-help">Mask requires a filled SVG or Use cells.</p>
                : !params.useCells && params.symmetry !== "none" && <p {...stylex.props(controlStyles.helperCopy)} id="source-mask-help">Mask requires Symmetry: None.</p>}
            </section>
            {params.sourceMode !== "ignore" && <section {...stylex.props(controlStyles.panelSection, params.sourceMode === "mask" && controlStyles.lastPanelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Placement</h2>
              <div {...stylex.props(controlStyles.segmented)} role="group" aria-label="Source fit">
                {(["contain", "cover", "stretch"] as const).map((fit) => <button {...stylex.props(controlStyles.segmentedButton, params.fit === fit && controlStyles.activeSegmentedButton)} key={fit} type="button" aria-pressed={params.fit === fit} onClick={() => onChange("fit", fit)}>{fit}</button>)}
              </div>
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} id="source-scale" label="Scale" value={params.scale} min={0.1} max={4} step={0.01} onChange={(value) => onChange("scale", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="source-x" label="Offset X" value={params.offsetX} min={-1} max={1} step={0.01} onChange={(value) => onChange("offsetX", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="source-y" label="Offset Y" value={params.offsetY} min={-1} max={1} step={0.01} onChange={(value) => onChange("offsetY", value)} />
              <RangeControl onChangeEnd={onChangeEnd} onChangeStart={onChangeStart} stacked id="source-rotation" label="Source rotation" value={params.sourceRotation} min={-180} max={180} step={1} unit="°" onChange={(value) => onChange("sourceRotation", value)} />
              <div {...stylex.props(controlStyles.sectionActions)}><button {...stylex.props(controlStyles.sourceButton, controlStyles.actionButton)} type="button" onClick={() => onPreset({ name: "Center source", description: "", params: { offsetX: 0, offsetY: 0, sourceRotation: 0, scale: 1 } })}>Center source</button></div>
            </section>}
            {params.sourceMode === "sample" && <section {...stylex.props(controlStyles.panelSection, controlStyles.lastPanelSection)}>
              <h2 {...stylex.props(controlStyles.overline)}>Channel</h2>
              <Select id="sample-channel" label="Sample" value={params.sampleChannel} options={[{ value: "auto", label: "Auto" }, { value: "luminance", label: "Luminance" }, { value: "alpha", label: "Alpha" }]} onChange={(value) => onChange("sampleChannel", value)} />
            </section>}
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

          </>
        )}
      </div>
    </aside>
  );
}
