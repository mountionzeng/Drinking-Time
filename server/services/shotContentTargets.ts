/**
 * 按内容找图（免费）：把「森林…，最后云层…」这类话对到本镜的具体图片上，交给用户看缩略图确认。
 * 只读本机图片文件、只在本机算颜色特征；不调用任何模型（没有 runInference），不写库。
 */
import sharp from "sharp";
import type { GeneratedImage } from "../../drizzle/schema";
import { shotIdentityFromShot } from "../../shared/shotIdentity";
import {
  imageSourceTime,
  parseShotContentEdits,
  parseExplicitShotImageEdit,
  proposeContentTargets,
  type ContentEditClause,
  type ContentTargetProposal,
  type ShotImageCandidate,
  type ShotImageSignature,
} from "../../shared/shotContentEdit";
import { getStoryGeneratedImages } from "../repositories/images";
import { getStoryById } from "../repositories/stories";
import { jsonRecord } from "../repositories/storyValues";
import { readStoryImageBytes } from "./chatColorTransfer";

export type ShotFrameRoles = { firstImageId: number | null; lastImageId: number | null; referenceImageIds: number[] };

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** generationParams 既可能是 JSON 字符串也可能是对象；新旧两种键名都认。 */
export function shotFrameRoles(raw: unknown): ShotFrameRoles {
  let params: Record<string, unknown> = {};
  try {
    const parsed = typeof raw === "string" ? (raw.trim() ? JSON.parse(raw) : {}) : raw;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
  } catch { /* 坏 JSON 当作没设 */ }
  const roles = params.storyboardFrameRoles && typeof params.storyboardFrameRoles === "object" && !Array.isArray(params.storyboardFrameRoles)
    ? params.storyboardFrameRoles as Record<string, unknown> : {};
  const refs = Array.isArray(roles.referenceImageIds) ? roles.referenceImageIds : Array.isArray(params.referenceFrameImageIds) ? params.referenceFrameImageIds : [];
  return {
    firstImageId: positiveId(roles.firstImageId ?? params.firstFrameImageId),
    lastImageId: positiveId(roles.lastImageId ?? params.lastFrameImageId),
    referenceImageIds: refs.map(positiveId).filter((id): id is number => id != null),
  };
}

