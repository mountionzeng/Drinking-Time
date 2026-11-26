import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  start: vi.fn(),
  takes: vi.fn(),
  story: vi.fn(), images: vi.fn(),
}));
vi.mock("../repositories/stories", async original => ({...await original<typeof import("../repositories/stories")>(),getStoryById:mocks.story}));
vi.mock("../repositories/images", async original => ({...await original<typeof import("../repositories/images")>(),getStoryGeneratedImages:mocks.images}));
vi.mock("../services/bookMediaTarget", () => ({
  bookMediaTargetIsCurrent: mocks.current,
}));
vi.mock("../services/videoJobs", () => ({ startShotVideoJob: mocks.start }));
vi.mock("../repositories/videos", () => ({ getStoryVideoTakes: mocks.takes }));
vi.mock("../services/videoGen", () => ({
  getShotVideoProviderStatus: () => ({ motion: "low" }),
}));
import { bookMediaRouter } from "./bookMedia";
import { estimateShotVideoCost } from "../../shared/shotDirector";
const caller = bookMediaRouter.createCaller({
  user: { id: 7 },
  req: {},
  res: {},
} as TrpcContext);
const input = {
  storyId: 1,
  chapterId: 2,
  moduleId: "image-block",
  imageId: 3,
  prompt: "水面轻轻流动",
  operationToken: "request-123",
  estimatedCny: estimateShotVideoCost({ durationSec: 5, motion: "low" })
    .estimatedCny,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current.mockResolvedValue(true);
  mocks.start.mockResolvedValue({ status: "ok" });
});
it("reads historical feedback only from the owner's story and exact saved user instructions",async()=>{
  mocks.story.mockResolvedValue(null);
  await expect(caller.feedbackHistory({storyId:1})).rejects.toThrow();
  expect(mocks.images).not.toHaveBeenCalled();
  mocks.story.mockResolvedValue({id:1});
  const content="裁掉左边",prompt="Compose one new image from the supplied reference images.\n图1 is the base: its aspect ratio and overall composition carry over unless the user asks otherwise.\nTake from each reference only what the user names below; do not borrow anything else from them.\n\n"+content+"\nCharacter continuity across all generated shots:\n【用户持续要求】"+content+"。这些要求必须完整落实。";
  const image={id:8,createdAt:new Date(1234),userId:7,shotNo:null,generationType:"inpaint",prompt};
  mocks.images.mockResolvedValue([image,{...image,userId:9},{...image,prompt:"普通图片"}]);
  expect(await caller.feedbackHistory({storyId:1})).toEqual({storyId:1,accountId:7,messages:[{id:"book-image-history:8",role:"user",timestamp:1234,content}]});
  expect(mocks.images).toHaveBeenCalledWith(1,7);
});
describe("book media video boundary", () => {
  it("rejects a replaced or foreign module before paid submission", async () => {
    mocks.current.mockResolvedValue(false);
    await expect(caller.video(input)).rejects.toThrow("图片已变化");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("rejects a stale quote before paid submission", async () => {
    await expect(
      caller.video({ ...input, estimatedCny: input.estimatedCny + 1 })
    ).rejects.toThrow("费用已变化");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("preserves request identity for retries and binds to this book module", async () => {
    await caller.video(input);
    await caller.video(input);
    const [job, userId] = mocks.start.mock.calls[0];
    expect(userId).toBe(7);
    expect(job).toMatchObject({
      bookTarget: { chapterId: 2, moduleId: "image-block" },
      imageId: 3,
      prompt: input.prompt,
      rerenderRequestId: input.operationToken,
    });
    expect(job.stableShotId).toMatch(/^book:2:/);
    expect(mocks.start.mock.calls[1][0]).toEqual(job);
    await caller.video({ ...input, moduleId: "other-block" });
    expect(mocks.start.mock.calls[2][0].stableShotId).not.toBe(
      job.stableShotId
    );
  });
});
