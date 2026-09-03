import { useCallback, useMemo, useRef, useState } from "react";
import { DEFAULT_PARAMS } from "../model/params";
import type { PatternParams, SourceData } from "../model/types";

interface SceneState {
  params: PatternParams;
  source: SourceData;
}

interface HistoryState {
  past: SceneState[];
  present: SceneState;
  future: SceneState[];
}

const HISTORY_LIMIT = 40;
const HISTORY_SOURCE_BUDGET = 96 * 1024 * 1024;

function appendHistory(past: SceneState[], scene: SceneState): SceneState[] {
  const candidates = [...past, scene].slice(-HISTORY_LIMIT);
  const sources = new Set<SourceData>();
  const kept: SceneState[] = [];
  let sourceBytes = 0;
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index]!;
    const isNewSource = !sources.has(candidate.source);
    const nextBytes = isNewSource
      ? candidate.source.pixels.byteLength + (candidate.source.dataUrl?.length ?? 0) * 2
      : 0;
    if (kept.length > 0 && sourceBytes + nextBytes > HISTORY_SOURCE_BUDGET) break;
    if (isNewSource) {
      sources.add(candidate.source);
      sourceBytes += nextBytes;
    }
    kept.push(candidate);
  }
  return kept.reverse();
}

function copyParams(params: PatternParams): PatternParams {
  return { ...params, colors: [...params.colors] };
}

function copyScene(scene: SceneState): SceneState {
  return { params: copyParams(scene.params), source: scene.source };
}

function sourcesEqual(first: SourceData, second: SourceData): boolean {
  return first === second || (
    first.fingerprint === second.fingerprint
    && first.name === second.name
    && first.width === second.width
    && first.height === second.height
    && first.usesAlpha === second.usesAlpha
    && first.kind === second.kind
    && Boolean(first.dataUrl) === Boolean(second.dataUrl)
  );
}

function rebaseTransaction(start: SceneState, before: SceneState, after: SceneState): SceneState {
  const params = copyParams(start.params);
  for (const key of Object.keys(after.params) as (keyof PatternParams)[]) {
    const oldValue = before.params[key];
    const newValue = after.params[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      (params as unknown as Record<string, unknown>)[key] = Array.isArray(newValue) ? [...newValue] : newValue;
    }
  }
  return { params, source: after.source };
}

export function usePatternHistory(initialSource: SourceData, initialParams: PatternParams = DEFAULT_PARAMS) {
  const [history, setHistoryState] = useState<HistoryState>(() => ({
    past: [],
    present: { params: copyParams(initialParams), source: initialSource },
    future: [],
  }));
  const historyRef = useRef(history);
  historyRef.current = history;
  const updateHistory = useCallback((updater: (current: HistoryState) => HistoryState) => {
    const current = historyRef.current;
    const next = updater(current);
    if (next === current) return;
    historyRef.current = next;
    setHistoryState(next);
  }, []);
  const transactionStartRef = useRef<SceneState | undefined>(undefined);

  const commitScene = useCallback((next: SceneState | ((scene: SceneState) => SceneState), rebaseActiveTransaction = false) => {
    updateHistory((current) => {
      const value = typeof next === "function" ? next(current.present) : next;
      const sameSource = sourcesEqual(value.source, current.present.source);
      if (sameSource && JSON.stringify(value.params) === JSON.stringify(current.present.params)) {
        return current;
      }
      if (transactionStartRef.current) {
        if (rebaseActiveTransaction) {
          const start = transactionStartRef.current;
          transactionStartRef.current = rebaseTransaction(start, current.present, value);
          return {
            past: appendHistory(current.past, start),
            present: copyScene(value),
            future: [],
          };
        }
        return { ...current, present: copyScene(value), future: [] };
      }
      return {
        past: appendHistory(current.past, current.present),
        present: copyScene(value),
        future: [],
      };
    });
  }, [updateHistory]);

  const commit = useCallback((next: PatternParams | ((params: PatternParams) => PatternParams)) => {
    commitScene((scene) => ({
      ...scene,
      params: typeof next === "function" ? next(scene.params) : next,
    }));
  }, [commitScene]);

  const beginTransaction = useCallback(() => {
    if (!transactionStartRef.current) transactionStartRef.current = copyScene(historyRef.current.present);
  }, []);

  const endTransaction = useCallback(() => {
    const start = transactionStartRef.current;
    transactionStartRef.current = undefined;
    if (!start) return;
    updateHistory((current) => {
      const sameSource = sourcesEqual(start.source, current.present.source);
      if (sameSource && JSON.stringify(start.params) === JSON.stringify(current.present.params)) return current;
      return {
        past: appendHistory(current.past, start),
        present: current.present,
        future: [],
      };
    });
  }, [updateHistory]);

  return useMemo(() => ({
    params: history.present.params,
    source: history.present.source,
    commit,
    commitScene,
    beginTransaction,
    endTransaction,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo() {
      transactionStartRef.current = undefined;
      updateHistory((current) => {
        const previous = current.past.at(-1);
        if (!previous) return current;
        return {
          past: current.past.slice(0, -1),
          present: copyScene(previous),
          future: [current.present, ...current.future],
        };
      });
    },
    redo() {
      transactionStartRef.current = undefined;
      updateHistory((current) => {
        const next = current.future[0];
        if (!next) return current;
        return {
          past: appendHistory(current.past, current.present),
          present: copyScene(next),
          future: current.future.slice(1),
        };
      });
    },
    reset(source: SourceData) {
      transactionStartRef.current = undefined;
      commitScene({ params: copyParams(DEFAULT_PARAMS), source });
    },
  }), [beginTransaction, commit, commitScene, endTransaction, history]);
}
