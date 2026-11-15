import { afterEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/features/storyAgent/types";
import { warehouseConversationTarget, resolveWarehouseConversationGroup, useWarehouseConversationFocus, WAREHOUSE_CONVERSATION_FOCUS } from "./warehouseConversationFocus";
import type { WarehouseShotGroup } from "./warehouseShotMedia";

const effects = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => (() => void) | undefined) => { effects.cleanup = effect(); },
}));
afterEach(() => { effects.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const message = { id: "result", role: "assistant", content: "candidate", timestamp: 1,
  frameReview: { storyId: 7, stableShotId: "third", activeTarget: "forest", tasks: [
    { target: "cloud", candidate: { imageId: 2110 } }, { target: "forest", candidate: { imageId: 2111 } },
  ] } } as ChatMessage;
it("uses actual result IDs, giving the active result priority", () => {
  expect(warehouseConversationTarget(message, 7)).toEqual({ storyId: 7, messageId: "result", stableShotId: "third", mediaKeys: ["image:2111", "image:2110"] });
  expect(warehouseConversationTarget(message, 8).mediaKeys).toEqual([]);
});
it("does not mislabel prose, a user reference, or an unrendered scope as a generated output", () => {
  expect(warehouseConversationTarget({ ...message, role: "user" }, 7).mediaKeys).toEqual([]);
  expect(warehouseConversationTarget({ ...message, frameReview: undefined, content: "修改图片 #2111" }, 7).mediaKeys).toEqual([]);
  expect(warehouseConversationTarget({ ...message, frameReview: { ...message.frameReview!, tasks: [] } }, 7).mediaKeys).toEqual([]);
});
it("locates outputs only in their exact shot and supports saved image revisions", () => {
  const revision = { ...message, frameReview: undefined, imageRevision: { storyId: 7, stableShotId: "third", shotNo: 3, imageId: 2111, imageUrl: "/api/images/result.png" } };
  const target = warehouseConversationTarget(revision, 7);
  const wrong = { id: "other", items: [{ key: "image:2111" }] } as WarehouseShotGroup;
  const right = { ...wrong, id: "third" };
  expect(resolveWarehouseConversationGroup([wrong], target)).toBeUndefined();
  expect(resolveWarehouseConversationGroup([wrong, right], target)?.id).toBe("third");
  expect(resolveWarehouseConversationGroup([right], { ...target, mediaKeys: [] })).toBeUndefined();
});

it("follows deliberate history scrolling but ignores automatic scrolling and cleans up on unmount", () => {
  vi.useFakeTimers();
  const windowEvents = new EventTarget();
  vi.stubGlobal("window", windowEvents);
  const output = vi.fn();
  windowEvents.addEventListener(WAREHOUSE_CONVERSATION_FOCUS, output);
  const root = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ top: 0, bottom: 500, height: 500 }) });
  const node = { getBoundingClientRect: () => ({ top: 100, bottom: 400, height: 300 }) };
  useWarehouseConversationFocus({ storyId: 7, enabled: true, messages: [message],
    container: { current: root as unknown as HTMLDivElement }, nodes: { current: new Map([[message.id, node as HTMLDivElement]]) } });
  root.dispatchEvent(new Event("scroll"));
  vi.advanceTimersByTime(200);
  expect(output).not.toHaveBeenCalled();
  root.dispatchEvent(new Event("wheel"));
  root.dispatchEvent(new Event("scroll"));
  vi.advanceTimersByTime(200);
  expect(output).toHaveBeenCalledTimes(1);
  expect(output.mock.calls[0][0].detail.mediaKeys).toEqual(["image:2111", "image:2110"]);
  root.dispatchEvent(new Event("wheel"));
  vi.advanceTimersByTime(200);
  expect(output).toHaveBeenCalledTimes(1);
  effects.cleanup?.();
  root.dispatchEvent(new Event("wheel"));
  vi.advanceTimersByTime(200);
  expect(output).toHaveBeenCalledTimes(1);
});
