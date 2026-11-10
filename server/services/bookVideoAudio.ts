import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import { wholeBookSoundText } from "../../shared/bookSound";
import { readBookAudio } from "../../shared/bookAudioBlock";
import { writingModuleTexts } from "../../shared/bookWritingStyle";
import {
  bookVoiceLines,
  planBookAudioPacing,
  type AlignedBookLine,
  type BookAudioPacing,
  type BookAudioShot,
  type PreparedBookVideoAudio,
} from "../../shared/bookVideoAudio";
import { resolveManagedAudioPath } from "./audioMedia";
import {
  checksumManagedAudio,
  findReusableReadyStoryAudioAsset,
  listOwnedStoryAudioAssets,
  type StoryAudioAssetScope,
} from "./storyAudioAssets";
import { importAudioBytes } from "./storyAudioImport";

const run = promisify(execFile);
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textHash = (text: string) =>
  createHash("sha256").update(text.trim()).digest("hex");
const jobs = new Map<string, Promise<PreparedBookVideoAudio | undefined>>();
type Input = StoryAudioAssetScope & {
  chapters: Parameters<typeof wholeBookSoundText>[0];
  shots: BookAudioShot[];
  musicAssetIds: number[];
};

/** This work finishes before replacing the active video. No provider or billing calls. */
export function prepareBookVideoAudio(input: Input) {
  const key = digest(input);
  const existing = jobs.get(key);
  if (existing) return existing;
  if (jobs.size >= 1)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "正在处理其他作品的声音，请稍后重试。",
    });
  const job = prepare(input).finally(() => jobs.delete(key));
  jobs.set(key, job);
  return job;
}

export function narrationFilter(plan: BookAudioPacing) {
  const n = plan.lines.length;
  const filters = [
    `[0:a]aresample=24000,asplit=${n}${plan.lines.map((_, i) => `[s${i}]`).join("")}`,
  ];
  plan.lines.forEach((line, i) =>
    filters.push(
      `[s${i}]atrim=start=${line.cutStart}:end=${line.cutEnd},asetpts=PTS-STARTPTS,atempo=${plan.speed},apad=whole_len=${line.audioFrames * 800},atrim=end_sample=${line.audioFrames * 800},adelay=${line.audioStartFrame * 800}S:all=1[a${i}]`
    )
  );
  filters.push(
    `${plan.lines.map((_, i) => `[a${i}]`).join("")}amix=inputs=${n}:normalize=0:duration=longest,apad=whole_len=${plan.durationFrames * 800},atrim=end_sample=${plan.durationFrames * 800}[out]`
  );
  return filters.join(";\n");
}

export function musicFilter(sourceSeconds: number, durationFrames: number) {
  const target = durationFrames / 30;
  if (
    !Number.isFinite(sourceSeconds) ||
    sourceSeconds < 1 ||
    target <= 0 ||
    target > 1800
  )
    throw new Error("配乐时长无法处理，请检查音频素材。");
  const overlap = Math.min(1.2, sourceSeconds / 4);
  const count = Math.max(
    1,
    Math.ceil((target - overlap) / (sourceSeconds - overlap))
  );
  if (count > 200) throw new Error("配乐过短，请选择更完整的片段。");
  const filters = [
    `[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=${count}${Array.from({ length: count }, (_, i) => `[m${i}]`).join("")}`,
  ];
  let last = "m0";
  for (let i = 1; i < count; i++) {
    filters.push(
      `[${last}][m${i}]acrossfade=d=${overlap}:c1=tri:c2=tri[x${i}]`
    );
    last = `x${i}`;
  }
  filters.push(
    `[${last}]atrim=duration=${target},afade=t=in:d=${Math.min(0.8, target / 4)},afade=t=out:st=${Math.max(0, target - 2)}:d=${Math.min(2, target)}[out]`
  );
  return filters.join(";\n");
}

