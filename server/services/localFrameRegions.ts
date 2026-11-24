import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { FrameRegionTask } from "../../shared/frameRegionReview";
import { regionBoxSchema } from "../../shared/shotObjectTargets";

export function frameRegionRuntime(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  return {
    python: env.FRAME_REGION_PYTHON || (production ? path.resolve(".runtime/frame-regions/bin/python") : "python3"),
    cloudModelPath: path.resolve(env.FRAME_REGION_CLOUD_MODEL_DIR || (production ? ".runtime/frame-regions/models/sam2" : ".webdev/models/sam2")),
    modelPath: path.resolve(env.FRAME_REGION_MODEL_DIR || (production ? ".runtime/frame-regions/models/clipseg" : ".webdev/models/clipseg")),
  };
}

const inspectionSchema = z.array(z.object({ target: z.enum(["forest", "plane", "cloud", "city"]), imageId: z.number(),
  maskPath: z.string(), objectPath: z.string().optional(), protectedPath: z.string(), overlayPath: z.string(), selectedPixels: z.number() }));
// Bound local CPU load; never interpolate instructions into shell commands.
let queue: Promise<unknown> = Promise.resolve();
async function workspace<T>(run: (folder: string) => Promise<T>) {
  const job = queue.then(async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "frame-region-"));
    try { return await run(folder); } finally { await rm(folder, { recursive: true, force: true }); }
  });
  queue = job.catch(() => undefined);
  return job;
}
async function invoke(request: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn(frameRegionRuntime().python, [path.resolve("scripts/frame-regions/worker.py")], {
      stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" },
    });
    let stdout = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("本地定位超时，请减少帧数重试 / Local inspection timed out")); }, 180_000);
    child.stdout.on("data", chunk => { stdout += chunk.toString(); if (stdout.length > 1_000_000) child.kill("SIGKILL"); });
    child.stderr.resume();
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      try { const result = JSON.parse(stdout); if (code !== 0 || result.error) throw new Error(result.error || "Local vision failed"); resolve(result.result); }
      catch (error) { reject(error instanceof Error ? error : new Error("Local vision failed")); }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(request));
  });
}
let objectJobs = 0;
export async function localObjectModelVersion() {
  const { modelPath } = frameRegionRuntime();
  try {
    const versions = await Promise.all(["model.safetensors", "config.json", "preprocessor_config.json",
      "tokenizer_config.json", "special_tokens_map.json", "merges.txt", "vocab.json"].map(async file => {
      const info = await stat(path.join(modelPath, file));
      return [info.size, info.mtimeMs];
    }));
    return [modelPath, versions];
  } catch (cause) {
    throw new Error("本地识别模型尚未就绪。请手动确认本镜调度，或请管理员检查模型安装。", { cause });
  }
}
export async function locateLocalObjects(bytes: Uint8Array, prompts: string[], scope: string) {
  if (objectJobs >= 3) throw new Error("本地识别正在处理其他图片，请稍后重试。");
  objectJobs++;
  return workspace(async folder => {
    const source = path.join(folder, "frame");
    await writeFile(source, bytes);
    const raw = await invoke({ operation: "locate", source, prompts, scope, modelPath: frameRegionRuntime().modelPath,
      cachePath: path.resolve(".webdev/cache/frame-regions") });
    return z.array(z.array(regionBoxSchema).max(3)).length(prompts.length).parse(raw);
  }).finally(() => { objectJobs--; });
}
export async function inspectLocalFrameRegions(frames: { imageId: number; bytes: Uint8Array }[], tasks: (Pick<FrameRegionTask, "target" | "threshold" | "area" | "forestTone"> & { imageId?: number; allowedImageIds?: number[]; greenEdit?: boolean })[]) {
  return workspace(async folder => {
    const inputs = await Promise.all(frames.filter(frame => tasks.some(task => task.imageId ? task.imageId === frame.imageId : !task.allowedImageIds || task.allowedImageIds.includes(frame.imageId))).map(async frame => {
      const file = path.join(folder, `${frame.imageId}.png`); await writeFile(file, frame.bytes);
      return { imageId: frame.imageId, path: file };
    }));
    const result = inspectionSchema.parse(await invoke({ operation: "inspect", cloudModelPath: frameRegionRuntime().cloudModelPath, cachePath: path.resolve(".webdev/cache/frame-regions"), modelPath: frameRegionRuntime().modelPath, output: folder, frames: inputs, tasks }));
    return Promise.all(result.map(async item => ({ ...item, mask: await readFile(item.maskPath), objects: item.objectPath ? await readFile(item.objectPath) : undefined, protection: await readFile(item.protectedPath), overlay: await readFile(item.overlayPath) })));
  });
}
export async function recolorLocalFrameRegion(source: Uint8Array, mask: Uint8Array, protection: Uint8Array, objects?: Uint8Array,
  palette?: { source: Uint8Array; mask: Uint8Array; protection: Uint8Array; objects: Uint8Array }, tone?: FrameRegionTask["forestTone"]) {
  return workspace(async folder => {
    const paths = ["source", "mask", "protected", "objects"].map(name => path.join(folder, `${name}.png`));
    await Promise.all([source, mask, protection, objects ?? mask].map((bytes, i) => writeFile(paths[i], bytes)));
    const reference = palette ? Object.fromEntries(await Promise.all(Object.entries(palette).map(async ([key, bytes]) => {
      const file = path.join(folder, `reference-${key}.png`); await writeFile(file, bytes); return [key, file];
    }))) : undefined;
    const result = z.object({ path: z.string(), changedPixels: z.number(), outsideChangedPixels: z.literal(0), maxLuminanceDrift: z.number() }).parse(await invoke({
      operation: "recolor", source: paths[0], mask: paths[1], protected: paths[2], objects: paths[3], reference, tone, output: folder,
    }));
    return { ...result, bytes: await readFile(result.path) };
  });
}
