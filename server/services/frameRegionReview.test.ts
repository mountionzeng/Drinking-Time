import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { runFrameRegionReview } from "./frameRegionReview";

const input = { storyId: 7, userId: 1, instruction: "第03镜抽5帧" };
let body: any, images: any[], imageBytes: Buffer, d: any;
beforeEach(async () => {
  body = { _revision: 1, otherSession: { keep: true } };
  imageBytes = await sharp({ create: { width: 12, height: 10, channels: 3, background: "#80bba1" } }).png().toBuffer();
  images = [1, 2, 3, 4, 5].map(id => ({ id, userId: 1, storyId: 7, shotIdentity: "third", imageUrl: `/api/images/${id}.png` }));
  const frames = images.map((image, i) => ({ storyId: 7, stableShotId: "third", shotNo: 3, imageId: image.id, imageUrl: image.imageUrl,
    takeId: 10, timelineVersion: 9, timelineFrame: i * 60, sourceTimeSec: i * 2, shotTimeSec: i * 2 }));
  d = {
    story: vi.fn(async () => ({ body: structuredClone(body) })), material: vi.fn(async () => ({ timeline: { version: 9 } })),
    images: vi.fn(async () => images), read: vi.fn(async () => imageBytes),
    update: vi.fn(async ({ expectedRevision, body: next }) => { if (body._revision !== expectedRevision) return false; body = structuredClone(next); return true; }),
    extract: vi.fn(async () => ({ frames, requestedCount: 5, failures: [] })),
    inspect: vi.fn(async (_frames, tasks) => tasks.map((task: any) => ({ target: task.target, imageId: task.imageId ?? (task.allowedImageIds?.includes(3) ? 3 : task.allowedImageIds?.[0] ?? 3), selectedPixels: 40, mask: imageBytes, protection: imageBytes, overlay: imageBytes }))),
    recolor: vi.fn(async () => ({ bytes: imageBytes, changedPixels: 30, outsideChangedPixels: 0 })),
    cloudQuote: vi.fn(async ({task})=>({requestId:'c7be11aa-8082-4bc6-9d79-1bb92118a715',sourceImageId:task.imageId,sourceImageUrl:`/api/images/${task.imageId}.png`,sourceSha:'sha',maskUrl:'/api/images/mask.png',maskSha:'sha',overlayUrl:'/api/images/overlay.png',prompt:'cloud edit',estimatedCny:.54,fingerprint:'a'.repeat(64),expiresAt:Date.now()+60000,width:12,height:10,growthPixels:1})),
    store: vi.fn(async (_bytes, _mime, options) => ({ status: "ok", imageKey: options.storageKey, imageUrl: `/api/images/${options.storageKey.split("/").at(-1)}` })),
    createImage: vi.fn(async image => { const row = { ...image, id: images.length + 1 }; images.push(row); return row; }),
  };
});
const next = (review: any, instruction: string) => ({ ...input, instruction, reviewId: review.id, expectedRevision: review.revision });
it('hands a rejected all-plane scope to edit clarification without repeating segmentation or purchasing', async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const located = (await runFrameRegionReview({ ...next(first, '定位飞机范围'), imageId: 3 }, d)).frameReview;
  const snapshot = structuredClone(body);
  d.inspect.mockClear(); d.update.mockClear();
  const instruction = '不是这个范围，你只需要去掉一个飞机和他的尾巴就好了';
  const result = await runFrameRegionReview({ ...next(located, instruction), imageId: 3 }, d);
  expect(result.reply).not.toContain('范围合适后');
  expect(result).toHaveProperty('imageEditPlan.changes', instruction);
  expect(result).toHaveProperty('imageEditPlan.images.0.imageId', 3);
  expect(d.inspect).not.toHaveBeenCalled();
  expect(d.recolor).not.toHaveBeenCalled();
  expect(d.cloudQuote).not.toHaveBeenCalled();
  expect(d.createImage).not.toHaveBeenCalled();
  expect(body).toEqual(snapshot);
});
it('blocks legacy approval of a category mask for removal and refuses another selected image', async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const located = (await runFrameRegionReview({ ...next(first, '定位飞机范围'), imageId: 3 }, d)).frameReview;
  const legacy = body.frameRegionReviews.find((row: { id: string }) => row.id === located.id);
  legacy.tasks[0].instruction = '我的意思是只留一个飞机就好了';
  d.inspect.mockClear();
  const result = await runFrameRegionReview({ ...next(legacy, '确认范围'), imageId: 3 }, d);
  expect(result).toHaveProperty('imageEditPlan.changes', legacy.tasks[0].instruction);
  expect(body.frameRegionReviews[0].tasks[0].approvedRevision).toBeUndefined();
  await expect(runFrameRegionReview({ ...next(legacy, '确认范围'), imageId: 2 }, d)).rejects.toThrow('变化');
  expect(d.inspect).not.toHaveBeenCalled(); expect(d.recolor).not.toHaveBeenCalled(); expect(d.cloudQuote).not.toHaveBeenCalled();
});
it('binds removal to the selected image, preserves other tasks, and rejects foreign images', async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const forest = (await runFrameRegionReview({ ...next(first, '森林改绿色'), imageId: 1 }, d)).frameReview;
  const snapshot = structuredClone(body);
  const result = await runFrameRegionReview({ ...next(forest, '删除右边的小飞机及其尾巴'), imageId: 5 }, d);
  expect(result).toHaveProperty('imageEditPlan.images.0.imageId', 5);
  expect(body).toEqual(snapshot);
  images.push({ id: 90, userId: 2, storyId: 8, shotIdentity: 'third' });
  await expect(runFrameRegionReview({ ...next(forest, '删除右边的小飞机'), imageId: 90 }, d)).rejects.toThrow('原图');
});
async function inheritanceOffer() {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const located = (await runFrameRegionReview({ ...next(first, "森林改绿色"), imageId: 1 }, d)).frameReview;
  const candidateReview = (await runFrameRegionReview(next(located, "确认森林范围"), d)).frameReview;
  const edited = (await runFrameRegionReview(next(candidateReview, "确认森林配色"), d)).frameReview;
  const candidate = edited.tasks[0].candidate!;
  const result = await runFrameRegionReview({ ...next(edited, "云层更大更厚"), imageId: 5 }, d);
  return { ...result, candidate };
}
describe("cloud appearance conversation", () => {
  it("records a request for more color adjustment and asks in chat without regenerating", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({ ...next(first, "森林绿色更协调统一，先显示范围"), imageId: 3 }, d)).frameReview;
    const edited = (await runFrameRegionReview(next(located, "确认森林范围"), d)).frameReview;
    const candidate = edited.tasks[0].candidate!;
    d.recolor.mockClear();
    const result = await runFrameRegionReview({ ...next(edited, "还要调整配色"), imageId: candidate.imageId }, d);
    expect(result.frameReview.forestPaletteFeedback?.at(-1)).toMatchObject({ imageId: candidate.imageId, decision: "rejected" });
    expect(result.reply).toContain("具体怎样调整");
    expect(result.frameReview.tasks[0].candidate).toEqual(candidate);
    expect(d.recolor).not.toHaveBeenCalled();
    expect(d.cloudQuote).not.toHaveBeenCalled();
  });
  it("starts a separate scope review after explicit cancellation, retaining the cancelled record", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({ ...next(first, "森林绿色更协调统一，先显示范围"), imageId: 3 }, d)).frameReview;
    const cancelled = (await runFrameRegionReview(next(located, "取消这次修改"), d)).frameReview;
    await expect(runFrameRegionReview({ ...next(cancelled, "确认森林范围"), imageId: 3 }, d)).rejects.toThrow();
    const restarted = (await runFrameRegionReview({ ...next(cancelled, "重新显示森林树冠范围，让绿色更协调统一"), imageId: 3 }, d)).frameReview;
    expect(restarted.id).not.toBe(cancelled.id);
    expect(restarted.phase).toBe("scope_review");
    expect(restarted.tasks).toHaveLength(1);
    expect(body.frameRegionReviews.find((row: any) => row.id === cancelled.id).phase).toBe("cancelled");
    expect(d.recolor).not.toHaveBeenCalled();
    expect(d.cloudQuote).not.toHaveBeenCalled();
  });
  it("uses complete canopy inspection for the actual coordinate-greens follow-up, without editing", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const result = await runFrameRegionReview({ ...next(first,
      "以原帧 #3 为底图，继续调整森林树冠的绿色，让绿色更协调统一、有层次；保留树干、原有明暗、灰度、点彩纹理和柔和边缘，阴影留少量蓝色。只改树冠。先只显示树冠范围，等我确认后再改图，其他对象保持原样。保护飞机、云、地面。"), imageId: 3 }, d);
    expect(result.frameReview.tasks).toHaveLength(1);
    expect(result.frameReview.tasks[0]).toMatchObject({ imageId: 3, forestTone: "harmonize_green_less_blue" });
    expect(d.inspect.mock.calls.at(-1)[1][0]).toMatchObject({ forestTone: "harmonize_green_less_blue", greenEdit: false });
    expect(d.recolor).not.toHaveBeenCalled();
    expect(d.cloudQuote).not.toHaveBeenCalled();
    expect(result.frameReview.phase).toBe("scope_review");
  });

  it('harmonizes forest greens only after scope confirmation and keeps sparse clouds separate', async () => {
    const first=(await runFrameRegionReview(input,d)).frameReview;
    const located=await runFrameRegionReview({...next(first,'森林绿色不统一，把树冠绿色统一到原画里协调的绿色，保留明暗层次；云还是太密集了，少一点，高光白色，阴影五颜六色'),imageId:3},d);
    expect(located.frameReview.tasks.find(t=>t.target==='forest')?.forestTone).toBe('harmonize_green');
    expect(located.frameReview.tasks.find(t=>t.target==='cloud')?.cloudArtDirection).toMatchObject({quantity:'fewer',highlights:'white',shadows:'colorful'});
    expect(d.recolor).not.toHaveBeenCalled();
    const result=await runFrameRegionReview(next(located.frameReview,'确认森林范围'),d);
    expect(d.recolor.mock.calls[0][5]).toBe('harmonize_green');
    expect(result.frameReview.tasks.find(t=>t.target==='forest')?.candidate).toBeDefined();
    expect(result.frameReview.forestPaletteFeedback).toBeUndefined();
    expect(d.cloudQuote).not.toHaveBeenCalled();
  });
  it("asks about the newly captured forest without a palette approval, generation or quote", async () => {
    const sourceFrame = (await d.extract()).frames[2];
    d.extract.mockClear();
    const result = await runFrameRegionReview({ ...input, instruction: "查看这一帧", stableShotId: "third", imageId: 3, sourceFrame, inspectOnly: true }, d);
    expect(result.reply).toContain("森林也要改吗");
    expect(result.reply).toContain("还需要改哪里");
    expect(result.frameReview.phase).toBe("frames_ready");
    expect(result.frameReview.tasks).toEqual([]);
    expect(d.extract).not.toHaveBeenCalled();
    expect(d.recolor).not.toHaveBeenCalled();
    expect(d.cloudQuote).not.toHaveBeenCalled();
    const combined = await runFrameRegionReview({ ...next(result.frameReview, "森林和云一起改，森林用原画里的绿色，阴影保留一点蓝色；云更大更厚，高光白色，阴影五颜六色，纹理少重复"), imageId: 3 }, d);
    expect(combined.frameReview.id).toBe(result.frameReview.id);
    expect(combined.frameReview.tasks.map(task => [task.target, task.imageId])).toEqual([["forest", 3], ["cloud", 3]]);
    expect(combined.frameReview.tasks[0].instruction).not.toContain("更大更厚");
    expect(combined.frameReview.tasks[1].cloudArtDirection).toMatchObject({ highlights: "white", shadows: "colorful", textureRepetition: "reduce" });
    expect(d.recolor).not.toHaveBeenCalled();
    expect(d.cloudQuote).not.toHaveBeenCalled();
  });
  it("does not claim trees were found when the local check finds no forest", async () => {
    const sourceFrame = (await d.extract()).frames[2];
    d.inspect.mockResolvedValue([{ target: "forest", imageId: 3, selectedPixels: 0 }]);
    const result = await runFrameRegionReview({ ...input, instruction: "查看这一帧", stableShotId: "third", imageId: 3, sourceFrame, inspectOnly: true }, d);
    expect(result.reply).toContain("想改哪里");
    expect(result.reply).not.toContain("森林也要改吗");
    expect(d.recolor).not.toHaveBeenCalled();
  });
  it("keeps a failed local check conversational without a paid fallback", async () => {
    const sourceFrame = (await d.extract()).frames[2];
    d.inspect.mockRejectedValue(new Error("Local vision unavailable"));
    const result = await runFrameRegionReview({ ...input, instruction: "查看这一帧", stableShotId: "third", imageId: 3, sourceFrame, inspectOnly: true }, d);
    expect(result.reply).toContain("暂时没有定位清楚");
    expect(result.frameReview.tasks).toEqual([]);
    expect(d.recolor).not.toHaveBeenCalled();
    expect(d.cloudQuote).not.toHaveBeenCalled();
  });
  it("requires a supplied frame for an automatic question", async () => {
    await expect(runFrameRegionReview({ ...input, inspectOnly: true }, d)).rejects.toThrow("请选择新抽取的帧");
    expect(d.inspect).not.toHaveBeenCalled();
    expect(d.extract).not.toHaveBeenCalled();
  });
  it("offers only an approved palette during the capture question without applying it", async () => {
    const { candidate } = await inheritanceOffer();
    const sourceFrame = (await d.extract()).frames[3];
    const count = d.recolor.mock.calls.length;
    const result = await runFrameRegionReview({ ...input, instruction: "查看这一帧", stableShotId: "third", imageId: 4, sourceFrame, inspectOnly: true }, d);
    expect(result.reply).toContain(`#${candidate.imageId} 已认可`);
    expect(result.frameReview.phase).toBe("scope_review");
    expect(result.frameReview.tasks[0].inheritance?.status).toBe("pending");
    expect(d.recolor).toHaveBeenCalledTimes(count);
    expect(d.cloudQuote).not.toHaveBeenCalled();
  });
  it("requires appearance approval before offering a generated forest palette on another frame", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({...next(first,'森林改绿色'),imageId:1},d)).frameReview;
    const edited = (await runFrameRegionReview(next(located,'确认森林范围'),d)).frameReview;
    const offered = await runFrameRegionReview({...next(edited,'定位云层范围'),imageId:5},d);
    expect(offered.frameReview.tasks.some(task=>task.inheritance)).toBe(false);
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });
  it("records rejection, releases the reference and blocks approval and future inheritance without rendering", async () => {
    const offered = await inheritanceOffer();
    const accepted = await runFrameRegionReview({...next(offered.frameReview,'所有森林颜色保持一致'),imageId:5},d);
    const renders = d.recolor.mock.calls.length;
    const rejected = await runFrameRegionReview(next(accepted.frameReview,`图片 #${offered.candidate.imageId} 的森林配色我不满意`),d);
    expect(rejected.frameReview.fixedForestPalette).toBeNull();
    expect(rejected.frameReview.forestPaletteFeedback?.at(-1)).toMatchObject({imageId:offered.candidate.imageId,decision:'rejected'});
    const later=await runFrameRegionReview({...next(rejected.frameReview,'定位云层范围'),imageId:4},d);
    expect(later.frameReview.tasks.some(task=>task.inheritance)).toBe(false);
    expect(d.recolor).toHaveBeenCalledTimes(renders);
    expect(d.extract).toHaveBeenCalledTimes(1);
    const confirmation=await runFrameRegionReview(next(rejected.frameReview,'确认图片'),d).catch(error=>error);
    // The rejected snapshot is stale after moving on; it cannot approve anything.
    expect(confirmation).toBeInstanceOf(Error);
  });
  it("retains candidate history and refuses whole-set approval after appearance rejection", async () => {
    const first=(await runFrameRegionReview(input,d)).frameReview;
    const located=(await runFrameRegionReview({...next(first,'森林改绿色'),imageId:1},d)).frameReview;
    const edited=(await runFrameRegionReview(next(located,'确认森林范围'),d)).frameReview;
    const rejected=(await runFrameRegionReview(next(edited,'森林颜色不满意'),d)).frameReview;
    expect(rejected.tasks[0].candidate).toEqual(edited.tasks[0].candidate);
    expect((await runFrameRegionReview(next(rejected,'确认图片'),d)).reply).toContain('否定');
    expect(d.createImage).toHaveBeenCalledTimes(1);
  });
  it("validates explicit feedback image ownership and shot without silently using another image", async () => {
    const first=(await runFrameRegionReview(input,d)).frameReview;
    await expect(runFrameRegionReview(next(first,'#999 森林配色不满意'),d)).rejects.toThrow('原帧不属于');
    expect(d.recolor).not.toHaveBeenCalled();
  });
  it.each([false,true])("rejecting colors invalidates only unsubmitted cloud quotes (submitted=%s)", async submitted => {
    const first=(await runFrameRegionReview(input,d)).frameReview;
    const quoted=(await runFrameRegionReview({...next(first,'云更厚一点'),imageId:3},d)).frameReview;
    const requestId=quoted.tasks.find(t=>t.target==='cloud')!.shapeQuote!.requestId;
    if(submitted) body.storyboardImageTasks=[{requestId,shotIdentity:'third'}];
    const rejected=(await runFrameRegionReview({...next(quoted,'这张图的森林配色不满意'),imageId:3},d)).frameReview;
    expect(Boolean(rejected.tasks.find(t=>t.target==='cloud')!.shapeQuote)).toBe(submitted);
    expect(d.recolor).not.toHaveBeenCalled();
  });
  it("can approve a saved candidate after moving to another frame without losing its recipe", async () => {
    const first=(await runFrameRegionReview(input,d)).frameReview;
    const located=(await runFrameRegionReview({...next(first,'森林改绿色'),imageId:1},d)).frameReview;
    const edited=(await runFrameRegionReview(next(located,'确认森林范围'),d)).frameReview;
    const candidate=edited.tasks[0].candidate!.imageId;
    const moved=(await runFrameRegionReview({...next(edited,'森林改绿色'),imageId:2},d)).frameReview;
    const approved=(await runFrameRegionReview(next(moved,`确认森林配色 #${candidate}`),d)).frameReview;
    const offered=(await runFrameRegionReview({...next(approved,'定位云层范围'),imageId:5},d)).frameReview;
    expect(offered.tasks.find(t=>t.target==='forest')?.inheritance?.imageId).toBe(candidate);
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });
  it("locks one forest palette when accepting a pending offer and retains the accompanying cloud request", async () => {
    const offered=await inheritanceOffer();
    const accepted=await runFrameRegionReview({...next(offered.frameReview,'所有森林颜色保持一致，云的高光是白色，阴影可以五颜六色'),imageId:5},d);
    expect(accepted.frameReview.fixedForestPalette?.imageId).toBe(offered.candidate.imageId);
    expect(d.recolor).toHaveBeenCalledTimes(2);
    expect(accepted.frameReview.tasks.find(t=>t.target==='cloud')?.cloudArtDirection).toMatchObject({highlights:'white',shadows:'colorful'});
    const later=await runFrameRegionReview({...next(accepted.frameReview,'定位云层范围'),imageId:4},d);
    expect(later.frameReview.tasks.find(t=>t.target==='forest')?.inheritance?.imageId).toBe(offered.candidate.imageId);
    expect(d.recolor).toHaveBeenCalledTimes(2);
    const applied=accepted.frameReview.tasks.find(t=>t.target==='forest')!.candidate!.imageId;
    const revisited=await runFrameRegionReview({...next(later.frameReview,'定位云层范围'),imageId:applied},d);
    expect(revisited.frameReview.tasks.some(t=>t.inheritance?.status==='pending')).toBe(false);
    const released=await runFrameRegionReview(next(revisited.frameReview,'不再统一森林配色'),d);
    expect(released.frameReview.fixedForestPalette).toBeNull();
    expect(d.recolor).toHaveBeenCalledTimes(2);
  });
  it("does not use a consistency request to approve unseen forest regions", async () => {
    const first=(await runFrameRegionReview(input,d)).frameReview;
    const result=await runFrameRegionReview({...next(first,'所有森林颜色保持一致'),imageId:5},d);
    expect(result.frameReview.fixedForestPalette).toBeUndefined();
    expect(d.recolor).not.toHaveBeenCalled();
  });
  it("offers the latest forest tone treatment on a different frame, then applies it only after acceptance", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({ ...next(first, "树太绿了，降低绿感"), imageId: 1 }, d)).frameReview;
    const candidateReview = (await runFrameRegionReview(next(located, "确认森林范围"), d)).frameReview;
    const edited = (await runFrameRegionReview(next(candidateReview, "确认森林配色"), d)).frameReview;
    const offered = await runFrameRegionReview({ ...next(edited, "定位云层范围"), imageId: 5 }, d);
    expect(offered.frameReview.tasks.find(t=>t.target==='forest')?.inheritance).toMatchObject({status:'pending',forestTone:'reduce_green_flatness'});
    expect(offered.reply).toContain('森林处理');
    expect(offered.reply).toContain('降低过强绿感');
    expect(d.recolor).toHaveBeenCalledTimes(1);
    expect(d.inspect.mock.calls.at(-1)[1][0]).toMatchObject({target:'forest',greenEdit:false,forestTone:'reduce_green_flatness'});
    const accepted=await runFrameRegionReview(next(offered.frameReview,'沿用上一帧的森林处理'),d);
    expect(accepted.frameReview.tasks.find(t=>t.target==='forest')).toMatchObject({forestTone:'reduce_green_flatness',inheritance:{status:'accepted'}});
    expect(d.recolor).toHaveBeenCalledTimes(2);
    expect(d.recolor.mock.lastCall[5]).toBe('reduce_green_flatness');
    expect(d.recolor.mock.lastCall[4]).toMatchObject({ source: imageBytes, mask: imageBytes });
  });

  it("does not offer another treatment on an already treated frame's descendant", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({ ...next(first, '森林改绿色'), imageId: 1 }, d)).frameReview;
    const edited = (await runFrameRegionReview(next(located,'确认森林范围'),d)).frameReview;
    const candidate=edited.tasks[0].candidate!;
    // Another frame's newer recipe must not cause this treated lineage to be
    // offered an unrelated older treatment as a fallback.
    body.frameRegionReviews.push({ ...structuredClone(edited), id: 'c7be11aa-8082-4bc6-9d79-1bb92118a715', updatedAt: Date.now()+100,
      tasks: [{ ...edited.tasks[0], imageId: 2, candidate: { ...candidate, imageId: 100 } }] });
    images.push({ ...images[0], id: 100, parentImageId: 2 });
    images.push({...images[0],id:99,parentImageId:candidate.imageId});
    const result=await runFrameRegionReview({...next(edited,'定位云层范围'),imageId:99},d);
    expect(result.frameReview.tasks.some(t=>t.inheritance?.status==='pending')).toBe(false);
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });

  it("keeps less-green forest adjustment separate from cloud count and texture", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({ ...next(first, "树太绿了，没有层次，降低绿感。云再多一点，纹理不要那么重复。"), imageId: 3 }, d)).frameReview;
    expect(located.tasks.find(t => t.target === "forest")).toMatchObject({ forestTone: "reduce_green_flatness" });
    const forestRequest = d.inspect.mock.lastCall[1].find((t:any) => t.target === 'forest');
    expect(forestRequest.greenEdit).toBe(false);
    expect(forestRequest.forestTone).toBe('reduce_green_flatness');
    await runFrameRegionReview(next(located, "确认范围"), d);
    expect(d.recolor).toHaveBeenCalledWith(imageBytes, imageBytes, imageBytes, undefined, undefined, "reduce_green_flatness");
    expect(d.cloudQuote).toHaveBeenCalledWith(expect.objectContaining({instruction:expect.stringContaining('纹理不要那么重复')}));
  });
  it("prepares the saved cloud appearance quote after confirming a scope refinement", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({ ...next(first, "重新定位完整云层范围。云再多一点，纹理不要重复。"), imageId: 3 }, d)).frameReview;
    expect(d.cloudQuote).not.toHaveBeenCalled();
    const confirmed = await runFrameRegionReview(next(located, "确认范围"), d);
    expect(confirmed.frameReview.tasks.find(t => t.target === 'cloud')?.shapeQuote).toBeDefined();
    expect(d.cloudQuote).toHaveBeenCalledOnce();
  });

  it("invalidates an unsubmitted cloud quote when the same frame's forest edit changes", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const quoted = (await runFrameRegionReview({ ...next(first, "云更大一点，森林保持不变"), imageId: 3 }, d)).frameReview;
    expect(quoted.tasks.find(t => t.target === "cloud")?.shapeQuote).toBeDefined();
    const revised = (await runFrameRegionReview({ ...next(quoted, "森林也改成绿色"), imageId: 3 }, d)).frameReview;
    expect(revised.tasks.find(t => t.target === "cloud")?.shapeQuote).toBeUndefined();
    expect(revised.tasks.find(t => t.target === "cloud")?.maskSha).toBe(quoted.tasks.find(t => t.target === "cloud")?.maskSha);
  });

  it("allows an explicit forest inheritance request after previously preserving that forest", async () => {
    const offered = await inheritanceOffer();
    // The previous frame is a separate persisted review in the product.
    body.frameRegionReviews.push({ ...offered.frameReview, id: "c7be11aa-8082-4bc6-9d79-1bb92118a715", updatedAt: 1,
      tasks: [{ ...offered.frameReview.tasks.find(t => t.target === "forest"), imageId: 1, candidate: offered.candidate, inheritance: undefined }] });
    const refused = (await runFrameRegionReview(next(offered.frameReview, "不继承"), d)).frameReview;
    const requested = await runFrameRegionReview({ ...next(refused, "森林也调整为上一帧的绿色"), imageId: 5 }, d);
    expect(requested.frameReview.declinedInheritanceImageIds).not.toContain(5);
    expect(requested.frameReview.tasks.find(t => t.target === "forest")?.inheritance?.status).toBe("pending");
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });

  it("quotes the user's short follow-up without re-segmenting or generating an image", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({ ...next(first, "只定位云层范围"), imageId: 3 }, d)).frameReview;
    const calls = d.inspect.mock.calls.length;
    const quoted = await runFrameRegionReview(next(located, "更大一点，更厚一点，白一点，但是饱和度要高"), d);
    expect(d.inspect).toHaveBeenCalledTimes(calls);
    expect(d.cloudQuote).toHaveBeenCalledWith(expect.objectContaining({ instruction: expect.stringContaining("饱和度要高") }));
    expect(quoted.frameReview.tasks[0].shapeQuote?.sourceImageId).toBe(3);
    expect(quoted.reply).toContain("确认生成云层");
    expect(d.createImage).not.toHaveBeenCalled();
    expect(d.recolor).not.toHaveBeenCalled();
  });

  it("starts a new review for an explicitly selected image after a timeline change, but rejects old confirmations", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({ ...next(first, "定位云层范围"), imageId: 3 }, d)).frameReview;
    d.material.mockResolvedValue({ timeline: { version: 10 } });
    await expect(runFrameRegionReview({ ...next(located, "确认云层范围"), imageId: 3 }, d)).rejects.toThrow();
    const fresh = await runFrameRegionReview({ ...next(located, "更厚一点"), imageId: 3 }, d);
    expect(fresh.frameReview).toMatchObject({ timelineVersion: 10, phase: "scope_review" });
    expect(fresh.frameReview.id).not.toBe(located.id);
    expect(fresh.frameReview.tasks[0].approvedRevision).toBeUndefined();
    expect(fresh.frameReview.tasks[0].shapeQuote).toBeDefined();
  });

  it("keeps inheritance undecided when the user only changes the cloud description", async () => {
    const offered = await inheritanceOffer();
    const result = await runFrameRegionReview(next(offered.frameReview, "再厚一点，白一点"), d);
    expect(result.reply).toContain("是否沿用");
    expect(d.cloudQuote).not.toHaveBeenCalled();
    expect(result.frameReview.tasks.find(t => t.target === "forest")?.inheritance?.status).toBe("pending");
  });
});
describe("per-frame color inheritance", () => {
  it("starts a new review from an inserted frame at the new timeline revision without re-extracting", async () => {
    const offered = await inheritanceOffer();
    d.material.mockResolvedValue({ timeline: { version: 10 } });
    const frame = { ...offered.frameReview.frames[3], timelineVersion: 10 };
    const result = await runFrameRegionReview({ ...input, instruction: "云层更厚", stableShotId: "third", imageId: frame.imageId, sourceFrame: frame }, d);
    expect(result.frameReview.timelineVersion).toBe(10);
    expect(result.frameReview.id).not.toBe(offered.frameReview.id);
    expect(result.frameReview.frames[0]).toMatchObject({ imageId: frame.imageId, imageSize: { width: 12, height: 10 } });
    expect(d.extract).toHaveBeenCalledTimes(1);
    await expect(runFrameRegionReview({ ...input, stableShotId: "third", imageId: frame.imageId, sourceFrame: { ...frame, timelineVersion: 9 } }, d)).rejects.toThrow();
  });
  it("asks before reusing a prior candidate, freezes its identity, and retains the cloud mask", async () => {
    const offered = await inheritanceOffer();
    expect(offered.reply).toContain(`图片 #${offered.candidate.imageId}`);
    expect(d.recolor).toHaveBeenCalledTimes(1);
    const forest = offered.frameReview.tasks.find(task => task.target === "forest")!;
    expect(forest).toMatchObject({ imageId: 5, inheritance: { status: "pending", imageId: offered.candidate.imageId } });
    const cloud = offered.frameReview.tasks.find(task => task.target === "cloud");
    const confirmed = (await runFrameRegionReview(next(offered.frameReview, "确认云层范围"), d)).frameReview;
    expect(d.recolor).toHaveBeenCalledTimes(1);
    const accepted = (await runFrameRegionReview(next(confirmed, "沿用上一帧"), d)).frameReview;
    expect(d.recolor).toHaveBeenCalledTimes(2);
    expect(d.recolor.mock.lastCall[4]).toMatchObject({ source: imageBytes, mask: imageBytes });
    expect(accepted.tasks.find(task => task.target === "forest")?.inheritance?.status).toBe("accepted");
    expect(accepted.tasks.find(task => task.target === "cloud")).toMatchObject({ ...cloud, approvedRevision: offered.frameReview.revision });
    expect(d.createImage.mock.lastCall[0]).toMatchObject({ parentImageId: 5, isCurrent: false });
    await expect(runFrameRegionReview(next(confirmed, "沿用上一帧"), d)).rejects.toThrow();
  });
  it("persists refusal and does not ask again on cloud refinements", async () => {
    const offered = await inheritanceOffer();
    const refused = (await runFrameRegionReview(next(offered.frameReview, "不继承"), d)).frameReview;
    const again = await runFrameRegionReview({ ...next(refused, "云层范围扩大"), imageId: 5 }, d);
    expect(again.frameReview.declinedInheritanceImageIds).toEqual([5]);
    expect(again.frameReview.tasks.some(task => task.inheritance)).toBe(false);
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });
  it("keeps the previous treatment available for a later frame after a refusal", async () => {
    const offered = await inheritanceOffer();
    // Existing persisted offers predate the treatment history field.
    delete body.frameRegionReviews[0].forestTreatmentHistory;
    const refused = (await runFrameRegionReview(next(offered.frameReview, "不继承"), d)).frameReview;
    const later = await runFrameRegionReview({ ...next(refused, "定位云层范围"), imageId: 4 }, d);
    expect(later.frameReview.tasks.find(t => t.target === "forest")?.inheritance).toMatchObject({ status: "pending", imageId: offered.candidate.imageId });
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });
  it("honors a request to leave the forest unchanged even when cloud scope is confirmed later", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview({ ...next(first, "森林改绿色"), imageId: 1 }, d)).frameReview;
    const edited = (await runFrameRegionReview(next(located, "确认森林范围"), d)).frameReview;
    const cloud = (await runFrameRegionReview({ ...next(edited, "云层更厚，森林不动"), imageId: 5 }, d)).frameReview;
    const confirmed = await runFrameRegionReview({ ...next(cloud, "确认云层范围"), imageId: 5 }, d);
    expect(confirmed.frameReview.tasks.some(task => task.inheritance)).toBe(false);
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });
  it("does not interpret a different selected frame or a modified reference as approval", async () => {
    const offered = await inheritanceOffer();
    const switched = await runFrameRegionReview({ ...next(offered.frameReview, "沿用上一帧"), imageId: 2 }, d);
    expect(switched.reply).toContain("所选图片已变化");
    d.read.mockImplementation(async (image: any) => image.id === offered.candidate.imageId ? Buffer.from("changed-reference") : imageBytes);
    const result = await runFrameRegionReview(next(switched.frameReview, "沿用上一帧"), d);
    expect(result.reply).toContain("未完成");
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });
  it("does not offer inheritance when no trees are detected", async () => {
    const offered = await inheritanceOffer();
    const prior = body.frameRegionReviews[0];
    prior.tasks = prior.tasks.filter((task: any) => task.target !== "forest");
    // A prior review retains the candidate, but a different target frame has no trees.
    const earlier = { ...offered.frameReview, id: "c7be11aa-8082-4bc6-9d79-1bb92118a715", tasks: [{ ...offered.frameReview.tasks.find(t => t.target === "forest"), imageId: 1, candidate: offered.candidate }], updatedAt: 1 };
    body.frameRegionReviews.push(earlier);
    d.inspect.mockImplementation(async (_frames: unknown, tasks: any[]) => tasks.map(task => ({ target: task.target, imageId: task.imageId, selectedPixels: task.target === "forest" ? 0 : 40, mask: imageBytes, protection: imageBytes, overlay: imageBytes })));
    const result = await runFrameRegionReview({ ...next(prior, "云层扩大"), imageId: 4 }, d);
    expect(result.frameReview.tasks.some(t => t.inheritance)).toBe(false);
  });
});
describe("persistent region approval", () => {
  it("extracts, localizes and refines without producing edits; old approval is rejected", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const second = (await runFrameRegionReview(next(first, "森林改绿色，云层大一点，飞机只要一个"), d)).frameReview;
    expect(second.tasks.map(t => t.target)).toEqual(["forest", "plane", "cloud"]);
    expect(d.recolor).not.toHaveBeenCalled(); expect(d.createImage).not.toHaveBeenCalled();
    const refined = (await runFrameRegionReview(next(second, "森林范围扩大一点，只选左边"), d)).frameReview;
    expect(refined.tasks.find(t => t.target === "forest")).toMatchObject({ threshold: .29, area: "left" });
    await expect(runFrameRegionReview(next(second, "确认范围"), d)).rejects.toThrow("已变化");
    expect(d.recolor).not.toHaveBeenCalled(); expect(body.otherSession).toEqual({ keep: true });
  });
  it("edits only after exact scope confirmation; retains original and guards missing geometry", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview(next(first, "森林改绿色，飞机只要一个，云层大一点"), d)).frameReview;
    const edited = (await runFrameRegionReview(next(located, "确认范围"), d)).frameReview;
    expect(d.recolor).toHaveBeenCalledTimes(1);
    expect(d.createImage).toHaveBeenCalledWith(expect.objectContaining({ parentImageId: 3, isCurrent: false }));
    expect(edited.phase).toBe("image_review");
    const confirmation = await runFrameRegionReview(next(edited, "确认图片"), d);
    expect(confirmation.frameReview.phase).toBe("image_review"); expect(confirmation.reply).toContain("还没有全部");
    await expect(runFrameRegionReview(next(located, "确认范围"), d)).rejects.toThrow();
    expect(d.recolor).toHaveBeenCalledTimes(1);
  });
  it("blocks changed source, unresolved masks and timeline changes", async () => {
    const first = (await runFrameRegionReview(input, d)).frameReview;
    const located = (await runFrameRegionReview(next(first, "森林改绿色"), d)).frameReview;
    d.read.mockResolvedValue(Buffer.from("changed"));
    const result = await runFrameRegionReview(next(located, "确认范围"), d);
    expect(result.reply).toContain("未完成"); expect(d.recolor).not.toHaveBeenCalled();
    d.material.mockResolvedValue({ timeline: { version: 10 } });
    await expect(runFrameRegionReview(next(result.frameReview, "森林范围扩大"), d)).rejects.toThrow();
  });
  it("checks ownership before extraction or recognition", async () => {
    d.story.mockResolvedValue(null);
    await expect(runFrameRegionReview(input, d)).rejects.toThrow("故事不存在");
    expect(d.extract).not.toHaveBeenCalled(); expect(d.inspect).not.toHaveBeenCalled();
  });
  it("retains a partial extraction in Warehouse but does not offer it as a complete review", async () => {
    d.extract.mockResolvedValue({ frames: [], requestedCount: 5, failures: ["decoder failed"] });
    await expect(runFrameRegionReview(input, d)).rejects.toThrow("未全部完成"); expect(d.update).not.toHaveBeenCalled();
  });
});

