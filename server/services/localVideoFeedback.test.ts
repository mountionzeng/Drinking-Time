import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  archivedPictureEdit,
  looksLikeVideoFeedback,
  pictureEdit,
  sameVideoDirection,
} from "../../shared/localVideoFeedback";
import {
  createStory,
  getStoryById,
  updateStoryBodyIfRevision,
} from "../repositories/stories";
import {
  createVideoTake,
  getStoryVideoTakes,
  getVideoTakeById,
  updateVideoTake,
} from "../repositories/videos";
import { localVideoDir } from "./videoMedia";
import { submitLocalVideoFeedback } from "./localVideoFeedback";

const q = { storyId: 7, stableShotId: "shore" };
const bank =
  "河岸的位置一直在晃";
const landscape =
  "移除路标。纸盒的边缘请修好。模型不要动，保留云和水流动。";
const rows = (
  id: number,
  source: number,
  target: number,
  instruction: string
) =>
  [
    ["before-review", "u", "回看候选视频 Take #" + source],
    ["video-cues:before-review", "s", "播放后可反馈"],
    ["scene-feedback", "u", instruction],
    ["scene-result", "s", "已完成"],
    ["scene-review", "u", "回看候选视频 Take #" + target],
    ["video-cues:scene-review", "s", "播放后可反馈"],
  ].map(([key, who, text]) => ({
    id: key,
    who,
    text,
    selectionQuote: { ...q, storyId: id },
  }));
