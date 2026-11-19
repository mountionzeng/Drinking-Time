import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { estimateShotVideoCost } from "../../shared/shotDirector";
import { cueRanges } from "../../shared/videoCueTiming";
import { hasUnreviewedFrameRefinement } from "../../shared/chatImageRevision";
import {
  decideVideoRenderStrategy,
  withVideoVisualFidelity,
} from "../../shared/videoMotionPolicy";
import {
  describeOrigin,
  needsObjectOrigin,
} from "../../shared/videoObjectOrigin";
import {
  warehouseCueOpeningInput,
  type WarehouseCueOpeningInput,
} from "../../shared/warehouseVideoSequence";
import { getStoryById } from "../repositories/stories";
import { getStoryImageAssets } from "./imageAssets";
import { getShotVideoProviderStatus } from "./videoGen";
import { startShotVideoJob } from "./videoJobs";
import { renderRefusalReason } from "./render/submitRender";
import {
  readVideoTimelineCues,
  directionFromTimeline,
} from "./videoTimelineCues";
import {
  findWarehouseVideoSequence,
  readFrame,
  sequenceKey,
} from "./warehouseVideoSequence";

async function prepareOpening(raw: WarehouseCueOpeningInput, userId: number) {
  const input = warehouseCueOpeningInput.parse(raw);
  const story = await getStoryById(input.storyId, userId);
  type ChatRow = {
    id: string;
    text: string;
    selectionQuote?: { stableShotId?: string };
  };
  const body = story?.body as
    | {
        shots?: {
          stableShotId?: string;
          shotIdentity?: string;
          shotNo: number;
        }[];
        messages?: ChatRow[];
        storyboardImageTasks?: unknown;
      }
    | undefined;
  const shot = body?.shots?.find(
    row => (row.stableShotId ?? row.shotIdentity) === input.stableShotId
  );
  const plan = body?.messages?.find(
    row => row.id === "video-cues:" + input.messageId
  );
  if (!shot || plan?.selectionQuote?.stableShotId !== input.stableShotId)
    throw new Error("逐秒稿与当前故事或镜头不一致，请重新打开方案。");
  if (hasUnreviewedFrameRefinement(body?.storyboardImageTasks, input.stableShotId))
    throw new Error("本镜还有待审的修改图，请先在聊天中选用新版或保留原图。");
  const status = getShotVideoProviderStatus("economy");
  if (!status.ready)
    throw new Error("单首帧视频尚未就绪，请检查视频服务配置。");
  const assets = await getStoryImageAssets(input.storyId, userId);
  const available = (id: number) =>
    assets.find(
      row =>
        row.id === id &&
        row.availability !== "missing" &&
        row.status !== "rejected"
    );
  const image = available(input.imageId);
  if (!image || input.referenceIds.some(id => !available(id)))
    throw new Error("首帧或聊天参考图已不可用，请重新选择。");
  const frame = await readFrame(image.imageUrl, userId);
  const description = [
    input.prompt,
    ...cueRanges(input.seconds).map(({start,end,text}) => start + "–" + end + "秒：" + text),
  ].join("\n");
  if (
    (needsObjectOrigin(description) && !input.objectOrigin) ||
    (input.objectOrigin && input.objectOrigin.imageId !== image.id)
  )
    throw new Error("请在当前首帧上锁定变形主体。");
  if (
    decideVideoRenderStrategy({ videoPrompt: description }).strategy ===
    "local-transform"
  )
    throw new Error("这个动作可以在本机免费完成，请使用分镜表的本地视频入口。");
  const durationSec = input.seconds.length;
  const [timelineCue] = await readVideoTimelineCues(
    input.storyId,
    userId,
    input.stableShotId,
    [durationSec]
  );
  const prompt = withVideoVisualFidelity(
    [
      description,
      input.objectOrigin &&
        describeOrigin(
          input.objectOrigin,
          frame.meta.width!,
          frame.meta.height!
        ),
      directionFromTimeline(timelineCue),
    ]
      .filter(Boolean)
      .join("\n")
  );
  const refusal = renderRefusalReason("video.vidu-q2-pro-fast", {
    input: { prompt },
  });
  if (refusal) throw new Error(refusal);
  const totalCny = estimateShotVideoCost({
    durationSec,
    motion: "low",
    priceProfile: "vidu-economy",
  }).estimatedCny;
  const fingerprint = createHash("sha256")
    .update(frame.bytes)
    .update(
      JSON.stringify({
        input,
        prompt,
        timelineCue,
        totalCny,
        shotNo: shot.shotNo,
        savedPlan: plan.text,
        model: status.model,
      })
    )
    .digest("hex");
  return {
    quote: { input, totalSeconds: durationSec, totalCny, fingerprint },
    shotNo: shot.shotNo,
    prompt,
    timelineCue,
    sourceImage: frame.sourceImage,
  };
}

export async function quoteCueOpening(
  input: WarehouseCueOpeningInput,
  userId: number
) {
  return (await prepareOpening(input, userId)).quote;
}

export async function submitCueOpening(
  input: WarehouseCueOpeningInput & {
    requestId: string;
    fingerprint: string;
    confirmedCny: number;
  },
  userId: number
) {
  const existing = await findWarehouseVideoSequence(
    input.storyId,
    input.requestId,
    userId
  );
  if (existing) {
    if (
      (existing.parameterSnapshot as { fingerprint?: string })?.fingerprint !==
        input.fingerprint ||
      existing.stableShotId !== input.stableShotId
    )
      throw new Error("此请求已有其他回执，请查看原任务。");
    return existing;
  }
  const prepared = await prepareOpening(input, userId).catch(cause => {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      cause,
      message: cause instanceof Error ? cause.message : "请重新报价",
    });
  });
  if (
    input.fingerprint !== prepared.quote.fingerprint ||
    input.confirmedCny !== prepared.quote.totalCny
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "逐秒稿、首帧、剪辑或费用已变化，请重新报价。",
    });
  const result = await startShotVideoJob(
    {
      storyId: input.storyId,
      stableShotId: input.stableShotId,
      shotNo: prepared.shotNo,
      imageId: input.imageId,
      renderMode: "economy",
      durationSec: input.seconds.length,
      motion: "low",
      directorPromptApproved: true,
      prompt: prepared.prompt,
      rerenderRequestId: input.requestId,
      reviewedOpening: {
        key: sequenceKey(userId, input.storyId, input.requestId),
        fingerprint: input.fingerprint,
        sourceImage: prepared.sourceImage,
        timelineCue: prepared.timelineCue,
      },
    },
    userId
  );
  if (result.take) return result.take;
  throw new Error(
    result.status === "error" ? result.error : "无法读取原任务回执。"
  );
}
