import { useCallback, useMemo, useState } from "react";
import { DEFAULT_PARAMS } from "../model/params";
import type { OrbParams } from "../model/types";

interface HistoryState {
  past: OrbParams[];
  present: OrbParams;
  future: OrbParams[];
}

export function useOrbHistory() {
  const [history, setHistory] = useState<HistoryState>({ past: [], present: DEFAULT_PARAMS, future: [] });

  const commit = useCallback((next: OrbParams | ((params: OrbParams) => OrbParams)) => {
    setHistory((current) => {
      const value = typeof next === "function" ? next(current.present) : next;
      if (JSON.stringify(value) === JSON.stringify(current.present)) return current;
      return {
        past: [...current.past.slice(-79), current.present],
        present: value,
        future: [],
      };
    });
  }, []);

  return useMemo(
    () => ({
      params: history.present,
      commit,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      undo() {
        setHistory((current) => {
          const previous = current.past.at(-1);
          if (!previous) return current;
          return {
            past: current.past.slice(0, -1),
            present: previous,
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
            present: next,
            future: current.future.slice(1),
          };
        });
      },
      reset() {
        commit({ ...DEFAULT_PARAMS, palette: [...DEFAULT_PARAMS.palette] });
      },
    }),
    [commit, history],
  );
}
