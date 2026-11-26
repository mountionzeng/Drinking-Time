import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { readBookShotChapter, shotDirections, shotMediaDirections, type BookShotChapter } from "../../shared/bookShotDocument";
import { recordStoryboardFieldVersions, STORYBOARD_VERSIONED_FIELDS } from "../../shared/storyboardFieldVersions";
import { getStoryById } from "../repositories/stories";
import { listChapters } from "../repositories/chapters";
import { getStoryImageAssets } from "./imageAssets";
import { inheritBookFrameParameters } from "./bookVideoShotContinuity";
import { getStoryRevision } from "./storySync";
import { persistPreparedStoryBody, StoryBodyRevisionConflictError } from "./storyBodyPersistence";
import { loadOwnedStoryTimelineEnvelope } from "../persistence/storyVisualPersistence";
import { updateStoryAndTimelineAtomic } from "../repositories/timelines";

type Data = Record<string, unknown>;
function record(value: unknown): Data {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
}
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function linkedShotChanges(body: Data, chapters: BookShotChapter[], images: Map<string, number>, userId: number, storyId: number) {
  const pages = new Map(chapters.flatMap(c => readBookShotChapter(c).shots.map(s => [s.id, s] as const)));
  const previous = Array.isArray(body.shots) ? body.shots.map(record) : [];
  const baselines = {...record(body.bookShotSourceHashes)};
  let changed = false;
  const pictures = new Map<string, {before: number[]; after: number[]}>();
  const shots = previous.map(shot => {
    const link = record(shot.publishingVideo);
    const source = pages.get(String(link.draftShotId));
    if (!source || !Array.isArray(link.sourceModuleIds)) return shot;
    const key = String(shot.stableShotId);
    const last = record(baselines[key]);
    const next = {...shot};
    const hashes: Data = {...last};
    const dirs = shotDirections(source.notes);
    const media = shotMediaDirections(dirs, source.title);
    const timing = dirs.timing.filter(line => /旁白|对白|开口|收住|风声|音效|音乐|声音|静音|静默|说完/.test(line));
    const values = {
      promptDraft: media.picture,
      videoPrompt: media.video,
      cameraMove: dirs.motion.join("\n"),
      dialogue: source.dialogueText,
      sound: [...dirs.sound, ...timing, ...source.audio.filter(a=>a.storyId===storyId).map(a=>a.label+"："+a.title+" "+a.url)].join("\n"),
      scriptText: source.text,
    };
    for (const [field, value] of Object.entries(values)) {
      const hash = fingerprint(value);
      if (last[field] === hash) continue;
      hashes[field] = hash;
      // A projection upgrade must not replace an independent edit to a previously synced field.
      const legacy = field === "promptDraft" ? [...dirs.other, ...dirs.picture].join("\n") || source.title :
        field === "videoPrompt" ? dirs.motion.join("\n") || dirs.picture.filter(line => /静止|固定镜头|推近|拉远|摇镜|移镜|跟拍|跟随|平移|切到|切回|切入|叠化|淡出|淡入/.test(line)).join("\n") : undefined;
      if (legacy === undefined || last[field] !== fingerprint(legacy) || shot[field] === legacy) next[field] = value;
      changed = true;
    }
    const ids = [...new Set(source.images.map(i=>images.get(i.url)).filter((id): id is number=>id !== undefined))];
    const previousIds = Array.isArray(link.referenceImageIds) ? link.referenceImageIds.filter((n): n is number=>typeof n === "number") : [];
    const refs = fingerprint(ids);
    const meta = {...link, sourceModuleIds: source.sourceModuleIds};
    if (source.images.every(i=>images.has(i.url)) && last.images !== refs) {
      hashes.images = refs;
      Object.assign(meta,{referenceImageIds: ids, referenceImageId: ids[0]});
      next.generationParams = inheritBookFrameParameters(shot.generationParams,{referenceFrameImageIds:previousIds},{referenceFrameImageIds:ids});
      pictures.set(key,{before:previousIds,after:ids});
      changed = true;
    }
    if (JSON.stringify(source.sourceModuleIds) !== JSON.stringify(link.sourceModuleIds)) changed = true;
    next.publishingVideo = meta;
    baselines[key] = hashes;
    return next;
  });
  if (!changed) return;
  return { pictures, body:{...body, shots, bookShotSourceHashes:baselines, storyboardFieldVersions:recordStoryboardFieldVersions({
    state:body.storyboardFieldVersions, beforeShots:previous, afterShots:shots, fields:STORYBOARD_VERSIONED_FIELDS,
    now:Date.now(),source:"edited",editorUserId:userId
  })}};
}

export async function syncLinkedShots(owner: {storyId:number; userId:number}) {
  for (let attempt=0; attempt<4; attempt++) {
    const story = await getStoryById(owner.storyId,owner.userId);
    if (!story) throw new TRPCError({code:"NOT_FOUND"});
    const body = record(story.body);
    if (!Array.isArray(body.shots) || !body.shots.some(s=>String(record(record(s).publishingVideo).draftShotId ?? "").startsWith("book-shot-"))) return;
    const chapters = await listChapters(owner.storyId,owner.userId,"storyboard");
    const assets = await getStoryImageAssets(owner.storyId,owner.userId);
    const changes = linkedShotChanges(body,chapters,new Map(assets.filter(a=>a.availability!=="missing" && a.status!=="rejected").map(a=>[a.imageUrl,a.id])),owner.userId,owner.storyId);
    if (!changes) return;
    const revision = getStoryRevision(body);
    const nextStoryBody = {...changes.body,_revision:revision+1};
    if (changes.pictures.size) {
      const timeline = await loadOwnedStoryTimelineEnvelope(owner);
      if (timeline && Array.isArray(timeline.items)) {
        let updated = false;
        const items = timeline.items.map(item=>{
          const ref = changes.pictures.get(item.stableShotId);
          if (!ref || (item.referencedImageId != null && !ref.before.includes(item.referencedImageId)) || (item.referencedImageId ?? null)===(ref.after[0] ?? null)) return item;
          updated = true;
          return {...item,referencedImageId:ref.after[0] ?? null};
        });
        if (updated) {
          try {
            await updateStoryAndTimelineAtomic({...owner,expectedStoryRevision:revision,expectedTimelineVersion:timeline.version,
              nextStoryBody,nextTimeline:{items,overlays:timeline.overlays,visualLayerState:timeline.visualLayerState},recordVideoRevision:true});
            return;
          } catch (error) {
            if (error instanceof Error && /^(故事|时间轴)已经更新/.test(error.message)) continue;
            throw error;
          }
        }
      }
    }
    try {
      await persistPreparedStoryBody({...owner,expectedRevision:revision, body:nextStoryBody});
      return;
    } catch (error) { if (!(error instanceof StoryBodyRevisionConflictError)) throw error; }
  }
  throw new TRPCError({code:"CONFLICT",message:"书稿或剪辑正在更新，请稍后重试。"});
}
