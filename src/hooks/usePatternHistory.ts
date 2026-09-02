import { useCallback, useMemo, useState } from "react";
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

function copyParams(params: PatternParams): PatternParams {
  return { ...params, colors: [...params.colors] };
}

function copyScene(scene: SceneState): SceneState {
  return { params: copyParams(scene.params), source: scene.source };
}

export function usePatternHistory(initialSource: SourceData) {
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [],
    present: { params: copyParams(DEFAULT_PARAMS), source: initialSource },
    future: [],
  }));

  const commitScene = useCallback((next: SceneState | ((scene: SceneState) => SceneState)) => {
    setHistory((current) => {
      const value = typeof next === "function" ? next(current.present) : next;
      const sameSource = value.source === current.present.source || (value.source.fingerprint === current.present.source.fingerprint && value.source.name === current.present.source.name);
      if (sameSource && JSON.stringify(value.params) === JSON.stringify(current.present.params)) {
        return current;
      }
      return {
        past: [...current.past.slice(-39), current.present],
        present: copyScene(value),
        future: [],
      };
    });
  }, []);

  const commit = useCallback((next: PatternParams | ((params: PatternParams) => PatternParams)) => {
    commitScene((scene) => ({
      ...scene,
      params: typeof next === "function" ? next(scene.params) : next,
    }));
  }, [commitScene]);

  return useMemo(() => ({
    params: history.present.params,
    source: history.present.source,
    commit,
    commitScene,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo() {
      setHistory((current) => {
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
      setHistory((current) => {
        const next = current.future[0];
        if (!next) return current;
        return {
          past: [...current.past, current.present],
          present: copyScene(next),
          future: current.future.slice(1),
        };
      });
    },
    reset(source: SourceData) {
      commitScene({ params: copyParams(DEFAULT_PARAMS), source });
    },
  }), [commit, commitScene, history]);
}
