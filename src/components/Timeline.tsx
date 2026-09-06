import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useAnimationFrame, useMotionValue } from "motion/react";
import type { PatternParams } from "../model/types";
import { createKeyframeEvaluator, KEYFRAME_LIMITS, KEYFRAME_PROPERTIES, KEYFRAME_VALUE_RANGES } from "../model/keyframes";
import type { KeyboardEvent, PointerEvent } from "react";
import { timelineStyles as s } from "../styles/Timeline.stylex";
import { Select } from "./Select";

type Bezier = [number, number, number, number];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rounded = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

function NumberField({ value, min, max, step, label, name, onChange, onStart, onEnd, compact = false }: {
  value: number; min: number; max: number; step: number; label: string; name: string;
  onChange: (value: number) => void; onStart?: () => void; onEnd?: () => void; compact?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input {...stylex.props(s.number, compact && s.coordinate)} type="number" name={name} aria-label={label} autoComplete="off" step={step} min={min} max={max} value={draft ?? value}
    onFocus={(event) => { setDraft(event.currentTarget.value); onStart?.(); }}
    onChange={(event) => {
      setDraft(event.currentTarget.value);
      const number = event.currentTarget.valueAsNumber;
      if (Number.isFinite(number) && number >= min && number <= max && rounded(number) !== value) onChange(rounded(number));
    }}
    onBlur={(event) => {
      const number = event.currentTarget.valueAsNumber;
      if (Number.isFinite(number) && rounded(clamp(number, min, max)) !== value) onChange(rounded(clamp(number, min, max)));
      setDraft(null); onEnd?.();
    }}
    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

function BezierEditor({ value, onChange, onStart, onEnd }: {
  value: Bezier;
  onChange: (value: Bezier) => void;
  onStart?: () => void;
  onEnd?: () => void;
}) {
  const graph = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; rect: DOMRect } | null>(null);
  const update = (index: number, x: number, y: number) => {
    const next: Bezier = [...value];
    next[index] = rounded(clamp(x, 0, 1));
    next[index + 1] = rounded(clamp(y, -2, 3));
    onChange(next);
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const { index, rect } = drag.current;
    const x = ((event.clientX - rect.left) / rect.width * 108 - 14) / 80;
    const y = (62 - (event.clientY - rect.top) / rect.height * 108) / 16;
    update(index, x, y);
  };
  const finish = () => { if (drag.current) { drag.current = null; onEnd?.(); } };
  const key = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.01;
    onStart?.();
    update(index, value[index]! + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0), value[index + 1]! + (event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0));
    onEnd?.();
  };
  return <div {...stylex.props(s.easing)} aria-label="Segment easing">
    <div {...stylex.props(s.graph)} ref={graph}>
      <svg {...stylex.props(s.curve)} viewBox="0 0 108 108" aria-hidden="true">
        <path d="M14 0V108 M94 0V108 M0 46H108 M0 62H108" stroke="#39393e" fill="none" />
        <path d={`M14 62 L${14 + value[0] * 80} ${62 - value[1] * 16} M94 46 L${14 + value[2] * 80} ${62 - value[3] * 16}`} stroke="#85858f" fill="none" />
        <path d={`M14 62 C${14 + value[0] * 80} ${62 - value[1] * 16}, ${14 + value[2] * 80} ${62 - value[3] * 16}, 94 46`} stroke="#eeeeef" strokeWidth="2" fill="none" />
        <circle cx="14" cy="62" r="2" fill="#eeeeef" /><circle cx="94" cy="46" r="2" fill="#eeeeef" />
      </svg>
      {[0, 2].map((index) => <button key={index} type="button" {...stylex.props(s.handle)} style={{ left: 14 + value[index]! * 80, top: 62 - value[index + 1]! * 16 }} aria-label={`Bezier handle ${index / 2 + 1}; use arrow keys`} title={`Handle ${index / 2 + 1}: ${value[index]}, ${value[index + 1]}`}
        onPointerDown={(event) => { if (event.button !== 0 || !graph.current) return; onStart?.(); drag.current = { index, rect: graph.current.getBoundingClientRect() }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={(event) => key(event, index)}><span aria-hidden="true">○</span></button>)}
    </div>
    <div {...stylex.props(s.coordinates)}>
      {value.map((coordinate, index) => <label key={index} {...stylex.props(s.label)}>{["x1", "y1", "x2", "y2"][index]}
        <NumberField compact name={`bezier-${index}`} label={`Bezier ${["x1", "y1", "x2", "y2"][index]}`} step={0.01} min={index % 2 === 0 ? 0 : -2} max={index % 2 === 0 ? 1 : 3} value={coordinate}
          onStart={onStart} onEnd={onEnd} onChange={(number) => { const next: Bezier = [...value]; next[index] = number; onChange(next); }} />
      </label>)}
    </div>
  </div>;
}

type Track = PatternParams["keyframeTracks"][number];
type Key = Track["keyframes"][number];
type Property = Track["property"];
const propertyLabels: Record<Property, string> = { x: "Position X", y: "Position Y", scale: "Scale", rotation: "Rotation", opacity: "Opacity" };
const properties = KEYFRAME_PROPERTIES.map((id) => ({
  id, label: propertyLabels[id], min: KEYFRAME_VALUE_RANGES[id][0], max: KEYFRAME_VALUE_RANGES[id][1],
  step: id === "scale" || id === "opacity" ? 0.01 : 1,
}));

interface TimelineProps {
  params: PatternParams;
  selectedCellId?: string | null;
  onPatch: (patch: Partial<PatternParams>) => void;
  onSeek: (time: number) => void;
  playing: boolean;
  onTogglePlayback: () => void;
  onClose: () => void;
  getTime: () => number;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

export function Timeline({ params, selectedCellId, onPatch, onSeek, playing, onTogglePlayback, onClose, getTime, onInteractionStart, onInteractionEnd }: TimelineProps) {
  const [scope, setScope] = useState<"all" | "cell">(selectedCellId ? "cell" : "all");
  const [property, setProperty] = useState<Property>("x");
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const target = scope === "cell" && selectedCellId ? selectedCellId : "all";
  const track = params.keyframeTracks.find((item) => item.target === target && item.property === property);
  const keys = track?.keyframes ?? [];
  const selectedIndex = keys.findIndex((item) => item.time === selectedTime);
  const selected = keys[selectedIndex];
  const definition = properties.find((item) => item.id === property)!;
  const evaluator = useMemo(() => createKeyframeEvaluator(params), [params.keyframeTracks, params.keyframeDuration, params.keyframeLoop]);
  const latest = useRef(params);
  latest.current = params;
  const playButton = useRef<HTMLButtonElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  const clock = useRef<HTMLOutputElement>(null);
  const drag = useRef<{ time: number; rect: DOMRect; startX: number; startTime: number; moved: boolean } | null>(null);
  const transaction = useRef(false);
  const endRef = useRef(onInteractionEnd);
  endRef.current = onInteractionEnd;
  const playhead = useMotionValue("0%");
  const localTime = (time: number) => params.keyframeLoop
    ? ((time % params.keyframeDuration) + params.keyframeDuration) % params.keyframeDuration
    : clamp(time, 0, params.keyframeDuration);
  const syncCursor = () => {
    const time = localTime(getTime());
    playhead.set(`${time / params.keyframeDuration * 100}%`);
    if (scrub.current && document.activeElement !== scrub.current) scrub.current.value = String(time);
    if (clock.current) clock.current.textContent = `${time.toFixed(2)} s`;
  };
  useAnimationFrame(() => { if (playing) syncCursor(); });
  useEffect(syncCursor, [params.animationTime, params.keyframeDuration, params.keyframeLoop, playing]);
  useEffect(() => { playButton.current?.focus({ preventScroll: true }); return () => { if (transaction.current) endRef.current?.(); }; }, []);
  const begin = () => { if (!transaction.current) { transaction.current = true; onInteractionStart?.(); } };
  const end = () => { if (transaction.current) { transaction.current = false; onInteractionEnd?.(); } };
  const writeKeys = (next: Key[]) => {
    const others = latest.current.keyframeTracks.filter((item) => item.target !== target || item.property !== property);
    const keyframeTracks = next.length ? [...others, { target, property, keyframes: next }] : others;
    latest.current = { ...latest.current, keyframeTracks };
    onPatch({ keyframeTracks });
  };
  const editKey = (time: number, patch: Partial<Key>) => {
    const current = latest.current.keyframeTracks.find((item) => item.target === target && item.property === property)?.keyframes ?? [];
    const index = current.findIndex((item) => item.time === time);
    if (index < 0) return;
    const key = current[index]!;
    const nextTime = patch.time === undefined ? time : rounded(clamp(patch.time, index ? current[index - 1]!.time + 0.000001 : 0, index < current.length - 1 ? current[index + 1]!.time - 0.000001 : params.keyframeDuration));
    writeKeys(current.map((item, itemIndex) => itemIndex === index ? { ...key, ...patch, time: nextTime } : item));
    setSelectedTime(nextTime);
    return nextTime;
  };
  const addKey = () => {
    const time = rounded(localTime(getTime()));
    setSelectedTime(time);
    if (keys.some((item) => item.time === time)) return;
    begin();
    writeKeys([...keys, { time, value: rounded(clamp(evaluator(target, getTime())[property], definition.min, definition.max)), easing: [0, 0, 1, 1] as Bezier }].sort((a, b) => a.time - b.time));
    end();
  };
  const deleteKey = () => {
    if (!selected) return;
    begin();
    writeKeys(keys.filter((item) => item.time !== selected.time));
    setSelectedTime(keys[selectedIndex - 1]?.time ?? keys[selectedIndex + 1]?.time ?? null);
    end();
  };
  const moveKey = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current) return;
    if (!current.moved && Math.abs(event.clientX - current.startX) < 2) return;
    current.moved = true;
    const time = editKey(current.time, { time: current.startTime + (event.clientX - current.startX) / current.rect.width * params.keyframeDuration });
    if (time !== undefined) current.time = time;
  };
  const finishDrag = () => { drag.current = null; end(); };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, time: number) => {
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteKey(); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    begin();
    editKey(time, { time: event.key === "Home" ? 0 : event.key === "End" ? params.keyframeDuration : time + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 0.1 : 0.01) });
    end();
  };
  const totalKeys = params.keyframeTracks.reduce((sum, item) => sum + item.keyframes.length, 0);
  const lastKey = Math.max(0.1, ...params.keyframeTracks.map((item) => item.keyframes.at(-1)?.time ?? 0));
  return <section {...stylex.props(s.dock)} aria-label="Timeline" data-testid="timeline">
    <div {...stylex.props(s.toolbar)}>
      <h2 {...stylex.props(s.title)}>Timeline</h2>
      <button {...stylex.props(s.button)} ref={playButton} type="button" aria-label={playing ? "Pause animation" : "Play animation"} onClick={onTogglePlayback}>{playing ? "Pause" : "Play"}</button>
      <div {...stylex.props(s.select)}><Select id="timeline-target" label="Keyframe target" stacked value={target === "all" ? "all" : "cell"}
        options={[{ value: "all", label: "All cells" }, { value: "cell", label: "Selected cell", disabled: !selectedCellId }]}
        onChange={(value) => { setScope(value); setSelectedTime(null); }} /></div>
      <div {...stylex.props(s.select)}><Select id="timeline-property" label="Keyframe property" stacked value={property}
        options={properties.map((item) => ({ value: item.id, label: item.label }))}
        onChange={(value) => { setProperty(value); setSelectedTime(null); }} /></div>
      <button {...stylex.props(s.button)} type="button" onClick={addKey} disabled={keys.length >= KEYFRAME_LIMITS.keysPerTrack || (!track && params.keyframeTracks.length >= KEYFRAME_LIMITS.tracks) || totalKeys >= KEYFRAME_LIMITS.totalKeys || !params.useCells}>Add key</button>
      <button {...stylex.props(s.button)} type="button" onClick={deleteKey} disabled={!selected}>Delete key</button>
      <button {...stylex.props(s.button, s.close)} type="button" onClick={onClose} aria-label="Close timeline">×</button>
    </div>
    <div {...stylex.props(s.body)}>
      <div {...stylex.props(s.tracks)}>
        <div {...stylex.props(s.scrubRow)}>
          <input {...stylex.props(s.scrub)} ref={scrub} type="range" aria-label="Timeline position" min="0" max={params.keyframeDuration} step="0.001" defaultValue={localTime(params.animationTime)}
            onPointerDown={(event) => { begin(); event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end}
            onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) begin(); }}
            onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) end(); }}
            onChange={(event) => { begin(); const time = event.currentTarget.valueAsNumber; onSeek(time); playhead.set(`${time / params.keyframeDuration * 100}%`); if (clock.current) clock.current.textContent = `${time.toFixed(2)} s`; }} />
          <output {...stylex.props(s.clock)} ref={clock} aria-label="Current time">{localTime(params.animationTime).toFixed(2)} s</output>
        </div>
        <div {...stylex.props(s.lane)} ref={lane} aria-label={`${definition.label} keyframes`}>
          <div {...stylex.props(s.cursorClip)} aria-hidden="true"><motion.div {...stylex.props(s.playhead)} style={{ x: playhead }} /></div>
          {keys.map((item, index) => <button key={index} {...stylex.props(s.key, item.time === selectedTime && s.selectedKey)} type="button" style={{ left: `${item.time / params.keyframeDuration * 100}%` }}
            aria-label={`${definition.label} key ${index + 1} at ${item.time} seconds`} aria-pressed={item.time === selectedTime} title={`${item.time} s: ${item.value}`}
            onFocus={() => setSelectedTime(item.time)} onClick={() => setSelectedTime(item.time)}
            onPointerDown={(event) => { if (event.button !== 0 || !lane.current) return; setSelectedTime(item.time); begin(); drag.current = { time: item.time, rect: lane.current.getBoundingClientRect(), startX: event.clientX, startTime: item.time, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={moveKey} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} onKeyDown={(event) => keyDown(event, item.time)}><span aria-hidden="true">◆</span></button>)}
        </div>
        <div {...stylex.props(s.fields)}>
          <label {...stylex.props(s.label)}>Duration <NumberField name="keyframe-duration" label="Timeline duration" min={lastKey} max={60} step={0.1} value={params.keyframeDuration} onStart={begin} onEnd={end} onChange={(value) => onPatch({ keyframeDuration: value })} /> s</label>
          <label {...stylex.props(s.label)}><input type="checkbox" checked={params.keyframeLoop} onChange={(event) => onPatch({ keyframeLoop: event.currentTarget.checked })} />Loop</label>
          {selected && <>
            <label {...stylex.props(s.label)}>Time <NumberField name="keyframe-time" label="Key time" min={selectedIndex ? keys[selectedIndex - 1]!.time + 0.000001 : 0} max={selectedIndex < keys.length - 1 ? keys[selectedIndex + 1]!.time - 0.000001 : params.keyframeDuration} step={0.01} value={selected.time} onStart={begin} onEnd={end} onChange={(value) => editKey(selected.time, { time: value })} /></label>
            <label {...stylex.props(s.label)}>Value <NumberField name="keyframe-value" label="Key value" min={definition.min} max={definition.max} step={definition.step} value={selected.value} onStart={begin} onEnd={end} onChange={(value) => editKey(selected.time, { value })} /></label>
          </>}
        </div>
        {!keys.length && <p {...stylex.props(s.empty)}>{params.useCells ? "No keys" : "Enable cells to add keys"}</p>}
      </div>
      {selected && selectedIndex < keys.length - 1
        ? <BezierEditor value={selected.easing ?? [0, 0, 1, 1]} onChange={(easing) => editKey(selected.time, { easing })} onStart={begin} onEnd={end} />
        : <p {...stylex.props(s.empty)}>{selected ? "Last key" : keys.length ? "Select a key" : ""}</p>}
    </div>
  </section>;
}
