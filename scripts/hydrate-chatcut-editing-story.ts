import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const USER_ID = Number(process.env.CHATCUT_USER_ID ?? 48);
const STORY_ID = Number(process.env.CHATCUT_STORY_ID ?? 1163);
const FFMPEG = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";
const SERVER_ORIGIN = process.env.CHATCUT_SERVER_ORIGIN ?? "http://localhost:3000";
const FRAME_DIR = path.join("/private/tmp", `chatcut-story-${STORY_ID}`);
const SEED_PROMPT_PREFIX = "ChatCut 本地素材代理帧";
const VIDEO_PROMPT_PREFIX = "ChatCut 本地原视频";

const FIRST_ACT_VIDEO_DIR =
  "/Users/yuandai/Desktop/根基_可拖拽素材_20260704/01_旧素材_按幕/01_第一幕_被观看_古典剧场/视频";
const SECOND_ACT_VIDEO_DIR =
  "/Users/yuandai/Desktop/根基_可拖拽素材_20260704/01_旧素材_按幕/02_第二幕_被吞噬_抽象赛博动物/视频";
const THIRD_ACT_VIDEO_DIR =
  "/Users/yuandai/Desktop/根基_可拖拽素材_20260704/01_旧素材_按幕/03_第三幕_穿透_黑红版画/视频";
const V02_DIR = "/Users/yuandai/Desktop/V02";
const DOWNLOADS_DIR = "/Users/yuandai/Downloads";

function firstExistingPath(...candidates: string[]) {
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0];
}

