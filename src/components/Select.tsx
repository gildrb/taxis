import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { selectStyles } from "../styles/Select.stylex";

interface SelectOption<Value> {
  value: Value;
  label: string;
  disabled?: boolean;
}

interface SelectProps<Value extends string | number> {
  id: string;
  label: string;
  value: Value;
  options: readonly SelectOption<Value>[];
  onChange: (value: Value) => void;
  describedBy?: string;
  disabled?: boolean;
  stacked?: boolean;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export function Select<const Value extends string | number>({ id, label, value, options, onChange, describedBy, disabled = false, stacked = false }: SelectProps<Value>) {
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<Value>();
  const [position, setPosition] = useState<MenuPosition>();
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const searchRef = useRef({ text: "", time: 0 });
  const enabledIndices = options.flatMap((option, index) => option.disabled ? [] : [index]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const requestedIndex = options.findIndex((option) => option.value === activeValue && !option.disabled);
  const activeIndex = requestedIndex >= 0 ? requestedIndex : enabledIndices.includes(selectedIndex) ? selectedIndex : enabledIndices[0] ?? -1;
  const unavailable = disabled || enabledIndices.length === 0;
  const labelId = `${id}-label`;
  const menuId = `${id}-options`;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setActiveValue(undefined);
    setPosition(undefined);
    searchRef.current = { text: "", time: 0 };
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    if (unavailable) {
      close(false);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewLeft = viewport?.offsetLeft ?? 0;
      const viewTop = viewport?.offsetTop ?? 0;
      const viewWidth = viewport?.width ?? document.documentElement.clientWidth;
      const viewHeight = viewport?.height ?? document.documentElement.clientHeight;
      let clipLeft = viewLeft;
      let clipTop = viewTop;
      let clipRight = viewLeft + viewWidth;
      let clipBottom = viewTop + viewHeight;
      for (let parent = trigger.parentElement; parent; parent = parent.parentElement) {
        const styles = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(styles.overflowX)) {
          clipLeft = Math.max(clipLeft, bounds.left);
          clipRight = Math.min(clipRight, bounds.right);
        }
        if (/(auto|scroll|hidden|clip)/.test(styles.overflowY)) {
          clipTop = Math.max(clipTop, bounds.top);
          clipBottom = Math.min(clipBottom, bounds.bottom);
        }
      }
      if (rect.width === 0 || rect.height === 0 || rect.bottom <= clipTop || rect.top >= clipBottom || rect.right <= clipLeft || rect.left >= clipRight) {
        close(false);
        return;
      }
      const margin = 8;
      const gap = 5;
      const width = Math.min(Math.max(rect.width, 160), viewWidth - margin * 2);
      const below = Math.max(0, viewTop + viewHeight - margin - rect.bottom - gap);
      const above = Math.max(0, rect.top - viewTop - margin - gap);
      const desiredHeight = Math.min(menu.scrollHeight + 2, 320);
      const placeBelow = below >= Math.min(desiredHeight, 200) || below >= above;
      const maxHeight = Math.min(320, Math.max(32, placeBelow ? below : above), viewHeight - margin * 2);
      const height = Math.min(menu.scrollHeight + 2, maxHeight);
      const left = Math.max(viewLeft + margin, Math.min(rect.right - width, viewLeft + viewWidth - margin - width));
      const top = Math.max(viewTop + margin, Math.min(placeBelow ? rect.bottom + gap : rect.top - gap - height, viewTop + viewHeight - margin - height));
      setPosition((current) => current?.left === left && current.top === top && current.width === width && current.maxHeight === maxHeight
        ? current
        : { top, left, width, maxHeight });
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      place();
    };
    place();
    const observer = new ResizeObserver(place);
    if (triggerRef.current) observer.observe(triggerRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [close, open, options.length, unavailable]);

  useLayoutEffect(() => {
    if (open && activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex, open, position?.maxHeight]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target;
      if (event.type === "blur" || target instanceof Node && !fieldRef.current?.contains(target) && !menuRef.current?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    window.addEventListener("blur", outside);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      window.removeEventListener("blur", outside);
    };
  }, [close, open]);

  const choose = (index: number, restoreFocus = true) => {
    const option = options[index];
    if (option && !option.disabled && option.value !== value) onChange(option.value);
    close(restoreFocus);
  };

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (unavailable) return;
    const now = performance.now();
    if (now - searchRef.current.time > 700) searchRef.current.text = "";
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
      return;
    }
    if (event.key === "Tab") {
      if (open) choose(activeIndex, false);
      return;
    }
    if (event.key === "Enter" || event.key === " " && searchRef.current.text === "") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else {
        setActiveValue(options[enabledIndices.includes(selectedIndex) ? selectedIndex : enabledIndices[0]!]!.value);
        setOpen(true);
      }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      searchRef.current = { text: "", time: 0 };
      if (event.altKey && event.key === "ArrowUp" && open) {
        choose(activeIndex);
        return;
      }
      let next = activeIndex;
      if (event.key === "Home") next = enabledIndices[0]!;
      else if (event.key === "End") next = enabledIndices.at(-1)!;
      else if (open) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        next = enabledIndices[(enabledIndices.indexOf(activeIndex) + step + enabledIndices.length) % enabledIndices.length]!;
      }
      setActiveValue(options[next]!.value);
      setOpen(true);
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const text = `${now - searchRef.current.time > 700 ? "" : searchRef.current.text}${event.key}`.toLocaleLowerCase();
    searchRef.current = { text, time: now };
    const query = [...text].every((character) => character === text[0]) ? text[0]! : text;
    const start = query.length === 1 ? activeIndex + 1 : activeIndex;
    for (let offset = 0; offset < options.length; offset++) {
      const index = (Math.max(0, start) + offset) % options.length;
      const option = options[index]!;
      if (!option.disabled && option.label.toLocaleLowerCase().startsWith(query)) {
        setActiveValue(option.value);
        break;
      }
    }
    setOpen(true);
  };

  return (
    <div {...stylex.props(selectStyles.field, stacked && selectStyles.stackedField)} ref={fieldRef}>
      <label {...stylex.props(selectStyles.label)} htmlFor={id} id={labelId}>{label}</label>
      <button
        {...stylex.props(selectStyles.trigger, stacked && selectStyles.stackedTrigger)}
        ref={triggerRef}
        id={id}
        name={id}
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        disabled={unavailable}
        onClick={() => {
          if (open) close(true);
          else {
            searchRef.current = { text: "", time: 0 };
            setActiveValue(options[enabledIndices.includes(selectedIndex) ? selectedIndex : enabledIndices[0]!]!.value);
            setOpen(true);
          }
        }}
        onKeyDown={keyDown}
      >
        <span {...stylex.props(selectStyles.value)}>{options[selectedIndex]?.label ?? String(value)}</span>
        <svg {...stylex.props(selectStyles.chevron)} aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {open && createPortal(
        <div
          {...stylex.props(selectStyles.menu)}
          ref={menuRef}
          id={menuId}
          role="listbox"
          aria-labelledby={labelId}
          style={{ top: position?.top ?? 0, left: position?.left ?? 0, width: position?.width ?? 160, maxHeight: position?.maxHeight ?? 320, visibility: position ? "visible" : "hidden" }}
        >
          {options.map((option, index) => (
            <div
              {...stylex.props(selectStyles.option, index === activeIndex && selectStyles.activeOption, option.disabled && selectStyles.disabledOption)}
              ref={(node) => { optionRefs.current[index] = node; }}
              id={`${id}-option-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={(event) => { if (!option.disabled && event.pointerType !== "touch") setActiveValue(option.value); }}
              onClick={() => { if (!option.disabled) choose(index); }}
            >
              <span {...stylex.props(selectStyles.check)} aria-hidden="true">{option.value === value && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m3 8 3 3 7-7" /></svg>}</span>
              <span {...stylex.props(selectStyles.value)}>{option.label}</span>
            </div>
          ))}
        </div>, document.body,
      )}
    </div>
  );
}
