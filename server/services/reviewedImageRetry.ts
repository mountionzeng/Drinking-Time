import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  chatImageEditPlanSchema,
  imageEditPlanQuote,
  adjustedImageEditPlanId,
  localEraseReceiptId,
} from "../../shared/chatImageEditPlan";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import { readArtPreviewBatches, type ArtPreviewBatch } from "../../shared/artPreview";
import { getStoryById } from "../repositories/stories";
import { jsonRecord } from "../repositories/storyValues";
import type { Task } from "./storyboardImageTask";

function requestUuid(parts: unknown[]) {
  const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function imageEditBatchRequestId(
  storyId: number,
  planMessageId: string,
  imageId: number,
  copy: number
) {
  return requestUuid([
    "chat-image-edit",
    storyId,
    planMessageId,
    imageId,
    copy,
  ]);
}
export const retryRequestId = (failedId: string) =>
  requestUuid(["chat-image-retry", failedId]);

export const previewRetryToken = (failedId: string, basis: string) => requestUuid(["warehouse-preview-retry", failedId, basis]);

export function imageAttemptHistory(byId: Map<string, Task>, root: string) {
  const history: Task[] = [];
  for (
    let task = byId.get(root);
    task;
    task = byId.get(retryRequestId(task.requestId))
  ) {
    history.push(task);
    if (!canRetryImage(task)) break;
  }
  return history;
}

export function canRetryImage(task: Task) {
  return (
    task.status === "failed" &&
    task.result?.status === "error" &&
    !task.result.submissionUncertain &&
    !task.result.recoveryPending &&
    !task.result.providerResultUrl &&
    !task.providerResultUrl &&
    !task.continuedBy
  );
}

export function imageFailureReason(error: string) {
  return /302 GPT-image.*状态 401，错误码 -10004/.test(error)
    ? "上次渲染时，图片服务商 302 的账户余额不足，未出图。"
    : error;
}

export type ImageRetryOffer = {
  storyId: number;
  stableShotId: string;
  planMessageId: string;
  imageId: number;
  copy: number;
  failedId: string;
  nextId: string;
  unitCny: number;
};

type WarehouseImageAttempt = {
  storyId: number; shotId: string; requestId: string; requestIds: string[]; startedAt: number;
  status: Task["status"]; offer?: ImageRetryOffer; error?: string; failureCount?: number;
  previewRetry?: { failedId: string; version: number; referenceId?: number };
};

/** Resolve one owned, final receipt against the exact shot in its saved preview plan. */
export function failedPreviewSource(body: Record<string, unknown>, failedId: string) {
  const tasks: Task[] = Array.isArray(body.storyboardImageTasks) ? body.storyboardImageTasks : [];
  const task = tasks.find(t => t.requestId === failedId);
  if (!task || !canRetryImage(task)) return;
  const plans = readArtPreviewBatches(body);
  if (plans.some(p => p.retryOf === failedId && p.shots.some(s => tasks.some(t => t.requestId === s.requestId)))) return;
  const batch = plans.find(p => p.shots.some(s => s.requestId === failedId && task.shotIdentity === `preview:${p.id}:${s.stableShotId}`));
  const shot = batch?.shots.find(s => s.requestId === failedId);
  if (batch && shot && Array.isArray(body.shots) && body.shots.some((s, i) => shotIdentityFromShot(s,i) === shot.stableShotId))
    return { batch, shot };
}

function previewAttempts(storyId: number, batches: ArtPreviewBatch[], byId: Map<string, Task>, liveShots: Set<string | null>): WarehouseImageAttempt[] {
  const rows: WarehouseImageAttempt[] = [];
  const retried = new Set<string>();
  const parents = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const batch of batches) for (const shot of batch.shots) {
    const task = byId.get(shot.requestId);
    if (!task || task.shotIdentity !== `preview:${batch.id}:${shot.stableShotId}`) continue;
    if (batch.retryOf) {
      retried.add(batch.retryOf);
      parents.set(task.requestId, batch.retryOf);
    }
    if (task.status === "failed") counts.set(shot.stableShotId, (counts.get(shot.stableShotId) ?? 0) + 1);
    if (task.status !== "failed" && !batch.retryOf) continue;
    rows.push({ storyId, shotId: shot.stableShotId, requestId: task.requestId, requestIds: [task.requestId],
      startedAt: task.createdAt ?? batch.createdAt, status: task.status,
      error: task.result?.status === "error" ? imageFailureReason(task.result.error) : undefined,
      previewRetry: liveShots.has(shot.stableShotId) && canRetryImage(task) ? { failedId: task.requestId, version: batch.version,
        referenceId: batch.explicitBaseline ? batch.baselineImageId ?? undefined : undefined } : undefined });
  }
  return rows.filter(row => !retried.has(row.requestId)).map(row => {
    const chain = new Set([row.requestId]);
    for (let id = parents.get(row.requestId); id && !chain.has(id); id = parents.get(id)) chain.add(id);
    return { ...row, requestIds: [...chain], failureCount: counts.get(row.shotId) };
  });
}