const SOURCE_FILES: Record<string, string> = {
  "A_closeup_of_202512212021_6ftdp.mp4": path.join(
    FIRST_ACT_VIDEO_DIR,
    "A_closeup_of_202512212021_6ftdp.mp4"
  ),
  "0102-last-frame.png": path.join(
    process.cwd(),
    ".webdev/images/genji-030-asset.jpg"
  ),
  "jimeng-2025-12-15-5008.mp4": path.join(
    FIRST_ACT_VIDEO_DIR,
    "jimeng-2025-12-15-5008.mp4"
  ),
  "Long_shot_slow_202512251546_p5i.mp4": path.join(
    FIRST_ACT_VIDEO_DIR,
    "Long_shot_slow_202512251546_p5i.mp4"
  ),
  "ameropi87_recreate_the_uploaded_reference_scene_as_closely_as_p_32baeae7-3331-48aa-a4e9-9886a1ea7bd9.webp":
    firstExistingPath(
      path.join(
        V02_DIR,
        "ameropi87_recreate_the_uploaded_reference_scene_as_closely_as_p_32baeae7-3331-48aa-a4e9-9886a1ea7bd9.webp"
      ),
      path.join(
        V02_DIR,
        "1",
        "ameropi87_recreate_the_uploaded_reference_scene_as_closely_as_p_32baeae7-3331-48aa-a4e9-9886a1ea7bd9.webp"
      )
    ),
  "ameropi87_None_26e48eb7-51ee-4d7c-81f5-0799ffa56bf7.webp":
    firstExistingPath(
      path.join(
        V02_DIR,
        "ameropi87_None_26e48eb7-51ee-4d7c-81f5-0799ffa56bf7.webp"
      ),
      path.join(
        V02_DIR,
        "1",
        "ameropi87_None_26e48eb7-51ee-4d7c-81f5-0799ffa56bf7.webp"
      )
    ),
  "c65ffb57-a62b-4a03-ae43-681ba8e923a5_2_720_N.mp4": path.join(
    DOWNLOADS_DIR,
    "c65ffb57-a62b-4a03-ae43-681ba8e923a5_2_720_N.mp4"
  ),
  "Medium_full_shot_202512252029_9gy3h.mp4": path.join(
    THIRD_ACT_VIDEO_DIR,
    "Medium_full_shot_202512252029_9gy3h.mp4"
  ),
  "3c247db7-65dc-4762-9cf9-d576768eb40d_4_720_N (1).mp4": path.join(
    DOWNLOADS_DIR,
    "3c247db7-65dc-4762-9cf9-d576768eb40d_4_720_N (1).mp4"
  ),
  "Low_angle_wide_202512251635_feyoi.mp4": path.join(
    SECOND_ACT_VIDEO_DIR,
    "Low_angle_wide_202512251635_feyoi.mp4"
  ),
  "Closeup_static_.mp4": path.join(FIRST_ACT_VIDEO_DIR, "Closeup_static_.mp4"),
  "03654792603f019f6294a637d09674f5_raw.mp4":
    "/Users/yuandai/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_5ub2ll5vdhox22_0e3d/msg/video/2026-06/03654792603f019f6294a637d09674f5_raw.mp4",
  "清理后的最后一帧.png": path.join(DOWNLOADS_DIR, "清理后的最后一帧.png"),
  "ameropi87_Low_rear_tracking_view_through_a_24mm_wide-angle_lens_4189e90d-85a0-40b3-bce9-f3e9f713397f.webp":
    path.join(
      DOWNLOADS_DIR,
      "ameropi87_Low_rear_tracking_view_through_a_24mm_wide-angle_lens_4189e90d-85a0-40b3-bce9-f3e9f713397f.webp"
    ),
  "ameropi87_Ground-level_tactile_close-up_through_a_100mm_macro_l_61b29f75-6598-4fba-aaba-adffe7acac7b.webp":
    path.join(
      DOWNLOADS_DIR,
      "ameropi87_Ground-level_tactile_close-up_through_a_100mm_macro_l_61b29f75-6598-4fba-aaba-adffe7acac7b.webp"
    ),
  "a1b7c22e-465e-4e04-bf9a-4c1c63f196d4_3_720_N.mp4": path.join(
    DOWNLOADS_DIR,
    "a1b7c22e-465e-4e04-bf9a-4c1c63f196d4_3_720_N.mp4"
  ),
  "Medium_shot_multiple_202512251445_.mp4": path.join(
    FIRST_ACT_VIDEO_DIR,
    "Medium_shot_multiple_202512251445_.mp4"
  ),
  "071095a4-d082-4784-9b8a-64dd0670703b.png": path.join(
    DOWNLOADS_DIR,
    "071095a4-d082-4784-9b8a-64dd0670703b.png"
  ),
  "ameropi87_a_vast_establishing_view_from_deep_inside_the_forest__c73a57ab-1301-469f-8a46-183f903013cc.webp":
    firstExistingPath(
      path.join(
        V02_DIR,
        "ameropi87_a_vast_establishing_view_from_deep_inside_the_forest__c73a57ab-1301-469f-8a46-183f903013cc.webp"
      ),
      path.join(
        V02_DIR,
        "1",
        "ameropi87_a_vast_establishing_view_from_deep_inside_the_forest__c73a57ab-1301-469f-8a46-183f903013cc.webp"
      )
    ),
  "ameropi87_extreme_close-up_from_a_low_side_angle_the_same_woman_3c1e79ec-6602-4fe9-bba6-26a572644195.webp":
    firstExistingPath(
      path.join(
        V02_DIR,
        "ameropi87_extreme_close-up_from_a_low_side_angle_the_same_woman_3c1e79ec-6602-4fe9-bba6-26a572644195.webp"
      ),
      path.join(
        V02_DIR,
        "1",
        "ameropi87_extreme_close-up_from_a_low_side_angle_the_same_woman_3c1e79ec-6602-4fe9-bba6-26a572644195.webp"
      )
    ),
};

