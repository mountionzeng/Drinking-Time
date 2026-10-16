import React, { useState } from "react";
import type { LayoutMemoryContext } from "@shared/layoutOperationMemory";
import { clearLayoutMemory } from "./layoutOperationMemory";

export function LayoutMemoryDetails({
  memory,
  accountId,
  onClear,
}: {
  memory: LayoutMemoryContext;
  accountId: number | null;
  onClear?(): void;
}) {
  const [error, setError] = useState("");
  return (
    <details className="min-w-0 text-[11px] text-muted-foreground">
      <summary className="cursor-pointer py-1">
        已记住 {memory.total} 次排版调整 · 本机
      </summary>
      <ol className="max-h-32 space-y-1 overflow-y-auto py-1">
        {memory.recent.slice(-6).map((event, index) => (
          <li key={`${event.at}:${index}`}>
            {event.undone ? "已撤销 · " : ""}
            {event.sameSource ? "" : "其他版本 · "}
            {event.summary}
          </li>
        ))}
      </ol>
      {accountId != null && (
        <button
          type="button"
          className="min-h-9 underline underline-offset-2"
          onClick={() => {
            try {
              clearLayoutMemory(accountId, memory.storyId);
              setError("");
              onClear?.();
            } catch {
              setError("暂时无法清除记录，请稍后再试。");
            }
          }}
        >
          清除这个故事的操作记录
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
