import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { videoFrameCount, type ExportFormat, type ExportOptions, type ExportSupport } from "../export/encode";
import { exportMenuStyles } from "../styles/ExportMenu.stylex";
import { Icon } from "./Icon";

export type ExportRequest = Omit<ExportOptions, "format" | "signal" | "onProgress"> & { format: ExportFormat | "json" };
export type ExportCapabilities = Partial<Record<ExportRequest["format"], ExportSupport>>;

interface ExportMenuProps {
  capabilities: ExportCapabilities;
  animationDuration: number;
  busy: boolean;
  progress?: number;
  error?: string;
  backgroundColor?: string;
  onExport: (request: ExportRequest) => void;
  onCancel: () => void;
  onOpen?: () => void;
}

type FieldErrors = Partial<Record<"format" | "duration" | "fps" | "quality" | "background", string>>;

const FORMATS = [
  { value: "svg", label: "SVG" },
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
  { value: "json", label: "Project JSON" },
] as const;

export function ExportMenu({ capabilities, animationDuration, busy, progress, error, backgroundColor = "#ffffff", onExport, onCancel, onOpen }: ExportMenuProps) {
  const id = useId();
  const dialogId = `${id}-export-dialog`;
  const formId = `${id}-export-form`;
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportRequest["format"]>("png");
  const [duration, setDuration] = useState(String(animationDuration));
  const [fps, setFps] = useState("30");
  const [quality, setQuality] = useState("92");
  const [background, setBackground] = useState(/^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor : "#ffffff");
  const [errors, setErrors] = useState<FieldErrors>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formatLegendRef = useRef<HTMLLegendElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const backdropPressRef = useRef(false);
  const video = format === "mp4" || format === "webm";
  const adjustableQuality = format === "jpeg" || format === "webp";
  const opaque = format === "jpeg" || video;
  const selectedFormat = FORMATS.find((option) => option.value === format)!;
  const formatChoices = FORMATS.map((option) => {
    const available = capabilities[option.value];
    return {
      ...option,
      unavailable: !available?.supported,
      reason: available?.reason?.trim() || (available ? available.supported ? undefined : "Unavailable in this browser." : "Checking support…"),
    };
  });
  const capabilityNotes = [...new Set(formatChoices.flatMap((option) => option.reason ? [option.reason] : []))];
  const support = capabilities[format];
  const numericFps = Number(fps);
  const validFps = fps.trim() !== "" && Number.isInteger(numericFps) && numericFps >= 1 && numericFps <= 60;
  const frameCount = Number(duration) * numericFps;
  const showFrameCount = video && validFps && duration.trim() !== "" && Number.isFinite(frameCount) && frameCount >= 1 && Math.abs(frameCount - Math.round(frameCount)) <= 1e-7;
  const progressValue = progress !== undefined && Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : undefined;
  const percent = progressValue === undefined ? undefined : Math.round(progressValue * 100);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (open && busy) cancelRef.current?.focus({ preventScroll: true });
  }, [busy, open]);

  const cancel = () => {
    if (busy) onCancel();
    setOpen(false);
    dialogRef.current?.close();
  };

  return (
    <>
      <button
        {...stylex.props(exportMenuStyles.trigger)}
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => {
          onOpen?.();
          if (!busy) {
            setDuration(String(animationDuration));
            setBackground(/^#[0-9a-f]{6}$/i.test(backgroundColor) ? backgroundColor : "#ffffff");
            setErrors({});
          }
          setOpen(true);
        }}
      >
        Export <Icon name="download" size={16} />
      </button>
      <dialog
        {...stylex.props(exportMenuStyles.dialog, open && exportMenuStyles.openDialog)}
        ref={dialogRef}
        id={dialogId}
        aria-labelledby={`${id}-export-title`}
        onCancel={(event) => { event.preventDefault(); cancel(); }}
        onClose={() => {
          setOpen(false);
          backdropPressRef.current = false;
          triggerRef.current?.focus({ preventScroll: true });
        }}
        onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          backdropPressRef.current = event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
        }}
        onClick={(event) => {
          if (!backdropPressRef.current || event.target !== event.currentTarget) return;
          backdropPressRef.current = false;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) cancel();
        }}
      >
        <header {...stylex.props(exportMenuStyles.header)}>
          <h2 {...stylex.props(exportMenuStyles.title)} ref={titleRef} id={`${id}-export-title`} tabIndex={-1}>Export</h2>
        </header>
        <div {...stylex.props(exportMenuStyles.body)}>
          <form
            id={formId}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              const nextErrors: FieldErrors = {};
              const seconds = Number(duration);
              const framesPerSecond = Number(fps);
              const percentage = Number(quality);
              if (!support?.supported) nextErrors.format = support?.reason ?? "Format is unavailable.";
              if (video) {
                if (duration.trim() === "" || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60) nextErrors.duration = "Enter a duration greater than 0 and no more than 60 seconds.";
                if (!validFps) nextErrors.fps = "Choose a whole FPS value from 1 to 60.";
                if (!nextErrors.duration && !nextErrors.fps) {
                  try { videoFrameCount(seconds, framesPerSecond); }
                  catch (caught) { nextErrors.duration = caught instanceof Error ? caught.message : "Choose a whole number of frames, up to 1,800."; }
                }
              }
              if (adjustableQuality && (quality.trim() === "" || !Number.isInteger(percentage) || percentage < 0 || percentage > 100)) nextErrors.quality = "Choose a whole quality percentage from 0 to 100.";
              if (opaque && !/^#[0-9a-f]{6}$/i.test(background)) nextErrors.background = "Choose an opaque six-digit hex background color.";
              setErrors(nextErrors);
              const firstError = (["format", "duration", "fps", "quality", "background"] as const).find((field) => nextErrors[field]);
              if (firstError) {
                requestAnimationFrame(() => {
                  if (!dialogRef.current?.open) return;
                  if (firstError === "format") formatLegendRef.current?.focus();
                  else document.getElementById(`${id}-export-${firstError}`)?.focus();
                });
                return;
              }
              const request: ExportRequest = { format };
              if (video) { request.duration = seconds; request.fps = framesPerSecond; }
              if (adjustableQuality) request.quality = percentage / 100;
              if (opaque) request.background = background;
              onExport(request);
            }}
          >
            <fieldset {...stylex.props(exportMenuStyles.fieldset)} disabled={busy} aria-describedby={errors.format ? `${id}-format-error` : undefined}>
              <legend {...stylex.props(exportMenuStyles.legend)} ref={formatLegendRef} tabIndex={-1}>Format</legend>
              <div {...stylex.props(exportMenuStyles.formatGrid)}>
                {formatChoices.map((option) => {
                  const { unavailable, reason } = option;
                  const optionId = `${id}-format-${option.value}`;
                  return (
                    <label {...stylex.props(exportMenuStyles.formatChoice, format === option.value && exportMenuStyles.selectedChoice, (unavailable || busy) && exportMenuStyles.unavailableChoice, option.value === "json" && exportMenuStyles.projectChoice)} key={option.value}>
                      <input
                        {...stylex.props(exportMenuStyles.radio)}
                        type="radio"
                        name={`${id}-export-format`}
                        value={option.value}
                        checked={format === option.value}
                        disabled={unavailable}
                        autoComplete="off"
                        aria-labelledby={`${optionId}-label`}
                        aria-describedby={reason ? `${id}-capability-${capabilityNotes.indexOf(reason)}` : undefined}
                        onChange={() => { setFormat(option.value); setErrors({}); }}
                      />
                      <span {...stylex.props(exportMenuStyles.choiceCopy)}>
                        <strong {...stylex.props(exportMenuStyles.formatName)} id={`${optionId}-label`} translate="no">{option.label}</strong>
                      </span>
                    </label>
                  );
                })}
              </div>
              {capabilityNotes.map((note, index) => <p {...stylex.props(exportMenuStyles.reason, exportMenuStyles.help)} id={`${id}-capability-${index}`} key={note} aria-live="polite">{note}</p>)}
              {errors.format && <p {...stylex.props(exportMenuStyles.error)} id={`${id}-format-error`} aria-live="polite">{errors.format}</p>}
            </fieldset>
            {(video || adjustableQuality || opaque) && <fieldset {...stylex.props(exportMenuStyles.fieldset, exportMenuStyles.settings)} disabled={busy}>
              <legend {...stylex.props(exportMenuStyles.legend)}>Settings</legend>
              <div {...stylex.props(exportMenuStyles.settingsGrid)}>
                {video && <>
                  <div {...stylex.props(exportMenuStyles.field)}>
                    <label htmlFor={`${id}-export-duration`}>Duration</label>
                    <div {...stylex.props(exportMenuStyles.numberField)}>
                      <input {...stylex.props(exportMenuStyles.numberInput)} id={`${id}-export-duration`} name="export-duration" type="number" inputMode="decimal" autoComplete="off" required min={validFps ? 1 / numericFps : 1 / 60} max={validFps ? Math.min(60, 1800 / numericFps) : 60} step="any" value={duration} aria-invalid={Boolean(errors.duration) || undefined} aria-describedby={errors.duration ? `${id}-duration-error` : showFrameCount ? `${id}-frame-count` : undefined} onChange={(event) => { setDuration(event.currentTarget.value); setErrors({}); }} />
                      <span {...stylex.props(exportMenuStyles.unit)}>s</span>
                    </div>
                    {errors.duration && <p {...stylex.props(exportMenuStyles.error)} id={`${id}-duration-error`} aria-live="polite">{errors.duration}</p>}
                  </div>
                  <div {...stylex.props(exportMenuStyles.field)}>
                    <label htmlFor={`${id}-export-fps`}>FPS</label>
                    <div {...stylex.props(exportMenuStyles.numberField)}>
                      <input {...stylex.props(exportMenuStyles.numberInput)} id={`${id}-export-fps`} name="export-fps" type="number" inputMode="numeric" autoComplete="off" required min={1} max={60} step={1} value={fps} aria-invalid={Boolean(errors.fps) || undefined} aria-describedby={errors.fps ? `${id}-fps-error` : showFrameCount ? `${id}-frame-count` : undefined} onChange={(event) => { setFps(event.currentTarget.value); setErrors({}); }} />
                    </div>
                    {errors.fps && <p {...stylex.props(exportMenuStyles.error)} id={`${id}-fps-error`} aria-live="polite">{errors.fps}</p>}
                  </div>
                </>}
                {adjustableQuality && <div {...stylex.props(exportMenuStyles.field)}>
                  <label htmlFor={`${id}-export-quality`}>Quality</label>
                  <div {...stylex.props(exportMenuStyles.numberField)}>
                    <input {...stylex.props(exportMenuStyles.numberInput)} id={`${id}-export-quality`} name="export-quality" type="number" inputMode="numeric" autoComplete="off" required min={0} max={100} step={1} value={quality} aria-invalid={Boolean(errors.quality) || undefined} aria-describedby={errors.quality ? `${id}-quality-error` : undefined} onChange={(event) => { setQuality(event.currentTarget.value); setErrors({}); }} />
                    <span {...stylex.props(exportMenuStyles.unit)}>%</span>
                  </div>
                  {errors.quality && <p {...stylex.props(exportMenuStyles.error)} id={`${id}-quality-error`} aria-live="polite">{errors.quality}</p>}
                </div>}
                {opaque && <div {...stylex.props(exportMenuStyles.field)}>
                  <label htmlFor={`${id}-export-background`}>Transparency Background</label>
                  <div {...stylex.props(exportMenuStyles.colorField)}>
                    <input {...stylex.props(exportMenuStyles.colorInput)} id={`${id}-export-background`} name="export-background" type="color" autoComplete="off" value={background} aria-invalid={Boolean(errors.background) || undefined} aria-describedby={errors.background ? `${id}-background-error` : undefined} onChange={(event) => { setBackground(event.currentTarget.value); setErrors({}); }} />
                    <output {...stylex.props(exportMenuStyles.colorValue)} htmlFor={`${id}-export-background`}>{background.toLowerCase()}</output>
                  </div>
                  {errors.background && <p {...stylex.props(exportMenuStyles.error)} id={`${id}-background-error`} aria-live="polite">{errors.background}</p>}
                </div>}
              </div>
              {showFrameCount && <p {...stylex.props(exportMenuStyles.help)} id={`${id}-frame-count`}>{new Intl.NumberFormat().format(Math.round(frameCount))} frames</p>}
            </fieldset>}
          </form>
          {error && <p {...stylex.props(exportMenuStyles.error, exportMenuStyles.exportError)} role="status" aria-live="polite">{error}</p>}
        </div>
        <footer {...stylex.props(exportMenuStyles.footer)}>
          {busy && <div {...stylex.props(exportMenuStyles.progressGroup)}>
            <p {...stylex.props(exportMenuStyles.copy)} role="status" aria-live="polite" aria-atomic="true">{percent === undefined ? "Exporting…" : `Exporting… ${percent}%`}</p>
            <progress {...stylex.props(exportMenuStyles.progress)} aria-label="Export progress" max={1} value={progressValue} />
          </div>}
          <div {...stylex.props(exportMenuStyles.actions)}>
            <button {...stylex.props(exportMenuStyles.secondaryButton)} ref={cancelRef} type="button" onClick={cancel}>Cancel</button>
            <button {...stylex.props(exportMenuStyles.primaryButton)} type="submit" form={formId} disabled={busy || !support?.supported}>{busy ? "Exporting…" : `Export ${selectedFormat.label}`}</button>
          </div>
        </footer>
      </dialog>
    </>
  );
}
