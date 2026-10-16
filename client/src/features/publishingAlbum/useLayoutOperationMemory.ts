import { useEffect, useMemo, useRef, useState } from "react";
import {
  LAYOUT_MEMORY_EVENT,
  layoutMemoryKey,
  readLayoutMemory,
  layoutMemoryContext,
  recordLayoutOperation,
  markLayoutOperation,
  type LayoutAction,
  type LayoutOperation,
} from "./layoutOperationMemory";
import type { ModuleDocument } from "./imagePackModules";

function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function useLayoutOperationMemory(
  accountId: number | null | undefined,
  storyId: number | undefined,
  scope: string
) {
  const key = accountId && storyId ? layoutMemoryKey(accountId, storyId) : null;
  const [state, setState] = useState(() => ({
    key,
    events: key ? readLayoutMemory(storage(), key) : [],
  }));
  const latest = useRef(state);
  latest.current = state;
  const [warning, setWarning] = useState("");
  useEffect(() => {
    const load = () => {
      const next = { key, events: key ? readLayoutMemory(storage(), key) : [] };
      latest.current = next;
      setState(next);
    };
    load();
    const changed = (event: Event) => {
      if (
        event instanceof StorageEvent
          ? event.key === key
          : (event as CustomEvent<string>).detail === key
      )
        load();
    };
    window.addEventListener("storage", changed);
    window.addEventListener(LAYOUT_MEMORY_EVENT, changed);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener(LAYOUT_MEMORY_EVENT, changed);
    };
  }, [key]);
  function update(change: (events: LayoutOperation[]) => LayoutOperation[]) {
    if (!key) return;
    const persisted = readLayoutMemory(storage(), key);
    const events =
      warning && latest.current.key === key ? latest.current.events : persisted;
    const next = change(events);
    if (next === events) return;
    latest.current = { key, events: next };
    setState(latest.current);
    try {
      const target = storage();
      if (!target) throw new Error("storage unavailable");
      target.setItem(key, JSON.stringify(next));
      setWarning("");
      window.dispatchEvent(
        new CustomEvent(LAYOUT_MEMORY_EVENT, { detail: key })
      );
    } catch {
      setWarning("操作记录暂时只能留在本次打开中，浏览器未能保存。");
    }
  }
  const context = useMemo(
    () =>
      storyId && state.key === key && state.events.length
        ? layoutMemoryContext(state.events, storyId, scope)
        : undefined,
    [state, key, storyId, scope]
  );
  return {
    context,
    warning,
    record: (
      before: ModuleDocument,
      after: ModuleDocument,
      action: LayoutAction
    ) =>
      update(events =>
        recordLayoutOperation(events, scope, before, after, action)
      ),
    travel: (before: ModuleDocument, after: ModuleDocument, undo: boolean) =>
      update(events => markLayoutOperation(events, scope, before, after, undo)),
  };
}