/** 64×64 下的颜色占比：绿（植被）、白（云）、蓝、青、灰（建筑）、细节（噪点）和平均亮度。 */
export async function imageSignature(bytes: Uint8Array): Promise<ShotImageSignature> {
  const size = 64;
  const { data } = await sharp(bytes).toColourspace("srgb").removeAlpha().resize(size, size, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let green = 0, white = 0, blue = 0, cyan = 0, gray = 0, detail = 0, brightness = 0;
  const n = size * size;
  for (let i = 0; i < n; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), v = max, s = max === 0 ? 0 : (max - min) / max;
    let h = 0;
    if (max !== min) {
      const d = max - min;
      h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    brightness += v;
    if (s > 0.18 && v > 0.15 && h >= 65 && h < 170) green++;
    else if (s > 0.18 && v > 0.2 && h >= 170 && h < 200) cyan++;
    else if (s > 0.18 && v > 0.2 && h >= 200 && h < 255) blue++;
    if (s < 0.22 && v > 0.82) white++;
    else if (s < 0.14 && v > 0.3 && v <= 0.82) gray++;
    if (i % size) {
      const j = i - 1;
      detail += Math.abs(data[i * 3] - data[j * 3]) + Math.abs(data[i * 3 + 1] - data[j * 3 + 1]) + Math.abs(data[i * 3 + 2] - data[j * 3 + 2]);
    }
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { green: round(green / n), white: round(white / n), blue: round(blue / n), cyan: round(cyan / n), gray: round(gray / n),
    detail: round(detail / (n * 3 * 255)), brightness: round(brightness / n) };
}

export type ShotContentProposal = {
  stableShotId: string;
  shotNo: number;
  clauses: ContentEditClause[];
  proposals: ContentTargetProposal[];
  images: Array<ShotImageCandidate & { label: string }>;
};

const ROLE_LABEL = { first: "首帧", last: "尾帧", reference: "参考帧", current: "当前图", other: "本镜图片" } as const;

/** 本镜可点名的图：首帧、尾帧、参考帧、当前图，以及本镜的原始图（不含调色/改图派生出来的候选）。 */
export function shotContentImages(images: GeneratedImage[], stableShotId: string, roles: ShotFrameRoles): GeneratedImage[] {
  const named = new Set([roles.firstImageId, roles.lastImageId, ...roles.referenceImageIds].filter((id): id is number => id != null));
  return images.filter(image =>
    named.has(image.id) || (image.shotIdentity === stableShotId && (image.isCurrent || !image.parentImageId)))
    .sort((a,b) => Number(named.has(b.id)) - Number(named.has(a.id)) || Number(b.isCurrent) - Number(a.isCurrent));
}

export async function proposeShotContentEdit(input: {
  storyId: number; userId: number; stableShotId: string; text: string;
  /** 测试用：替换读图。 */
  readBytes?: (image: GeneratedImage) => Promise<Uint8Array>;
}): Promise<ShotContentProposal | { error: string }> {
  const exact = parseExplicitShotImageEdit(input.text);
  const clauses = exact ? [] : parseShotContentEdits(input.text);
  if (!clauses) return { error: "没有听出要改哪部分画面" };
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) return { error: "故事不存在或无权访问" };
  const body = jsonRecord(story.body);
  const shots = Array.isArray(body.shots) ? (body.shots as Record<string, unknown>[]) : [];
  const index = shots.findIndex((shot, i) => shot && shotIdentityFromShot(shot, i) === input.stableShotId);
  if (index < 0) return { error: "这个镜头已经不在当前故事里" };
  const shot = shots[index];
  const roles = shotFrameRoles(shot.generationParams);
  const all = await getStoryGeneratedImages(input.storyId, input.userId);
  if (exact) {
    const shotNo = Number(shot.shotNo) || index + 1;
    const image = all.find(i => i.id === exact.imageId && i.userId === input.userId && i.shotIdentity === input.stableShotId);
    if (!image || exact.shotNo !== shotNo) return { error: "指定图片不属于这个镜头，尚未调用模型 / Image does not belong to this shot; no model was called" };
    return { stableShotId: input.stableShotId, shotNo, clauses: [],
      images: [{ imageId: image.id, imageUrl: image.imageUrl, role: "reference", timeSec: null, signature: null, label: "指定图片 / Selected image" }],
      proposals: [{ imageId: image.id, instruction: input.text, clauses: [], confidence: "high", reasons: [], alternatives: [] }] };
  }
  const images = shotContentImages(all, input.stableShotId, roles).slice(0, 12);
  if (!images.length) return { error: "这一镜还没有图片，先生成或抽帧" };
  const read = input.readBytes ?? (image => readStoryImageBytes(image));
  const candidates: Array<ShotImageCandidate & { label: string }> = [];
  for (const image of images) {
    const role: ShotImageCandidate["role"] = image.id === roles.firstImageId ? "first" : image.id === roles.lastImageId ? "last"
      : roles.referenceImageIds.includes(image.id) ? "reference" : image.isCurrent ? "current" : "other";
    const time = imageSourceTime(image.prompt);
    let signature: ShotImageSignature | null = null;
    try { signature = await imageSignature(await read(image)); } catch { signature = null; }
    candidates.push({ imageId: image.id, imageUrl: image.imageUrl, role, timeSec: time.timelineFrame != null ? time.timelineFrame / 30 : time.sourceSec,
      signature, label: `${ROLE_LABEL[role]}${time.sourceSec != null ? ` · 源 ${time.sourceSec.toFixed(1)}s` : ""}` });
  }
  const brief = [shot.action, shot.videoPrompt, shot.promptDraft].filter(value => typeof value === "string").join("\n");
  return {
    stableShotId: input.stableShotId,
    shotNo: Number(shot.shotNo) || index + 1,
    clauses,
    proposals: proposeContentTargets({ clauses, images: candidates, brief }),
    images: candidates,
  };
}