it("allows explicit forest-only approval without approving unresolved airplane geometry", async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  d.inspect.mockImplementation(async (_frames: unknown, tasks: Array<{ target: string }>) => tasks.map((task: any) => ({ target: task.target, imageId: 3, selectedPixels: task.target === "plane" ? 0 : 40, mask: imageBytes, protection: imageBytes, overlay: imageBytes })));
  const located = (await runFrameRegionReview(next(first, "森林改绿色；飞机只要一个"), d)).frameReview;
  const edited = (await runFrameRegionReview(next(located, "确认森林范围"), d)).frameReview;
  expect(edited.tasks.find(t => t.target === "forest")?.candidate).toBeDefined();
  expect(edited.tasks.find(t => t.target === "plane")?.approvedRevision).toBeUndefined();
  expect(edited.approvedRevision).toBeUndefined();
  await runFrameRegionReview(next(edited, "确认森林范围"), d);
  expect(d.recolor).toHaveBeenCalledTimes(1);
});

it("keeps the approved forest region and candidate when only cloud scope changes", async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const located = (await runFrameRegionReview(next(first, "森林改绿色；最后几帧云层更大更厚"), d)).frameReview;
  const edited = (await runFrameRegionReview(next(located, "确认森林范围"), d)).frameReview;
  const forest = structuredClone(edited.tasks.find(t => t.target === "forest"));
  const refined = (await runFrameRegionReview(next(edited, "重新识别云层范围，树木保持不变"), d)).frameReview;
  expect(refined.tasks.find(t => t.target === "forest")).toEqual(forest);
  expect(refined.tasks.find(t => t.target === "cloud")?.candidate).toBeUndefined();
  expect(d.recolor).toHaveBeenCalledTimes(1);
  expect(d.inspect.mock.lastCall[1]).toEqual([expect.objectContaining({ target: "cloud" })]);
});