describe("source-bound local video feedback", () => {
  it("replays a recorded multi-clause repair only for the matching version", () => {
    const history = rows(7, 11, 12, landscape);
    expect(
      archivedPictureEdit(
        history,
        7,
        "shore",
        11,
        landscape.replace("模型不要动", "模型 不要动")
      )
    ).toBe(12);
    for (const [story, shot, take] of [
      [6, "shore", 11],
      [7, "trees", 11],
      [7, "shore", 13],
    ] as const)
      expect(
        archivedPictureEdit(history, story, shot, take, landscape)
      ).toBeUndefined();
    expect(
      archivedPictureEdit(
        history.filter(r => r.id !== "scene-result"),
        7,
        "shore",
        11,
        landscape
      )
    ).toBeUndefined();
  });
  it("keeps new constraints and negations distinct from past repairs", () => {
    expect(sameVideoDirection(bank, "水边还在晃")).toBe(true);
    expect(sameVideoDirection("在1.2秒修边", "在12秒修边")).toBe(false);
    const alternate = "模型别动，修顺纸盒的边缘，去掉路标，保留云和河水流动。";
    expect(sameVideoDirection(landscape, alternate)).toBe(true);
    expect(sameVideoDirection(landscape, alternate + "把山也压暗")).toBe(false);
    expect(
      sameVideoDirection(landscape, alternate.replace("去掉", "不要去掉"))
    ).toBe(false);
    for (const other of [
      "让水边晃得更厉害",
      "水边还在晃，云也减速",
      "水边不要固定不动",
      "水边没在晃",
    ])
      expect(sameVideoDirection(bank, other)).toBe(false);
    expect(looksLikeVideoFeedback("生成一张图片，不要有野餐垫")).toBe(false);
    expect(pictureEdit("画面亮一点，云也减速")).toBeUndefined();
  });
  it("renders the repair inside the requested time window, copies audio, protects the parent, and reopens the same receipt", async () => {
    const userId = 781,
      shot = "shore";
    const story = await createStory({
      userId,
      title: "local feedback",
      body: { shots: [{ shotNo: 1, stableShotId: shot }], untouched: "draft" },
    });
    const dir = localVideoDir();
    mkdirSync(dir, { recursive: true });
    const ff = (args: string[]) =>
      execFileSync("ffmpeg", ["-v", "error", ...args]);
    async function take(color: string) {
      const t = await createVideoTake({
        userId,
        storyId: story.id,
        stableShotId: shot,
        status: "available",
        provider: "local-import",
        model: "local-import",
        aspectRatio: "1:1",
        prompt: "已有局部修改",
      });
      const key = "take-" + t.id + ".mp4";
      ff([
        "-f",
        "lavfi",
        "-i",
        "color=" + color + ":s=80x80:r=20:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=d=1",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        path.join(dir, key),
      ]);
      await updateVideoTake(t.id, userId, {
        videoKey: key,
        videoUrl: "/api/videos/" + key,
      });
      return t.id;
    }
    const parent = await take("blue"),
      fixed = await take("red");
    const original = (await getStoryById(story.id, userId))!.body as {
      _revision?: number;
    };
    const rev = original._revision ?? 0;
    await updateStoryBodyIfRevision({
      id: story.id,
      userId,
      expectedRevision: rev,
      body: {
        ...original,
        _revision: rev + 1,
        messages: rows(story.id, parent, fixed, bank),
      },
    });
    const input = {
      storyId: story.id,
      stableShotId: shot,
      takeId: parent,
      instruction: "从0.3秒到0.7秒，水边还在晃",
      sentAt: Date.now(),
      id: randomUUID(),
    };
    const parentFile = path.join(dir, "take-" + parent + ".mp4"),
      before = readFileSync(parentFile);
    const offline = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected network"));
    try {
      const [one, two] = await Promise.all([
        submitLocalVideoFeedback(userId, input),
        submitLocalVideoFeedback(userId, input),
      ]);
      expect(one).toEqual(two);
      expect(one.takeId).toBeTruthy();
      expect(one.takeId).not.toBe(fixed);
      expect(await submitLocalVideoFeedback(userId, input)).toEqual(one);
      const output = path.join(
        dir,
        (await getVideoTakeById(one.takeId!, userId))!.videoKey!
      );
      const rgb = (sec: string) =>
        ff([
          "-ss",
          sec,
          "-i",
          output,
          "-frames:v",
          "1",
          "-vf",
          "scale=1:1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ]);
      expect(rgb("0.1")[2]).toBeGreaterThan(200);
      expect(rgb("0.5")[0]).toBeGreaterThan(200);
      expect(rgb("0.9")[2]).toBeGreaterThan(200);
      const audio = (file: string) =>
        ff(["-i", file, "-map", "0:a", "-f", "hash", "-"]);
      expect(audio(output)).toEqual(audio(parentFile));
      expect(readFileSync(parentFile)).toEqual(before);
      const saved = (await getStoryById(story.id, userId))!.body as {
        messages: Array<{ id: string }>;
        untouched: string;
      };
      expect(saved.messages.filter(m => m.id.endsWith(input.id))).toHaveLength(
        2
      );
      expect(saved.untouched).toBe("draft");
      expect((await getStoryVideoTakes(story.id, userId)).length).toBe(3);
      await expect(
        submitLocalVideoFeedback(userId, {
          ...input,
          instruction: "画面亮一点",
        })
      ).rejects.toThrow(/已经改变/);
      await expect(submitLocalVideoFeedback(userId + 1, input)).rejects.toThrow(
        /无法找到/
      );
      const unclear = await submitLocalVideoFeedback(userId, {
        ...input,
        id: randomUUID(),
        instruction: "只删除屏幕里的另一个杯子",
      });
      expect(unclear.takeId).toBeNull();
      expect(unclear.text).toContain("引用当前帧");
      expect(offline).not.toHaveBeenCalled();
    } finally {
      offline.mockRestore();
    }
  });
  it("executes a new timed hold and brightness edit on an unrelated shot with no edit history", async () => {
    const userId = 788,
      stableShotId = "new-scene";
    const story = await createStory({
      userId,
      title: "new scene",
      body: { shots: [{ shotNo: 1, stableShotId }] },
    });
    const dir = localVideoDir();
    mkdirSync(dir, { recursive: true });
    const take = await createVideoTake({
      userId,
      storyId: story.id,
      stableShotId,
      status: "available",
      provider: "local-import",
      model: "local-import",
      aspectRatio: "1:1",
      prompt: "",
    });
    const key = "take-" + take.id + ".mp4",
      src = path.join(dir, key);
    const ff = (args: string[]) =>
      execFileSync("ffmpeg", ["-v", "error", ...args]);
    ff([
      "-f",
      "lavfi",
      "-i",
      "nullsrc=s=80x80:r=20:d=1,geq=lum='40+N*7':cb=128:cr=128",
      "-c:v",
      "libx264",
      src,
    ]);
    await updateVideoTake(take.id, userId, {
      videoKey: key,
      videoUrl: "/api/videos/" + key,
    });
    const request = {
      storyId: story.id,
      stableShotId,
      takeId: take.id,
      id: randomUUID(),
      sentAt: Date.now(),
      instruction: "从0.2秒到0.8秒，固定画面左上四分之一",
    };
    const held = await submitLocalVideoFeedback(userId, request);
    expect(held.takeId).toBeTruthy();
    const file = path.join(dir, "take-" + held.takeId + ".mp4");
    const at = (file: string, s: string, x: number) =>
      ff([
        "-ss",
        s,
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "crop=4:4:" + x + ":4",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "-",
      ])[0];
    expect(Math.abs(at(file, "0.6", 4) - at(src, "0.2", 4))).toBeLessThan(3);
    expect(Math.abs(at(file, "0.6", 64) - at(src, "0.6", 64))).toBeLessThan(3);
    const bright = await submitLocalVideoFeedback(userId, {
      ...request,
      id: randomUUID(),
      instruction: "画面稍微调亮一点",
    });
    expect(
      at(path.join(dir, "take-" + bright.takeId + ".mp4"), "0.6", 4)
    ).toBeGreaterThan(at(src, "0.6", 4) + 2);
    const invalid = await submitLocalVideoFeedback(userId, {
      ...request,
      id: randomUUID(),
      instruction: "从2秒到8秒，固定画面左上四分之一",
    });
    expect(invalid.takeId).toBeNull();
    expect(invalid.text).toContain("1 秒");
  });
});
