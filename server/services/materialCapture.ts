import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { TRPCError } from "@trpc/server";
import { captureInputSchema, CAPTURE_MAX_FILE_BYTES, CAPTURE_MAX_TOTAL_BYTES, type CaptureInput, type CaptureReceipt, type CaptureManifest } from "../../shared/materialCapture";
import { insertCapture, readCapture, insertCaptureToken, readCaptureToken } from "../repositories/materialCaptures";
import { probeStagedAudio } from "./audioMedia";
import { consumePersistentRateLimit } from "../repositories/accounts";

export async function captureRateLimit(userId:number, purpose:"receive"|"token") {
  const decision=await consumePersistentRateLimit({scope:`material-capture:${purpose}`,subject:String(userId),windowSeconds:3600,maxAttempts:purpose === "receive" ? 30 : 10});
  if(!decision.allowed)throw new TRPCError({code:"TOO_MANY_REQUESTS",message:"本小时发送较多，原素材仍在，请稍后再试"});
}

export const captureHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const root = () => {
  const configured = process.env.MATERIAL_CAPTURE_DIR;
  if(process.env.NODE_ENV === "production" && (!configured || !path.isAbsolute(configured)))
    throw new TRPCError({code:"PRECONDITION_FAILED",message:"素材存储尚未配置，请先保留原件"});
  return configured || (process.env.LOCAL_PERSIST_PATH ? `${process.env.LOCAL_PERSIST_PATH}.capture-files` : path.join(process.cwd(), ".webdev", "private-captures"));
};
function filePath(userId: number, sha: string) {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !/^[a-f0-9]{64}$/.test(sha)) throw new Error("Invalid capture path");
  return path.join(root(), String(userId), sha);
}
const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });

async function validateFile(file: CaptureInput["files"][number], bytes: Buffer, staged: string) {
  if (file.mime.startsWith("image/")) {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || meta.width * meta.height > 40_000_000 || (meta.pages ?? 1) > 1) throw bad("请使用单张静态图片（不超过4000万像素）");
    const expected = file.mime === "image/jpeg" ? "jpeg" : file.mime.split("/")[1];
    if (meta.format !== expected) throw bad("图片格式与文件内容不一致");
    await image.stats(); // Force decoding before accepting the original.
  } else {
    const facts = await probeStagedAudio(staged);
    if (facts.durationSeconds > 600) throw bad("单段录音最长10分钟，请拆分后发送");
  }
}

/** Files are immutable and private. Only a persisted, owned manifest grants read access. */
export async function receiveCapture(userId: number, untrusted: CaptureInput): Promise<CaptureReceipt> {
  const input = captureInputSchema.parse(untrusted);
  const decoded = input.files.map(file => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) throw bad("素材编码无效");
    const bytes = Buffer.from(file.base64,"base64");
    if (!bytes.length) throw bad("素材为空");
    if(bytes.length>CAPTURE_MAX_FILE_BYTES)throw bad("单份素材最多8MB");
    return { file, bytes, sha256: captureHash(bytes) };
  });
  if (decoded.reduce((sum,item) => sum + item.bytes.length,0) > CAPTURE_MAX_TOTAL_BYTES) throw bad("一批素材最多20MB，请分批发送");
  const manifest: CaptureManifest = { origin: input.origin, text: input.text, files: decoded.map(({file,bytes,sha256}) => ({ id: file.id, name: file.name, mime: file.mime, bytes: bytes.length, sha256 })) };
  const inputHash = captureHash(JSON.stringify(manifest));
  try {
    const existing = await readCapture(userId,input.id);
    if (existing.inputHash !== inputHash) throw new TRPCError({ code: "CONFLICT", message: "这批素材已提交，不能更换内容" });
    return toCaptureReceipt(existing);
  } catch (error) { if (!(error instanceof TRPCError) || error.code !== "NOT_FOUND") throw error; }
  await captureRateLimit(userId,"receive");
  for (const {file,bytes,sha256} of decoded) {
    const destination = filePath(userId,sha256), staged = `${destination}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(destination),{ recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(staged,bytes,{ mode: 0o600 });
      await validateFile(file,bytes,staged);
      await fs.rename(staged,destination);
    } finally { await fs.rm(staged,{force:true}); }
  }
  return toCaptureReceipt(await insertCapture({ id: input.id, userId, inputHash, status: "received", manifest, progress: { evidence: input.text.trim() ? [{ sourceId: "text", kind: "user-text", text: input.text }] : [] }, storyId: null, createdAt: new Date(), updatedAt: new Date() }));
}

export function toCaptureReceipt(row: CaptureReceipt): CaptureReceipt {
  const {id,status,manifest,progress,storyId,createdAt,updatedAt} = row;
  // A crashed worker is never silently replayed, even after its lease would expire.
  return {id,status: status === "processing" && Date.now() - +updatedAt > 10*60_000 ? (progress.transcriptionTasks?.[progress.activeStep || ""] ? "received" : "uncertain") : status,manifest,progress,storyId,createdAt,updatedAt};
}
export async function readCaptureOriginal(userId: number, id: string, sourceId: string) {
  const capture = await readCapture(userId,id);
  const file = capture.manifest.files.find(item => item.id === sourceId);
  if (!file) throw new TRPCError({code:"NOT_FOUND",message:"素材不存在"});
  const bytes = await fs.readFile(filePath(userId,file.sha256));
  if (captureHash(bytes) !== file.sha256) throw new Error("原素材校验失败，请联系支持；尚未重新整理");
  return {file,bytes};
}
export async function createCaptureToken(userId: number) {
  await captureRateLimit(userId,"token");
  const token = `sgcapture_${randomBytes(32).toString("base64url")}`;
  const createdAt = new Date(), expiresAt = new Date(+createdAt + 90*24*60*60_000);
  await insertCaptureToken({ hash: captureHash(token), userId, createdAt, expiresAt, revokedAt: null });
  return { token, expiresAt };
}
export async function authenticateCaptureToken(token: string) {
  if (!/^sgcapture_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await readCaptureToken(captureHash(token));
  return row && !row.revokedAt && +row.expiresAt > Date.now() ? row.userId : null;
}