async function render(
  inputPath: string,
  filter: string,
  dir: string,
  name: string
) {
  const graph = path.join(dir, `${name}.txt`),
    output = path.join(dir, `${name}.wav`);
  await writeFile(graph, filter);
  await run(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-filter_complex_script",
      graph,
      "-map",
      "[out]",
      "-c:a",
      "pcm_s16le",
      output,
    ],
    { timeout: 180_000, maxBuffer: 1024 * 1024 }
  );
  return readFile(output);
}

async function prepare(
  input: Input
): Promise<PreparedBookVideoAudio | undefined> {
  const assets = await listOwnedStoryAudioAssets(input);
  const references = input.chapters
    .flatMap(chapter =>
      writingModuleTexts(chapter.blocks.body, chapter.blocks.writingStyle)
    )
    .map(readBookAudio)
    .filter(ref => ref?.storyId === input.storyId);
  const narrationIds = new Set(
    references.filter(ref => ref?.kind === "narration").map(ref => ref!.assetId)
  );
  const text = wholeBookSoundText(input.chapters, true);
  const candidates = assets.filter(asset => {
    const p = asset.provenance as {
      bookTarget?: { wholeBook?: { kind?: string; dialogueOnly?: boolean } };
    } | null;
    return (
      asset.status === "ready" &&
      narrationIds.has(asset.id) &&
      p?.bookTarget?.wholeBook?.kind === "storyboard" &&
      p.bookTarget.wholeBook.dialogueOnly
    );
  });
  const narration = candidates
    .filter(
      asset =>
        (asset.provenance as { textHash?: string })?.textHash === textHash(text)
    )
    .sort((a, b) => b.id - a.id)[0];
  if (!narration && candidates.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "整书台词录音与当前稿件不一致，请先更新台词声音；当前视频仍保留。",
    });
  if (
    narration &&
    bookVoiceLines(text).join("\n") !==
      input.shots.flatMap(shot => bookVoiceLines(shot.voiceText)).join("\n")
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "分镜台词顺序与整书录音不一致，请先核对；当前视频仍保留。",
    });
  if (!narration && !input.musicAssetIds.length) return undefined;
  const result: PreparedBookVideoAudio = {
    version: 1,
    shots: input.shots.map(shot => ({
      draftShotId: shot.draftShotId,
      durationFrames: Math.round((shot.durationSec ?? 5) * 30),
    })),
    durationFrames: 0,
    music: [],
  };
  result.durationFrames = result.shots.reduce(
    (sum, shot) => sum + shot.durationFrames,
    0
  );
  const dir = await mkdtemp(path.join(os.tmpdir(), "book-video-audio-"));
  try {
    if (narration) {
      const checksum = await checksumManagedAudio(narration.storageKey);
      const sourceKey = `book-video-voice-v1:${digest({ checksum, shots: input.shots, speed: 0.9 })}`;
      let asset = await findReusableReadyStoryAudioAsset({
        scope: input,
        sourceKind: "tts",
        sourceKey,
      });
      let pacing = (asset?.provenance as { pacing?: BookAudioPacing } | null)
        ?.pacing;
      if (asset && pacing)
        await access(resolveManagedAudioPath(asset.storageKey));
      else {
        const request = path.join(dir, "request.json"),
          output = path.join(dir, "aligned.json");
        await writeFile(
          request,
          JSON.stringify({
            audioPath: resolveManagedAudioPath(narration.storageKey),
            lines: bookVoiceLines(text),
            modelPath:
              process.env.BOOK_VIDEO_WHISPER_MODEL ||
              (process.env.NODE_ENV === "production"
                ? path.join(process.cwd(), ".runtime", "book-video-audio", "base.pt")
                : path.join(os.homedir(), ".cache", "whisper", "base.pt")),
          })
        );
        await run(
          process.env.BOOK_VIDEO_PYTHON || (process.env.NODE_ENV === "production"
            ? path.join(process.cwd(), ".runtime", "book-video-audio", "bin", "python")
            : "python3"),
          [
            path.join(process.cwd(), "scripts", "align-book-narration.py"),
            request,
            output,
          ],
          { timeout: 300_000, maxBuffer: 1024 * 1024 }
        );
        pacing = planBookAudioPacing(
          input.shots,
          JSON.parse(await readFile(output, "utf8")) as AlignedBookLine[]
        );
        const bytes = await render(
          resolveManagedAudioPath(narration.storageKey),
          narrationFilter(pacing),
          dir,
          "narration"
        );
        const imported = await importAudioBytes({
          scope: input,
          operationId: randomUUID(),
          sourceKind: "tts",
          sourceKey,
          displayName: `${narration.displayName} · 视频慢速停顿版`,
          mediaKind: "narration",
          bytes,
          provenance: {
            kind: "book-video-audio",
            version: 1,
            sourceAssetId: narration.id,
            sourceChecksum: checksum,
            pacing,
          },
        });
        if (imported.status !== "ready") throw new Error(imported.reason);
        asset = imported.asset;
      }
      if (
        !asset ||
        !pacing ||
        (asset.durationFrames ?? 0) < pacing.durationFrames
      )
        throw new Error("处理后的台词不完整。");
      result.shots = pacing.shots;
      result.durationFrames = pacing.durationFrames;
      result.narration = {
        assetId: asset.id,
        sourceAssetId: narration.id,
        speed: pacing.speed,
        lines: pacing.lines,
      };
    }
    for (const id of [...new Set(input.musicAssetIds)]) {
      const original = assets.find(
        asset => asset.id === id && asset.status === "ready"
      );
      if (!original) throw new Error("书内配乐无法读取。");
      const checksum = await checksumManagedAudio(original.storageKey);
      const sourceKey = `book-video-music-v1:${digest({ checksum, durationFrames: result.durationFrames })}`;
      let asset = await findReusableReadyStoryAudioAsset({
        scope: input,
        sourceKind: "tts",
        sourceKey,
      });
      if (asset) await access(resolveManagedAudioPath(asset.storageKey));
      else {
        const bytes = await render(
          resolveManagedAudioPath(original.storageKey),
          musicFilter(Number(original.durationSeconds), result.durationFrames),
          dir,
          `music-${id}`
        );
        const imported = await importAudioBytes({
          scope: input,
          operationId: randomUUID(),
          sourceKind: "tts",
          sourceKey,
          bytes,
          displayName: `${original.displayName} · 全片配乐`,
          mediaKind: "music",
          provenance: {
            kind: "book-video-audio",
            version: 1,
            sourceAssetId: id,
            sourceChecksum: checksum,
            durationFrames: result.durationFrames,
            crossfadeSeconds: Math.min(
              1.2,
              Number(original.durationSeconds) / 4
            ),
          },
        });
        if (imported.status !== "ready") throw new Error(imported.reason);
        asset = imported.asset;
      }
      if ((asset.durationFrames ?? 0) < result.durationFrames)
        throw new Error("延长后的配乐不足全片时长。");
      result.music.push({ assetId: asset.id, sourceAssetId: id });
    }
    return result;
  } catch (error) {
    const processError = error as {
      code?: string;
      killed?: boolean;
      stderr?: string;
    };
    const lastLine = processError.stderr?.trim().split("\n").at(-1);
    const detail = processError.killed
      ? "声音处理超时，请重试。"
      : processError.code === "ENOENT" ||
          processError.stderr?.includes("ModuleNotFoundError")
        ? "本机的语音对齐或音频处理工具尚未配置完整。"
        : lastLine
          ? /[\u4e00-\u9fff]/.test(lastLine)
            ? lastLine
            : "音频无法完成处理，请检查素材或本机工具配置。"
          : error instanceof Error
            ? error.message
            : "音频处理失败";
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `声音节奏调整未完成，当前视频仍保留。${detail.slice(-800)}`,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