const CUE_TEXT: Record<string, string> = {
  "0101": "我害怕所有的事情",
  "0102": "我会反反覆覆的被告知：",
  "0104": "我的一切都需要改造。",
  "0105": "而我总是改造的还是不够好。",
  "0106": "我需要反反覆覆的雕琢自己。",
  "0107-1": "每当我有任何疑虑",
  "0107-2": "他们会第一时间教我千万不要“神经紧张”，",
  "0108": "追求肤浅就能“达到极乐”",
  "0201": "他们会用虚无的标准，把我吞掉。",
  "0202": "他们要求我证明自己。",
  "0203": "要求我解释。",
  "0204": "要求我把自己整理成",
  "0205": "可以被观看、被判断、被通过的样子。",
  "0206": "可真相只能是我自己的感受",
  "0207": "我的恐惧是因为：我看见了我自己",
  "0301": "他们希望把我塑造成一个比他们更低级的物种，成为他们的养料",
  "0302": "当我无处可逃的时候，",
  "0303": "我只能往下走。",
  "0304": "走到身体里，走到泥土里。",
  "0305": "走到那些没有被说出来的地方。",
  "0306": "在那里我看见，她们被放进别人的秩序里。",
  "0307": "但我们都不会消失。",
  "0401": "我们会在任何情况下落地生根。",
  "0402": "森林就在那里。",
  "0403": "我们不需要被允许，才开始生长。",
  "0404": "天既赋予我们生息 我们就能托举自己到任何地方",
};

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trpcData(value: unknown): unknown {
  const response = asRecord(value);
  const result = asRecord(response.result);
  const data = asRecord(result.data);
  return "json" in data ? data.json : result.data;
}

