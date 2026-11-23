import { createHash } from "node:crypto";
import { link, mkdtemp, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  feedbackActivityId,
  readFeedbackActivity,
} from "../../shared/videoFeedbackActivity";
import type { VideoTake } from "../../drizzle/schema";
import {
  archivedPictureEdit,
  localNotePrefix,
  localReplyPrefix,
  pictureEdit,
  scopedRepair,
  startingLocalFeedback,
  type LocalPictureEdit,
} from "../../shared/localVideoFeedback";
import {
  getStoryById,
  updateStoryBodyIfRevision,
} from "../repositories/stories";
import {
  createVideoTakeIdempotently,
  getVideoTakeById,
  findVideoTakeByIdempotencyKey,
  updateVideoTake,
} from "../repositories/videos";
import { probeVideoFileMetadata } from "./videoConform";
import { localTakeFile, ffmpegCommand } from "./videoLuminanceGrade";
import { localVideoDir } from "./videoMedia";
import { runFfmpegCommand } from "./timelineMediaExport";

export const localFeedbackInput = z.object({
  storyId: z.number().int().positive(),
  stableShotId: z.string().min(1).max(128),
  takeId: z.number().int().positive(),
  id: z.string().uuid(),
  instruction: z.string().trim().min(1).max(4000),
  sentAt: z.number().int().positive(),
});
type Input = z.infer<typeof localFeedbackInput>;
type Quote = {
  objectVersion?: string;
  storyId: number;
  stableShotId: string;
  videoTakeId: number;
  sourceId: string;
  sourceType: "animatic-video";
  selectedText: string;
  fullText: string;
};
type Message = {
  id: string;
  who: string;
  text: string;
  selectionQuote?: Quote;
  timestamp?: number;
};
type Body = { _revision?: number; messages?: Message[] };
type Result = { text: string; takeId: number | null };

type LocalRenderPlan =
  | LocalPictureEdit
  | {
      kind: "repair";
      start: number;
      end: number;
      referenceId: number;
      label: string;
    };
export function pictureFilter(plan: LocalRenderPlan) {
  if (plan.kind === "light") return "[0:v]eq=brightness=" + plan.amount + "[v]";
  if (plan.kind === "repair")
    return (
      "[0:v][1:v]overlay=enable='gte(t," +
      plan.start +
      ")*lt(t," +
      plan.end +
      ")':eof_action=pass[v]"
    );
  const full = plan.area === "整个画面" || plan.area === "全画面";
  const right = plan.area.startsWith("右"),
    bottom = plan.area.includes("下");
  const crop = full
    ? ""
    : "crop=iw/2:ih/2:" +
      (right ? "iw-ow" : "0") +
      ":" +
      (bottom ? "ih-oh" : "0") +
      ",";
  // One source frame supplies the patch, framesync repeats it only over the requested interval.
  return (
    "[0:v]split[main][patch];[patch]trim=start=" +
    plan.start +
    ",trim=end_frame=1,setpts=PTS-STARTPTS," +
    crop +
    "null[frozen];[main][frozen]overlay=" +
    (right ? "W-w" : "0") +
    ":" +
    (bottom ? "H-h" : "0") +
    ":enable='gte(t," +
    plan.start +
    ")*lt(t," +
    plan.end +
    ")'[v]"
  );
}

const progress = new Map<
  string,
  NonNullable<ReturnType<typeof readFeedbackActivity>>
>();
const progressKey = (userId: number, storyId: number, id: string) =>
  [userId, storyId, id].join("/");
