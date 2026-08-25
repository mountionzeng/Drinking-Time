import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function context(): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 9911,
      openId: "visual-object-schema",
      email: "visual-object-schema@example.com",
      name: "Visual object schema",
      loginMethod: "test",
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("creationAgent.pasteVisualImage input", () => {
  it.each([
    { cropX: -1 },
    { cropY: 2 },
    { cropWidth: 0 },
    { cropHeight: 2 },
    { zoom: -1 },
    { panX: 2 },
    { panY: -2 },
    { rotationDeg: 181 },
  ])("rejects an out-of-range transform: %j", async override => {
    const transform = {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1,
      zoom: 1,
      panX: 0,
      panY: 0,
      ...override,
    };
    await expect(
      appRouter.createCaller(context()).creationAgent.pasteVisualImage({
        storyId: 1,
        operation: { editorSessionEpoch: "epoch", operationId: "operation" },
        pasteId: "paste",
        targetFrame: 0,
        targetLayer: 0,
        snapshot: {
          version: 1,
          kind: "image-clip",
          sourceStoryId: 1,
          sourceClipId: "source",
          sourceLayer: 0,
          imageId: 1,
          label: "image",
          durationFrames: 1,
          transform,
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