/** A compact projection of saved receipts for the warehouse, including attempts made on another device. */
export async function warehouseImageAttempts(storyId: number, userId: number): Promise<WarehouseImageAttempt[]> {
  const story = await getStoryById(storyId, userId);
  if (!story)
    throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在或无权访问" });
  const body = jsonRecord(story.body);
  const tasks = (
    Array.isArray(body.storyboardImageTasks) ? body.storyboardImageTasks : []
  ) as Task[];
  const byId = new Map(tasks.map(task => [task.requestId, task]));
  const rows = (Array.isArray(body.messages) ? body.messages : []).map(
    jsonRecord
  );
  const messages = new Map(rows.map(row => [row.id, row]));
  const shots = new Set(
    (Array.isArray(body.shots) ? body.shots : []).map(shotIdentityFromShot)
  );
  // Before output metadata was recorded, the immutable request ID still identified each paid output.
  const legacy = new Map<string, NonNullable<Task["reviewedOutput"]>>();
  if (tasks.some(task => task.status === "failed" && !task.reviewedOutput)) {
    for (const row of rows) {
      const parsed = chatImageEditPlanSchema.safeParse(row.imageEditPlan);
      if (typeof row.id !== "string" || !parsed.success || parsed.data.status !== "submitted") continue;
      for (const image of parsed.data.images.filter(image => image.role === "target")) {
        for (let copy = 1; copy <= (parsed.data.renderRoute === "storyboard" ? 1 : image.copies); copy++) {
          const output = {planMessageId: row.id, imageId: image.imageId, copy};
          const root = imageEditBatchRequestId(storyId, row.id, image.imageId, copy);
          if (byId.has(root)) legacy.set(root, output);
        }
      }
    }
  }
  const reviewed = tasks.flatMap(first => {
    const output = first.reviewedOutput ?? legacy.get(first.requestId);
    if (
      !output ||
      first.status !== "failed" ||
      imageEditBatchRequestId(
        storyId,
        output.planMessageId,
        output.imageId,
        output.copy
      ) !== first.requestId
    )
      return [];
    const history = imageAttemptHistory(byId, first.requestId);
    const latest = history.at(-1)!;
    const message = messages.get(output.planMessageId);
    const plan = chatImageEditPlanSchema.safeParse(message?.imageEditPlan);
    const origin = output.planMessageId.replace(/^image-edit-confirmed:/, "");
    const selection = jsonRecord(message?.selectionQuote);
    const shotMatches =
      shots.has(first.shotIdentity) &&
      selection.storyId === storyId &&
      selection.stableShotId === first.shotIdentity &&
      latest.shotIdentity === first.shotIdentity;
    const superseded = [
      adjustedImageEditPlanId(output.planMessageId),
      adjustedImageEditPlanId(origin),
      "image-edit-withdrawn:" + origin,
      localEraseReceiptId(origin),
    ].some(id => messages.has(id));
    let offer: ImageRetryOffer | undefined;
    if (
      shotMatches &&
      !superseded &&
      canRetryImage(latest) &&
      plan.success &&
      plan.data.status === "submitted"
    ) {
      const target = plan.data.images.find(
        image => image.imageId === output.imageId && image.role === "target"
      );
      if (
        target &&
        output.copy >= 1 &&
        output.copy <=
          (plan.data.renderRoute === "storyboard" ? 1 : target.copies)
      ) {
        offer = {
          storyId,
          stableShotId: first.shotIdentity,
          ...output,
          failedId: latest.requestId,
          nextId: retryRequestId(latest.requestId),
          unitCny: imageEditPlanQuote(plan.data).unitCny,
        };
      }
    }
    return [
      {
        requestIds: history.map(t => t.requestId),
        requestId: latest.requestId,
        shotId: first.shotIdentity,
        storyId,
        startedAt: latest.createdAt ?? 0,
        status: latest.status,
        offer,
        failureCount: history.filter(t => t.status === "failed").length,
        error:
          latest.result?.status === "error"
            ? imageFailureReason(latest.result.error)
            : undefined,
      },
    ];
  });
  return [...reviewed, ...previewAttempts(storyId, readArtPreviewBatches(body), byId, shots)];
}