it("uses the clicked warehouse image as the exact base and retains other object reviews", async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const located = (await runFrameRegionReview(next(first, "森林改绿色；云层更厚"), d)).frameReview;
  const cloud = structuredClone(located.tasks.find(t => t.target === "cloud"));
  images.push({ id: 99, userId: 1, storyId: 7, shotIdentity: "third", imageUrl: "/api/images/chosen.png" });
  const selected = (await runFrameRegionReview({ ...next(located, "只把树木改成绿色，其他颜色保持不变"), imageId: 99 }, d)).frameReview;
  expect(d.inspect.mock.lastCall[1]).toEqual([expect.objectContaining({ target: "forest", imageId: 99 })]);
  expect(selected.tasks.find(t => t.target === "forest")?.imageId).toBe(99);
  expect(selected.tasks.find(t => t.target === "cloud")).toEqual(cloud);
  expect(selected.frames).toEqual(located.frames);
  expect((selected as any).sourceImages).toEqual([expect.objectContaining({ imageId: 99, imageUrl: "/api/images/chosen.png" })]);
  const refined = (await runFrameRegionReview(next(selected, "森林范围扩大一点"), d)).frameReview;
  expect(refined.tasks.find(t => t.target === "forest")?.imageId).toBe(99);
  await runFrameRegionReview(next(refined, "确认森林范围"), d);
  expect(d.createImage).toHaveBeenCalledWith(expect.objectContaining({ parentImageId: 99, isCurrent: false }));
});