export const localFeedbackProgress = (
  userId: number,
  storyId: number,
  id: string
) => progress.get(progressKey(userId, storyId, id));
const running = new Map<string, Promise<Result>>();
const encoding = new Map<string, Promise<Result>>();
async function applyLocalPictureEdit(
  parent: VideoTake,
  instruction: string,
  plan: LocalRenderPlan,
  report: (step: string) => void,
  reference?: VideoTake
) {
  const key =
    "local-picture-v1:" +
    createHash("sha256")
      .update(JSON.stringify([parent.id, parent.videoKey, plan]))
      .digest("hex")
      .slice(0, 48);
  const pending = encoding.get(key);
  if (pending) {
    report("相同的修改正在制作，我会在这里放入完成的版本。");
    return pending;
  }
  if (encoding.size > 0)
    throw new Error("另一个视频正在本机精修，请稍后重试。");
  const work = renderLocalPicture(
    parent,
    instruction,
    plan,
    key,
    report,
    reference
  ).finally(() => encoding.delete(key));
  encoding.set(key, work);
  return work;
}
async function renderLocalPicture(
  parent: VideoTake,
  instruction: string,
  plan: LocalRenderPlan,
  key: string,
  report: (step: string) => void,
  reference?: VideoTake
) {
  const source = localTakeFile(parent);
  const existing = await findVideoTakeByIdempotencyKey(
    parent.storyId,
    parent.userId,
    key
  );
  if (existing?.status === "available") {
    await probeVideoFileMetadata(localTakeFile(existing));
    return {
      text: "已找回从这个版本做好的相同修改。" + plan.label + "，本次 0 算力。",
      takeId: existing.id,
    };
  }
  report("正在读取原视频的尺寸和时长。");
  const before = await probeVideoFileMetadata(source);
  if (
    !before.durationSec ||
    before.durationSec > 180 ||
    before.width * before.height > 4096 * 2160
  )
    throw new Error(
      "这条视频超出了本地单镜处理范围，请先使用较短或较低分辨率的本地原片。"
    );
  if (
    plan.kind !== "light" &&
    !(
      plan.start >= 0 &&
      plan.start < plan.end &&
      plan.end <= before.durationSec
    )
  )
    throw new Error(
      "这段视频共 " +
        before.durationSec +
        " 秒，请在这个范围内指定开始和结束秒数。"
    );
  const second: string[] = [];
  if (plan.kind === "repair") {
    if (
      !reference ||
      reference.id !== plan.referenceId ||
      reference.stableShotId !== parent.stableShotId ||
      reference.userId !== parent.userId ||
      reference.storyId !== parent.storyId
    )
      throw new Error("请核对修补参考版本。");
    const file = localTakeFile(reference),
      info = await probeVideoFileMetadata(file);
    if (
      info.width !== before.width ||
      info.height !== before.height ||
      !info.durationSec ||
      Math.abs(info.durationSec - before.durationSec) > 0.001
    )
      throw new Error(
        "参考与原片的尺寸或时长不同，请在原片引用需要修的那一帧。"
      );
    second.push("-i", file);
  }
  const space = await statfs(localVideoDir());
  // Leave capacity for MySQL, old media, and release recovery on this host.
  if (space.bavail * space.bsize < 1024 * 1024 * 1024)
    throw new Error("本机视频空间不足，暂时无法保存新候选。");
  const dir = await mkdtemp(path.join(localVideoDir(), ".shot-picture-")),
    output = path.join(dir, "candidate.mp4");
  try {
    report("正在" + plan.label + "，音轨沿用原片。");
    await runFfmpegCommand(
      [
        "-nostdin",
        "-v",
        "error",
        "-i",
        source,
        ...second,
        "-filter_complex_threads",
        "1",
        "-filter_complex",
        pictureFilter(plan),
        "-map",
        "[v]",
        "-map",
        "0:a?",
        "-c:a",
        "copy",
        "-map_metadata",
        "0",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-fs",
        "268435456",
        "-preset",
        "veryfast",
        "-crf",
        "16",
        "-movflags",
        "+faststart",
        output,
      ],
      { ffmpegPath: ffmpegCommand() }
    );
    report("正在核对输出尺寸和时长，并保存可播放的候选。");
    if ((await stat(output)).size >= 256 * 1024 * 1024)
      throw new Error("精修输出超出单条视频的大小限制，请缩短或降低原片分辨率。");
    const after = await probeVideoFileMetadata(output);
    if (
      after.width !== before.width ||
      after.height !== before.height ||
      !after.durationSec ||
      Math.abs(after.durationSec - before.durationSec) > 0.05
    )
      throw new Error("核对发现输出尺寸或时长有变化，请保留原片。");
    const claim = await createVideoTakeIdempotently({
      storyId: parent.storyId,
      userId: parent.userId,
      stableShotId: parent.stableShotId,
      idempotencyKey: key,
      sourceImageId: parent.sourceImageId,
      subtitle: parent.subtitle,
      provider: "local",
      model: "local-picture-edit-v1",
      prompt: instruction,
      status: "processing",
      durationSec: after.durationSec,
      aspectRatio: parent.aspectRatio,
      extractionCapability: "available",
      parameterSnapshot: {
        kind: "local-picture-feedback",
        parentTakeId: parent.id,
        plan,
        computeUnits: 0,
        costCny: 0,
      },
    });
    if (!claim.created && claim.take.status === "available")
      return {
        text: "已找到相同的本地修改，本次 0 算力。",
        takeId: claim.take.id,
      };
    // Publish a complete file atomically. A retry can finish an interrupted reservation.
    const videoKey = "take-" + claim.take.id + ".mp4";
    const destination = path.join(localVideoDir(), videoKey);
    try {
      await link(output, destination).catch(
        async (error: NodeJS.ErrnoException) => {
          if (error.code !== "EEXIST") throw error;
          const recovered = await probeVideoFileMetadata(destination);
          if (
            recovered.width !== after.width ||
            recovered.height !== after.height ||
            recovered.durationSec !== after.durationSec
          )
            throw new Error("仓库文件与预留候选不一致");
        }
      );
      const media = { videoKey, videoUrl: "/api/videos/" + videoKey };
      if (
        !(await updateVideoTake(claim.take.id, parent.userId, {
          ...media,
          status: "available",
          errorMessage: null,
        }))
      )
        throw new Error("保存失败");
    } catch {
      await updateVideoTake(claim.take.id, parent.userId, {
        status: "failed",
        errorMessage: "本地候选保存失败",
      });
      throw new Error("候选保存失败，可重新提交这条反馈。");
    }
    return {
      text:
        "已" +
        plan.label +
        "。已核对尺寸与时长，" +
        Number(after.durationSec.toFixed(2)) +
        " 秒，本次 0 算力。",
      takeId: claim.take.id,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function scopeMatches(message: Message | undefined, input: Input) {
  return (
    message?.selectionQuote?.storyId === input.storyId &&
    message.selectionQuote.stableShotId === input.stableShotId
  );
}
function previous(body: Body, input: Input): Result | undefined {
  const note = body.messages?.find(m => m.id === localNotePrefix + input.id);
  const reply = body.messages?.find(m => m.id === localReplyPrefix + input.id);
  if (
    note &&
    (note.who !== "u" ||
      note.text !== input.instruction ||
      !scopeMatches(note, input) ||
      note.selectionQuote?.videoTakeId !== input.takeId)
  )
    throw new Error("这条反馈的原片或文字已经改变，请核对当前版本。");
  if (
    !reply ||
    reply.selectionQuote?.objectVersion === "local-feedback-pending" ||
    reply.text === startingLocalFeedback(input.instruction)
  )
    return;
  if (!note || !scopeMatches(reply, input) || reply.who !== "s")
    throw new Error("这条反馈的镜头归属不一致。");
  return {
    text: reply.text,
    takeId:
      reply.selectionQuote?.objectVersion === "local-feedback-ready" ||
      (!reply.selectionQuote?.objectVersion && reply.text.startsWith("已"))
        ? reply.selectionQuote!.videoTakeId
        : null,
  };
}
async function edit(userId: number, input: Input): Promise<Result> {
  const story = await getStoryById(input.storyId, userId);
  const source = await getVideoTakeById(input.takeId, userId);
  if (
    !story ||
    source?.storyId !== input.storyId ||
    source.stableShotId !== input.stableShotId ||
    source.status !== "available"
  )
    throw new Error("无法找到这个镜头的原片，请重新打开对应的视频。");
  const body = (story.body ?? {}) as Body;
  const saved = previous(body, input);
  if (saved) return saved;
  const steps: string[] = [];
  const report = (step: string) => {
    steps.push(step);
    progress.set(
      progressKey(userId, input.storyId, feedbackActivityId(input.id)),
      { phase: "制作中", steps: [...steps], latest: step }
    );
  };
  report(startingLocalFeedback(input.instruction));
  let result: Result;
  try {
    const plan = pictureEdit(input.instruction);
    const range = scopedRepair(input.instruction);
    const archiveId = archivedPictureEdit(
      body.messages ?? [],
      input.storyId,
      input.stableShotId,
      source.id,
      range?.direction ?? input.instruction
    );
    if (archiveId) {
      const target = await getVideoTakeById(archiveId, userId);
      if (
        !target ||
        target.storyId !== input.storyId ||
        target.stableShotId !== input.stableShotId ||
        target.status !== "available" ||
        target.model !== "local-import" ||
        !target.videoUrl
      )
        throw new Error(
          "找到了旧反馈，但对应成片暂时无法读取。请在仓库核对该版本。"
        );
      if (target.id === source.id) {
        result = {
          takeId: null,
          text: "你正在看上一次修过的版本。请在问题还出现的那一刻暂停下面的视频，点「引用当前帧到聊天」，就能标出还要改的位置。",
        };
      } else if (range) {
        result = await applyLocalPictureEdit(
          source,
          input.instruction,
          {
            kind: "repair",
            start: range.start,
            end: range.end,
            referenceId: target.id,
            label:
              "在 " +
              range.start +
              " 到 " +
              range.end +
              " 秒采用修好的画面，其余时段沿用原片",
          },
          report,
          target
        );
      } else {
        const media = await probeVideoFileMetadata(localTakeFile(target));
        const details = target.prompt
          .replace(/^第\s*\d+\s*镜\s*[·。]\s*/, "")
          .split(/\d+(?:\.\d+)?\s*秒[，,]|校验/)[0]
          .trim();
        result = {
          text:
            "已找回这条反馈对应的已有成片。" +
            details +
            (media.durationSec
              ? " " + Number(media.durationSec.toFixed(2)) + " 秒，"
              : " ") +
            "本次 0 算力。",
          takeId: target.id,
        };
      }
    } else if (plan) {
      result = await applyLocalPictureEdit(
        source,
        input.instruction,
        plan,
        report
      );
    } else {
      result = {
        takeId: null,
        text: "还需要定位要改的画面。请把下面的原片停在问题最明显的一帧，点「引用当前帧到聊天」，圈出位置，再告诉我希望它怎么动。",
      };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    result = {
      takeId: null,
      text: /ffmpeg|ffprobe|ENOENT|Command failed|退出码|编码/i.test(reason)
        ? "本地没有读出完整成片。可以在原片重试，或引用出现问题的那一帧继续。"
        : "这次调整还没完成。" + reason,
    };
  }
  if (result.takeId) result.text += " 可以直接看片，再告诉我想改哪里。";
  for (let i = 0; i < 5; i++) {
    const fresh = await getStoryById(input.storyId, userId);
    if (!fresh) throw new Error("故事暂时无法读取。");
    const current = (fresh.body ?? {}) as Body,
      done = previous(current, input);
    if (done) return done;
    const quote = (takeId: number): Quote => ({
      storyId: input.storyId,
      stableShotId: input.stableShotId,
      sourceId: input.stableShotId,
      sourceType: "animatic-video",
      videoTakeId: takeId,
      selectedText: "视频反馈",
      fullText: "视频反馈",
    });
    const note = {
      id: localNotePrefix + input.id,
      who: "u",
      text: input.instruction,
      timestamp: input.sentAt,
      selectionQuote: quote(input.takeId),
    };
    const reply = {
      id: localReplyPrefix + input.id,
      who: "s",
      text: result.text,
      timestamp: input.sentAt + 1,
      selectionQuote: {
        ...quote(result.takeId ?? input.takeId),
        objectVersion: result.takeId
          ? "local-feedback-ready"
          : "local-feedback-help",
      },
    };
    const messages = (current.messages ?? []).filter(
      m => m.id !== note.id && m.id !== reply.id
    );
    const insert = messages.findIndex(
      m => m.timestamp != null && m.timestamp > input.sentAt
    );
    messages.splice(insert < 0 ? messages.length : insert, 0, note, reply);
    const rev = current._revision ?? 0;
    if (
      await updateStoryBodyIfRevision({
        id: input.storyId,
        userId,
        expectedRevision: rev,
        body: { ...current, messages, _revision: rev + 1 },
      })
    )
      return result;
  }
  throw new Error("故事正在保存其他编辑，请重新连接这条反馈。");
}
export function submitLocalVideoFeedback(
  userId: number,
  input: Input
): Promise<Result> {
  const key = JSON.stringify([
    userId,
    input.storyId,
    input.stableShotId,
    input.takeId,
    input.id,
    input.instruction,
  ]);
  const pending = running.get(key);
  if (pending) return pending;
  const task = edit(userId, input).finally(() => {
    running.delete(key);
    progress.delete(
      progressKey(userId, input.storyId, feedbackActivityId(input.id))
    );
  });
  running.set(key, task);
  return task;
}
