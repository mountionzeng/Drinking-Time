import type { ReactNode } from "react";
import type { ChatMessage } from "../types";

/** Each beat has an independent, persisted quote. Keep unopened forms out of the reading space. */
export function KeyframePlanDisclosure({message, children}: {message: ChatMessage; children: ReactNode}) {
  if (!message.id.startsWith("shot-keyframe:")) return <>{children}</>;
  return <details className="mt-1 text-xs"><summary className="cursor-pointer underline">核对这一帧并查看报价</summary>{children}</details>;
}