it.each(["missing", "other-story", "other-shot", "other-owner"])("rejects a %s selected image without falling back to a video frame", async kind => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  if (kind !== "missing") images.push({ id: 99, userId: kind === "other-owner" ? 2 : 1, storyId: kind === "other-story" ? 8 : 7,
    shotIdentity: kind === "other-shot" ? "another" : "third", imageUrl: "/api/images/other.png" });
  d.inspect.mockClear(); d.update.mockClear();
  await expect(runFrameRegionReview({ ...next(first, "只改树木绿色"), imageId: 99 }, d)).rejects.toThrow();
  expect(d.inspect).not.toHaveBeenCalled(); expect(d.update).not.toHaveBeenCalled();
});


it("persists separate object sampling masks and refuses a changed object mask", async () => {
  const first = (await runFrameRegionReview(input, d)).frameReview;
  const objects = Buffer.from("object-sampling-mask");
  d.inspect.mockImplementation(async (_frames: unknown, tasks: any[]) => tasks.map(task => ({ target: task.target, imageId: 3, selectedPixels: 40,
    mask: imageBytes, protection: imageBytes, overlay: imageBytes, objects })));
  const located = (await runFrameRegionReview(next(first, "树木改成绿色"), d)).frameReview;
  expect(located.tasks[0].objectMaskUrl).toContain("forest-objects");
  expect(d.inspect.mock.lastCall[1][0].greenEdit).toBe(true);
  d.read.mockImplementation(async (image: any) => image.imageUrl.includes("forest-objects") ? objects : imageBytes);
  await runFrameRegionReview(next(located, "确认森林范围"), d);
  expect(d.recolor).toHaveBeenCalledWith(imageBytes, imageBytes, imageBytes, objects);
  const refined = (await runFrameRegionReview(next(body.frameRegionReviews[0], "森林范围扩大一点"), d)).frameReview;
  expect(d.inspect.mock.lastCall[1][0].greenEdit).toBe(true);
  d.read.mockImplementation(async (image: any) => image.imageUrl.includes("forest-objects") ? Buffer.from("changed") : imageBytes);
  d.recolor.mockClear();
  const result = await runFrameRegionReview(next(refined, "确认森林范围"), d);
  expect(result.reply).toContain("未完成");
  expect(d.recolor).not.toHaveBeenCalled();
});

it("reviews a saved warehouse source frame without inventing timeline coordinates", async () => {
  const sourceFrame = { ...(await d.extract()).frames[2], origin: "warehouse-video" as const, timelineVersion: undefined, timelineFrame: undefined };
  const result = await runFrameRegionReview({ ...input, instruction: "查看这一帧", stableShotId: "third", imageId: 3, sourceFrame, inspectOnly: true }, d);
  expect(result.reply).toContain("源视频 4.00");
  expect(result.frameReview.frames[0].timelineFrame).toBeUndefined();
  expect(result.frameReview.frames[0].timelineVersion).toBeUndefined();
  expect(result.frameReview.timelineVersion).toBe(9);
  expect(d.recolor).not.toHaveBeenCalled();
  expect(d.cloudQuote).not.toHaveBeenCalled();
});