async function trpcQuery(procedure: string, input: RecordValue) {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const response = await fetch(
    `${SERVER_ORIGIN}/api/trpc/${procedure}?input=${encoded}`
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${procedure} 查询失败：${JSON.stringify(payload)}`);
  }
  return trpcData(payload);
}

async function trpcMutation(procedure: string, input: RecordValue) {
  const response = await fetch(`${SERVER_ORIGIN}/api/trpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${procedure} 写入失败：${JSON.stringify(payload)}`);
  }
  return trpcData(payload);
}

function canonicalShotNo(shotNo: number): string {
  return `SH${String(shotNo).padStart(2, "0")}`;
}

function cueCode(name: string): string | null {
  return name.match(/(?:^|\b)VO[-_ ]?(\d{4}(?:-\d)?)/i)?.[1] ?? null;
}

function captureSquareFrame(input: {
  sourcePath: string;
  outputPath: string;
  sourceName: string;
  inFrame: number;
  outFrame: number;
  fps: number;
}) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  const extension = path.extname(input.sourcePath).toLowerCase();
  const isVideo = [".mp4", ".mov", ".webm", ".mkv"].includes(extension);
  if (input.sourceName === "0102-last-frame.png" && isVideo) {
    args.push("-sseof", "-0.08");
  } else if (isVideo) {
    const middleFrame =
      input.inFrame + Math.max(1, (input.outFrame - input.inFrame) / 2);
    args.push("-ss", (middleFrame / input.fps).toFixed(3));
  }
  args.push(
    "-i",
    input.sourcePath,
    "-frames:v",
    "1",
    "-vf",
    "scale=720:720:force_original_aspect_ratio=increase,crop=720:720",
    "-q:v",
    "2",
    input.outputPath
  );
  execFileSync(FFMPEG, args, { stdio: "ignore" });
}

async function main() {
  if (!existsSync(FFMPEG)) throw new Error(`找不到 ffmpeg：${FFMPEG}`);
  const story = asRecord(
    await trpcQuery("storyAgent.storyGet", { id: STORY_ID })
  );
  if (numberValue(story.id) !== STORY_ID) {
    throw new Error(`找不到故事：${STORY_ID}`);
  }

  const body = { ...asRecord(story.body) };
  const chatCutImport = { ...asRecord(body.chatCutImport) };
  const fps = Math.max(1, numberValue(chatCutImport.fps) || 30);
  const audioTracks = Array.isArray(chatCutImport.audioTracks)
    ? chatCutImport.audioTracks.map(asRecord)
    : [];
  const voiceClips = audioTracks
    .flatMap(track =>
      (Array.isArray(track.clips) ? track.clips : []).map(asRecord)
    )
    .flatMap(clip => {
      const code = cueCode(stringValue(clip.name));
      const text = code ? CUE_TEXT[code] : null;
      return code && text
        ? [
            {
              code,
              text,
              startFrame: numberValue(clip.startFrame),
              endFrame: numberValue(clip.endFrame),
            },
          ]
        : [];
    });

  const videoTracks = Array.isArray(chatCutImport.videoTracks)
    ? chatCutImport.videoTracks.map(asRecord)
    : [];
  const primaryTrackIndex = numberValue(chatCutImport.primaryVideoTrackIndex);
  const primaryTrack =
    videoTracks.find(track => numberValue(track.index) === primaryTrackIndex) ??
    videoTracks[0];
  const primaryClips = Array.isArray(primaryTrack?.clips)
    ? primaryTrack.clips.map(asRecord)
    : [];
  const shots = Array.isArray(body.shots) ? body.shots.map(asRecord) : [];

  const nextShots = shots.map((shot, index) => {
    const clip = primaryClips[index];
    if (!clip) return shot;
    const startFrame = numberValue(clip.startFrame);
    const endFrame = numberValue(clip.endFrame);
    const matchingCues = voiceClips.filter(cue => {
      const midpoint = (cue.startFrame + cue.endFrame) / 2;
      return midpoint >= startFrame && midpoint < endFrame;
    });
    return matchingCues.length > 0
      ? {
          ...shot,
          dialogue: matchingCues.map(cue => cue.text).join("\n"),
          voiceCueCodes: matchingCues.map(cue => cue.code),
        }
      : shot;
  });

  const baseRevision =
    numberValue(story.revision) || numberValue(asRecord(story.body)._revision);
  const nextBody = {
    ...body,
    shots: nextShots,
    chatCutImport: {
      ...chatCutImport,
      scriptCues: voiceClips,
    },
  };
  const savedStory = asRecord(
    await trpcMutation("storyAgent.storyUpsert", {
      id: STORY_ID,
      body: nextBody,
      baseRevision,
    })
  );
  if (savedStory.syncConflict === true) {
    throw new Error("故事在补全期间被其他编辑改动，请重新运行脚本");
  }

  mkdirSync(FRAME_DIR, { recursive: true });
  const existingImagesRaw = await trpcQuery("storyAgent.storyImages", {
    storyId: STORY_ID,
  });
  const existingImages = Array.isArray(existingImagesRaw)
    ? existingImagesRaw.map(asRecord)
    : [];
  const materialState = asRecord(
    await trpcQuery("storyAgent.storyMaterialState", { storyId: STORY_ID })
  );
  const materialShots = Array.isArray(materialState.shots)
    ? materialState.shots.map(asRecord)
    : [];
  let created = 0;
  let restored = 0;
  let videosCreated = 0;
  let videosRestored = 0;
  let videosAdopted = 0;
  const missing: string[] = [];

  for (let index = 0; index < primaryClips.length; index += 1) {
    const clip = primaryClips[index];
    const shot = nextShots[index];
    if (!shot) continue;
    const shotNo = numberValue(shot.shotNo) || index + 1;
    const shotIdentity =
      stringValue(shot.stableShotId) || stringValue(shot.shotIdentity);
    const sourceName = stringValue(clip.name);
    const sourcePath = SOURCE_FILES[sourceName];
    if (!shotIdentity || !sourcePath || !existsSync(sourcePath)) {
      missing.push(sourceName || canonicalShotNo(shotNo));
      continue;
    }

    const existing = existingImages
      .filter(
        image =>
          image.shotIdentity === shotIdentity &&
          stringValue(image.prompt).startsWith(SEED_PROMPT_PREFIX)
      )
      .sort((left, right) => numberValue(right.id) - numberValue(left.id))[0];
    if (existing) {
      const assigned = asRecord(
        await trpcMutation("creationAgent.assignStoryImageToShot", {
          storyId: STORY_ID,
          imageId: numberValue(existing.id),
          targetStableShotId: shotIdentity,
        })
      );
      if (assigned.status !== "ok") {
        throw new Error(
          stringValue(assigned.error) ||
            `${canonicalShotNo(shotNo)} 代理帧恢复失败`
        );
      }
      restored += 1;
      continue;
    }

    const outputPath = path.join(
      FRAME_DIR,
      `${canonicalShotNo(shotNo)}-${stringValue(clip.id) || index + 1}.jpg`
    );
    captureSquareFrame({
      sourcePath,
      outputPath,
      sourceName,
      inFrame: numberValue(clip.inFrame),
      outFrame: numberValue(clip.outFrame),
      fps,
    });
    const imported = asRecord(
      await trpcMutation("creationAgent.importStoryMaterial", {
        storyId: STORY_ID,
        fileName: `${canonicalShotNo(shotNo)}-${sourceName}.jpg`,
        mimeType: "image/jpeg",
        fileBase64: readFileSync(outputPath).toString("base64"),
        targetStableShotId: shotIdentity,
        note: `${SEED_PROMPT_PREFIX}：${sourceName}`,
      })
    );
    if (imported.status !== "ok" || numberValue(imported.imageId) <= 0) {
      throw new Error(
        stringValue(imported.error) ||
          `${canonicalShotNo(shotNo)} 代理帧导入失败`
      );
    }
    created += 1;
  }

  for (let index = 0; index < primaryClips.length; index += 1) {
    const clip = primaryClips[index];
    const shot = nextShots[index];
    if (!shot || stringValue(clip.mediaKind) !== "video") continue;
    const shotNo = numberValue(shot.shotNo) || index + 1;
    const shotIdentity =
      stringValue(shot.stableShotId) || stringValue(shot.shotIdentity);
    const sourceName = stringValue(clip.name);
    const sourcePath = SOURCE_FILES[sourceName];
    if (!shotIdentity || !sourcePath || !existsSync(sourcePath)) {
      missing.push(sourceName || canonicalShotNo(shotNo));
      continue;
    }
    const materialShot = materialShots.find(
      candidate => candidate.stableShotId === shotIdentity
    );
    const videoTakes = Array.isArray(materialShot?.videoTakes)
      ? materialShot.videoTakes.map(asRecord)
      : [];
    const existingVideo = videoTakes
      .filter(
        take =>
          take.status === "available" &&
          stringValue(take.prompt).startsWith(VIDEO_PROMPT_PREFIX)
      )
      .sort((left, right) => numberValue(right.id) - numberValue(left.id))[0];
    const plannedDurationSec = Math.min(
      30,
      Math.max(
        0.1,
        (numberValue(clip.endFrame) - numberValue(clip.startFrame)) / fps
      )
    );
    if (existingVideo) {
      const adopted = asRecord(
        await trpcMutation("creationAgent.adoptVideoTake", {
          storyId: STORY_ID,
          stableShotId: shotIdentity,
          takeId: numberValue(existingVideo.id),
          plannedDurationSec,
        })
      );
      if (adopted.status !== "ok") {
        throw new Error(
          stringValue(adopted.error) ||
            `${canonicalShotNo(shotNo)} 原视频恢复失败`
        );
      }
      videosRestored += 1;
      videosAdopted += 1;
      continue;
    }

    const imported = asRecord(
      await trpcMutation("creationAgent.importStoryMaterial", {
        storyId: STORY_ID,
        fileName: sourceName,
        mimeType: "video/mp4",
        fileBase64: readFileSync(sourcePath).toString("base64"),
        targetStableShotId: shotIdentity,
        note: `${VIDEO_PROMPT_PREFIX}：${sourceName}`,
      })
    );
    if (imported.status !== "ok" || imported.kind !== "video") {
      throw new Error(
        stringValue(imported.error) ||
          `${canonicalShotNo(shotNo)} 原视频导入失败`
      );
    }
    const adopted = asRecord(
      await trpcMutation("creationAgent.adoptVideoTake", {
        storyId: STORY_ID,
        stableShotId: shotIdentity,
        takeId: numberValue(imported.takeId),
        plannedDurationSec,
      })
    );
    if (adopted.status !== "ok") {
      throw new Error(
        stringValue(adopted.error) ||
          `${canonicalShotNo(shotNo)} 原视频采用失败`
      );
    }
    videosCreated += 1;
    videosAdopted += 1;
  }

  console.log(
    JSON.stringify(
      {
        storyId: STORY_ID,
        userId: USER_ID,
        revision: numberValue(asRecord(savedStory.body)._revision),
        scriptCueCount: voiceClips.length,
        shotCount: nextShots.length,
        proxyFramesCreated: created,
        proxyFramesRestored: restored,
        videosCreated,
        videosRestored,
        videosAdopted,
        missingSources: Array.from(new Set(missing)),
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
