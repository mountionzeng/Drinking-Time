import React, { useContext, useEffect } from "react";
import { DesktopWritingContext } from "@/features/writingCompanion/DesktopWritingContext";
import { MobileMemoryFollowup } from "@/features/mobileWorkspace/mobileMemoryFollowup";
import {
  layoutModuleLabel,
  type LayoutModuleContext,
} from "@shared/layoutModuleContext";
import type { LayoutMemoryContext } from "@shared/layoutOperationMemory";

type Props = {
  context: LayoutModuleContext | null;
  memory?: LayoutMemoryContext;
  mobile: boolean;
};
function MobileModuleContext({ context, memory }: Omit<Props, "mobile">) {
  const { selectModule } = useContext(MobileMemoryFollowup);
  useEffect(() => {
    const source = context ?? memory;
    if (!source) return;
    selectModule?.({
      storyId: source.storyId,
      id: `layout:${source.scope}`,
      kind: "layout",
      title: context ? layoutModuleLabel(context) : "当前排版",
      origin: "note",
      content:
        context?.kind === "text"
          ? (context.text ?? "")
          : context
            ? "选中的图片及它在当前页的排版"
            : "最近的排版操作",
      module: context ?? undefined,
      layoutMemory: memory,
    });
    return () => selectModule?.(null);
  }, [context, memory, selectModule]);
  return null;
}

export function ModuleCompanionContext({ context, memory, mobile }: Props) {
  const source = context ?? memory;
  if (!source) return null;
  return mobile ? (
    <MobileModuleContext context={context} memory={memory} />
  ) : (
    <DesktopWritingContext
      storyId={source.storyId}
      getSnapshot={() => ({
        scope: source.scope,
        draft: context?.pageText ?? "",
        cursor: 0,
        module: context ?? undefined,
        layoutMemory: memory,
      })}
    />
  );
}
