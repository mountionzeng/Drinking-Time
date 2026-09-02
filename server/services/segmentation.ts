/**
 * fal.ai SAM 2 segmentation service
 * Accepts image + click coordinates, returns a mask image for the selected object.
 * Injectable fetcher for testing, normalized status union, never throws.
 * Includes circuit breaker after consecutive failures (10-minute cooldown).
 */

import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import sharp from "sharp";
import { ENV } from "../_core/env";
import { storageGet, storagePut } from "../storage";
import {
  canonicalizeEditMask,
  type SourceMaskPoint,
} from "./imageEditMask";
import { localImageDir } from "./imageGen";
import { invokeVisionJson, visionChannelConfigured } from "./visionChannel";

// ── Types ──

export type SegmentationStatus = "ok" | "error";

export interface SegmentationResult {
  status: SegmentationStatus;
  maskUrl?: string | null;
  maskKey?: string | null;
  previewMaskUrl?: string | null;
  previewMaskKey?: string | null;
  width?: number;
  height?: number;
  message?: string;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface SegmentationOptions {
  fetcher?: Fetcher;
  sourceBytes?: Uint8Array;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  scope?: { userId: number; storyId: number; imageId: number };
  /** Test seam. Production always resolves remote hosts before downloading. */
  resolveRemoteHosts?: boolean;
  /** Server-derived lasso constraint. Never sent as a provider-owned mask. */
  selectionPolygon?: SourceMaskPoint[];
}

// ── Constants ──

const SAM2_URL = "https://queue.fal.run/fal-ai/sam2";
const TIMEOUT_MS = 30_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;
const VISION_COORDINATE_RANGE = 1000;
const VISION_MAX_IMAGE_EDGE = 1_600;
const VISION_MAX_CONTOUR_POINTS = 256;

type VisionContourResponse = {
  found: boolean;
  anchor: { x: number; y: number };
  contour: Array<{ x: number; y: number }>;
};

// ── Circuit breaker state ──

let consecutiveFailures = 0;
let circuitBreakerOpenUntil: number | null = null;

export function isCircuitOpen(): boolean {
  if (circuitBreakerOpenUntil === null) return false;
  if (Date.now() >= circuitBreakerOpenUntil) {
    circuitBreakerOpenUntil = null;
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreakerOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    console.warn(
      `[segmentation] Circuit breaker opened after ${consecutiveFailures} consecutive failures`,
    );
  }
}

/** Reset circuit breaker — intended for testing only */
export function resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
}

/** A vision model is a semantic fallback for lasso selection, never a raw-mask fallback. */
export function semanticObjectSelectionConfigured(): boolean {
  return Boolean(ENV.falApiKey) || visionChannelConfigured();
}

// ── Helpers ──

function buildHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${ENV.falApiKey}`,
    "Content-Type": "application/json",
  };
}

function makeMaskKey(
  kind: "edit" | "preview",
  scope?: SegmentationOptions["scope"]
): string {
  const owner = scope
    ? `${scope.userId}/${scope.storyId}/${scope.imageId}`
    : "legacy";
  return `masks/${owner}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${kind}.png`;
}

function localMaskFileName(maskKey: string): string {
  const match = maskKey.match(
    /^masks\/(?:legacy|\d+\/\d+\/\d+)\/[a-zA-Z0-9_-]+-(edit|preview)\.png$/
  );
  if (!match) throw new Error("蒙版存储标识无效");
  const digest = createHash("sha256").update(maskKey).digest("hex").slice(0, 24);
  return `mask-${digest}-${match[1]}.png`;
}

async function storeMaskBytes(
  maskKey: string,
  bytes: Uint8Array
): Promise<{ key: string; url: string }> {
  const fileName = localMaskFileName(maskKey);
  if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
    const directory = localImageDir();
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, fileName), bytes);
  }

  // Selection must stay usable when the legacy 302 storage proxy is down.
  // Remote storage is only a best-effort backup; paid edits read this same
  // deterministic local file first.
  void storagePut(maskKey, bytes, "image/png").catch(error => {
    if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
      console.warn(
        "[segmentation] 远程蒙版备份失败（本地蒙版仍可用）：",
        error instanceof Error ? error.message : String(error)
      );
    }
  });
  return { key: maskKey, url: `/api/images/${fileName}` };
}

export async function resolveStoredMaskUrl(maskKey: string): Promise<string> {
  const fileName = localMaskFileName(maskKey);
  try {
    await fs.access(path.join(localImageDir(), fileName));
    return `/api/images/${fileName}`;
  } catch {
    return (await storageGet(maskKey)).url;
  }
}

function dataImageBytes(value: string): Uint8Array | null {
  const match = value.match(/^data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)$/);
  return match ? new Uint8Array(Buffer.from(match[1], "base64")) : null;
}

function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function isUnsafeAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedV4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedV4) return isUnsafeAddress(mappedV4);
  if (net.isIP(normalized) === 4) {
    const [first, second] = normalized.split(".").map(Number);
    return (
      isUnsafeHost(normalized) ||
      first === 0 ||
      first === 100 && second >= 64 && second <= 127 ||
      first === 169 && second === 254 ||
      first === 198 && (second === 18 || second === 19) ||
      first >= 224
    );
  }
  if (net.isIP(normalized) !== 6) return true;
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

async function safeRemoteUrl(value: string, resolveRemoteHosts: boolean): Promise<URL> {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.port !== "" && url.port !== "443") ||
    isUnsafeHost(url.hostname) ||
    (net.isIP(url.hostname) !== 0 && isUnsafeAddress(url.hostname))
  ) {
    throw new Error("远程地址不安全");
  }
  if (!resolveRemoteHosts) return url;
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some(record => isUnsafeAddress(record.address))) {
    throw new Error("远程地址不安全");
  }
  return url;
}

async function fetchAndRead<T>(input: {
  fetcher: Fetcher;
  url: string;
  init?: RequestInit;
  resolveRemoteHosts: boolean;
  timeoutMs: number;
  read: (response: FetchResponseLike) => Promise<T>;
}): Promise<{ ok: boolean; status: number; value?: T }> {
  const url = await safeRemoteUrl(input.url, input.resolveRemoteHosts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const abort = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(new Error("timeout")),
      { once: true }
    );
  });
  try {
    const response = await Promise.race([
      input.fetcher(url.toString(), {
        ...input.init,
        // Redirects must be deliberately revalidated rather than followed by fetch.
        redirect: "manual",
        signal: controller.signal,
      }),
      abort,
    ]);
    if (!response.ok) return { ok: false, status: response.status };
    return {
      ok: true,
      status: response.status,
      value: await Promise.race([input.read(response), abort]),
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(
  fetcher: Fetcher,
  url: string,
  init: RequestInit | undefined,
  resolveRemoteHosts: boolean,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; value?: unknown }> {
  return fetchAndRead({ fetcher, url, init, resolveRemoteHosts, timeoutMs, read: response => response.json() });
}

async function fetchBytes(
  fetcher: Fetcher,
  url: string,
  init: RequestInit | undefined,
  resolveRemoteHosts: boolean,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; value?: Uint8Array }> {
  return fetchAndRead({
    fetcher,
    url,
    init,
    resolveRemoteHosts,
    timeoutMs,
    read: async response => new Uint8Array(await response.arrayBuffer()),
  });
}

async function readSourceBytes(
  imageUrl: string,
  fetcher: Fetcher,
  supplied: Uint8Array | undefined,
  resolveRemoteHosts: boolean,
  timeoutMs: number
): Promise<Uint8Array> {
  if (supplied) return supplied;
  const inline = dataImageBytes(imageUrl);
  if (inline) return inline;
  const localMatch = imageUrl.match(/\/api\/images\/([^/?#]+)/);
  if (localMatch) {
    const fileName = path.basename(localMatch[1]);
    const filePath = path.join(localImageDir(), fileName);
    if (!filePath.startsWith(`${localImageDir()}${path.sep}`)) throw new Error("源图不存在");
    try {
      return new Uint8Array(await fs.readFile(filePath));
    } catch {
      throw new Error("源图不存在");
    }
  }
  const response = await fetchBytes(
    fetcher,
    imageUrl,
    { method: "GET" },
    resolveRemoteHosts,
    timeoutMs
  );
  if (!response.ok || !response.value) throw new Error(`源图下载失败：HTTP ${response.status}`);
  const bytes = response.value;
  if (bytes.byteLength > 25 * 1024 * 1024) throw new Error("源图过大");
  return bytes;
}

async function providerReachableImageUrl(input: {
  imageUrl: string;
  sourceBytes: Uint8Array;
  scope?: SegmentationOptions["scope"];
}): Promise<string> {
  try {
    return (await safeRemoteUrl(input.imageUrl, false)).toString();
  } catch {
    if (!input.scope) {
      throw new Error("本地源图缺少语义识别上传作用域");
    }
  }
  const png = await sharp(input.sourceBytes).png().toBuffer();
  const digest = createHash("sha256").update(png).digest("hex").slice(0, 24);
  const key = [
    "segmentation-inputs",
    input.scope.userId,
    input.scope.storyId,
    input.scope.imageId,
    `${digest}.png`,
  ].join("/");
  const stored = await storagePut(key, png, "image/png");
  return (await safeRemoteUrl(stored.url, false)).toString();
}

async function readFalMasks(
  initial: unknown,
  fetcher: Fetcher,
  pollIntervalMs: number,
  resolveRemoteHosts: boolean,
  timeoutMs: number
): Promise<Array<{ url: string }>> {
  const payload = initial as {
    masks?: Array<{ url: string }>;
    status?: string;
    status_url?: string;
    response_url?: string;
  };
  if (Array.isArray(payload.masks)) return payload.masks;
  if (!payload.status_url || !payload.response_url) return [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const statusResponse = await fetchJson(
      fetcher,
      payload.status_url,
      { method: "GET", headers: buildHeaders() },
      resolveRemoteHosts,
      timeoutMs
    );
    if (!statusResponse.ok) throw new Error(`fal.ai SAM2 status HTTP ${statusResponse.status}`);
    const status = statusResponse.value as { status?: string };
    if (status.status === "COMPLETED") {
      const resultResponse = await fetchJson(
        fetcher,
        payload.response_url,
        { method: "GET", headers: buildHeaders() },
        resolveRemoteHosts,
        timeoutMs
      );
      if (!resultResponse.ok) throw new Error(`fal.ai SAM2 result HTTP ${resultResponse.status}`);
      const result = resultResponse.value as { masks?: Array<{ url: string }> };
      return result.masks ?? [];
    }
    if (status.status === "FAILED") throw new Error("fal.ai SAM2 failed");
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error("fal.ai SAM2 timeout");
}

// ── Main function ──

export async function segmentAtPoint(
  imageUrl: string,
  x: number,
  y: number,
  options: SegmentationOptions = {},
): Promise<SegmentationResult> {
  // 没配 fal key 就快速失败：SAM2 点选抠图只有 fal.ai 提供，302 网关没有等价端点。
  // 不加这道守卫的话，下面会裸 fetch 去打 queue.fal.run —— 国内网络多半连不上、
  // 一直挂到 30s 后被 withTimeout 抛出一个看不懂的 "timeout"（这正是「喂图显示 timeout」的根因）。
  // 这里提前给出清晰中文提示，瞬间返回、不打网络。
  if (!ENV.falApiKey) {
    return {
      status: "error",
      message: "点选抠图依赖 fal.ai（需配置 FAL_KEY），当前未配置，暂时用不了。",
    };
  }

  if (isCircuitOpen()) {
    return { status: "error", message: "circuit breaker open" };
  }

  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const resolveRemoteHosts = options.resolveRemoteHosts ?? !options.fetcher;
  const requestTimeoutMs = options.requestTimeoutMs ?? TIMEOUT_MS;

  try {
    const sourceBytes = await readSourceBytes(
      imageUrl,
      fetcher,
      options.sourceBytes,
      resolveRemoteHosts,
      requestTimeoutMs
    );
    const sourceMetadata = await sharp(sourceBytes).metadata();
    const sourceWidth = sourceMetadata.width;
    const sourceHeight = sourceMetadata.height;
    if (!sourceWidth || !sourceHeight) {
      return { status: "error", message: "源图尺寸不可读" };
    }
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x >= sourceWidth ||
      y >= sourceHeight
    ) {
      return { status: "error", message: "点击位置超出源图范围" };
    }
    const providerImageUrl = await providerReachableImageUrl({
      imageUrl,
      sourceBytes,
      scope: options.scope,
    });
    const body = {
      image_url: providerImageUrl,
      point_coords: [[x, y]],
      point_labels: [1],
    };

    const response = await fetchJson(
      fetcher,
      SAM2_URL,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      },
      resolveRemoteHosts,
      requestTimeoutMs
    );

    if (!response.ok) {
      recordFailure();
      return { status: "error", message: `fal.ai SAM2 HTTP ${response.status}` };
    }

    const masks = await readFalMasks(
      response.value,
      fetcher,
      options.pollIntervalMs ?? 500,
      resolveRemoteHosts,
      requestTimeoutMs
    );
    if (masks.length === 0) {
      // No mask found at this point — valid case (clicked empty area)
      recordSuccess();
      return {
        status: "ok",
        maskUrl: null,
        maskKey: null,
        previewMaskUrl: null,
        previewMaskKey: null,
      };
    }

    let canonical: Awaited<ReturnType<typeof canonicalizeEditMask>> | null = null;
    for (const candidate of masks) {
      try {
      const maskResponse = await fetchBytes(
        fetcher,
        candidate.url,
        { method: "GET" },
        resolveRemoteHosts,
        requestTimeoutMs
      );
      if (!maskResponse.ok || !maskResponse.value) continue;
      const maskBuffer = maskResponse.value;
        if (maskBuffer.byteLength > 10 * 1024 * 1024) continue;
        canonical = await canonicalizeEditMask({
          maskBytes: maskBuffer,
          sourceWidth,
          sourceHeight,
          clickX: x,
          clickY: y,
          selectionPolygon: options.selectionPolygon,
        });
        break;
      } catch {
        // SAM may return several proposals. A proposal that does not safely
        // contain the click is ignored; none is ever inverted as a fallback.
      }
    }
    if (!canonical) throw new Error("没有识别到可安全编辑的单个物体");
    const maskKey = makeMaskKey("edit", options.scope);
    const previewMaskKey = makeMaskKey("preview", options.scope);
    const [stored, previewStored] = await Promise.all([
      storeMaskBytes(maskKey, canonical.editMask),
      storeMaskBytes(previewMaskKey, canonical.previewMask),
    ]);

    recordSuccess();
    return {
      status: "ok",
      maskUrl: stored.url,
      maskKey: stored.key,
      previewMaskUrl: previewStored.url,
      previewMaskKey: previewStored.key,
      width: canonical.width,
      height: canonical.height,
    };
  } catch (error) {
    recordFailure();
    const message = error instanceof Error ? error.message : "segmentation failed";
    return { status: "error", message };
  }
}

function polygonPromptPoint(points: SourceMaskPoint[]): SourceMaskPoint | null {
  if (
    points.length < 3 ||
    points.length > 512 ||
    points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))
  ) return null;
  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    weightedX += (current.x + next.x) * cross;
    weightedY += (current.y + next.y) * cross;
  }
  if (Math.abs(twiceArea) < 2) return null;
  return {
    x: weightedX / (3 * twiceArea),
    y: weightedY / (3 * twiceArea),
  };
}

function pointInPolygon(point: SourceMaskPoint, polygon: SourceMaskPoint[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses =
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function parseVisionContour(text: string): VisionContourResponse | null {
  const candidate = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (value.found !== true || !value.anchor || !Array.isArray(value.contour)) return null;
  const parsePoint = (point: unknown): SourceMaskPoint | null => {
    if (!point || typeof point !== "object") return null;
    const { x, y } = point as Record<string, unknown>;
    return typeof x === "number" && typeof y === "number" &&
      Number.isFinite(x) && Number.isFinite(y) &&
      x >= 0 && x <= VISION_COORDINATE_RANGE &&
      y >= 0 && y <= VISION_COORDINATE_RANGE
      ? { x, y }
      : null;
  };
  const anchor = parsePoint(value.anchor);
  const contour = value.contour.map(parsePoint);
  if (
    !anchor ||
    contour.length < 3 ||
    contour.length > VISION_MAX_CONTOUR_POINTS ||
    contour.some((point): point is null => point === null)
  ) {
    return null;
  }
  return { found: true, anchor, contour: contour as SourceMaskPoint[] };
}

function normalizedPoint(point: SourceMaskPoint, width: number, height: number): SourceMaskPoint {
  return {
    x: (point.x / VISION_COORDINATE_RANGE) * width,
    y: (point.y / VISION_COORDINATE_RANGE) * height,
  };
}

function rasterizeSemanticContour(input: {
  contour: SourceMaskPoint[];
  width: number;
  height: number;
}): Buffer {
  const { contour, width, height } = input;
  const raw = Buffer.alloc(width * height * 4, 0);
  for (let offset = 3; offset < raw.length; offset += 4) raw[offset] = 255;

  // Scanline fill keeps this bounded at O(height × contour points), unlike
  // checking every image pixel against every contour edge.
  for (let y = 0; y < height; y += 1) {
    const scanY = y + 0.5;
    const intersections: number[] = [];
    for (let index = 0; index < contour.length; index += 1) {
      const a = contour[index];
      const b = contour[(index + 1) % contour.length];
      if ((a.y > scanY) === (b.y > scanY)) continue;
      intersections.push(a.x + ((scanY - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    intersections.sort((left, right) => left - right);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const start = Math.max(0, Math.ceil(intersections[index] - 0.5));
      const end = Math.min(width - 1, Math.floor(intersections[index + 1] - 0.5));
      for (let x = start; x <= end; x += 1) {
        const offset = (y * width + x) * 4;
        raw[offset] = 255;
        raw[offset + 1] = 255;
        raw[offset + 2] = 255;
      }
    }
  }
  return raw;
}

async function visionImageDataUrl(sourceBytes: Uint8Array): Promise<string> {
  const image = sharp(sourceBytes).resize({
    width: VISION_MAX_IMAGE_EDGE,
    height: VISION_MAX_IMAGE_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });
  const bytes = await image.png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function normalizedLasso(points: SourceMaskPoint[], width: number, height: number) {
  return points.map(point => ({
    x: Math.round((point.x / width) * VISION_COORDINATE_RANGE),
    y: Math.round((point.y / height) * VISION_COORDINATE_RANGE),
  }));
}

async function segmentWithinVisionContour(
  imageUrl: string,
  points: SourceMaskPoint[],
  options: SegmentationOptions
): Promise<SegmentationResult> {
  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;
  const resolveRemoteHosts = options.resolveRemoteHosts ?? !options.fetcher;
  const requestTimeoutMs = options.requestTimeoutMs ?? TIMEOUT_MS;
  const sourceBytes = await readSourceBytes(
    imageUrl,
    fetcher,
    options.sourceBytes,
    resolveRemoteHosts,
    requestTimeoutMs
  );
  const metadata = await sharp(sourceBytes).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error("源图尺寸不可读");
  if (
    points.some(point =>
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > width ||
      point.y > height
    )
  ) {
    throw new Error("圈选路径无效，请重新圈住要修改的物体");
  }
  const hint = normalizedLasso(points, width, height);
  const response = await invokeVisionJson({
    system: [
      "You are a precise semantic image-selection system.",
      "Return JSON only. Never return markdown or commentary.",
      "The user supplied a rough closed lasso in normalized 0..1000 image coordinates.",
      "Identify the single visible object or semantic object-part intended by that lasso (hair and clothing are valid parts).",
      "The lasso is only a search hint: do not copy it, simplify it into a rectangle, or use it as the contour.",
      "Return found=false when a single object boundary cannot be identified confidently.",
      "When found=true, return one boundary following the visible object itself, an anchor point strictly inside that boundary and inside the lasso, and 3..256 contour points.",
      'Use exactly this schema: {"found":true,"anchor":{"x":0,"y":0},"contour":[{"x":0,"y":0}]}.',
      "All coordinates must be integers from 0 to 1000 in the original image coordinate system.",
    ].join("\n"),
    userText: `Lasso search hint (normalized 0..1000): ${JSON.stringify(hint)}`,
    imageUrls: [await visionImageDataUrl(sourceBytes)],
    maxTokens: 3_000,
    timeoutMs: requestTimeoutMs,
  });
  const result = parseVisionContour(response.text);
  if (!result) {
    throw new Error("视觉模型没有返回可验证的对象轮廓，请缩小圈选范围后重试");
  }
  const contour = result.contour.map(point => normalizedPoint(point, width, height));
  const anchor = normalizedPoint(result.anchor, width, height);
  if (!pointInPolygon(anchor, contour) || !pointInPolygon(anchor, points)) {
    throw new Error("视觉模型返回的对象轮廓不在圈选范围内，请重新圈选");
  }
  const maskBytes = await sharp(rasterizeSemanticContour({ contour, width, height }), {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  const canonical = await canonicalizeEditMask({
    maskBytes,
    sourceWidth: width,
    sourceHeight: height,
    clickX: anchor.x,
    clickY: anchor.y,
    selectionPolygon: points,
  });
  const maskKey = makeMaskKey("edit", options.scope);
  const previewMaskKey = makeMaskKey("preview", options.scope);
  const [stored, previewStored] = await Promise.all([
    storeMaskBytes(maskKey, canonical.editMask),
    storeMaskBytes(previewMaskKey, canonical.previewMask),
  ]);
  return {
    status: "ok",
    maskUrl: stored.url,
    maskKey: stored.key,
    previewMaskUrl: previewStored.url,
    previewMaskKey: previewStored.key,
    width: canonical.width,
    height: canonical.height,
  };
}

/** A lasso constrains where SAM may select; it is never converted directly
 * into an edit mask. Without a semantic provider this fails closed. */
export async function segmentWithinPolygon(
  imageUrl: string,
  points: SourceMaskPoint[],
  options: SegmentationOptions = {}
): Promise<SegmentationResult> {
  const prompt = polygonPromptPoint(points);
  if (!prompt) {
    return {
      status: "error",
      message: "圈选路径太小或无效，请重新圈住要修改的物体",
    };
  }
  if (ENV.falApiKey) {
    return segmentAtPoint(imageUrl, prompt.x, prompt.y, {
      ...options,
      selectionPolygon: points,
    });
  }
  if (!visionChannelConfigured()) {
    return {
      status: "error",
      message: "当前未配置语义对象识别；不会把圈选范围直接当成修改区域。",
    };
  }
  try {
    return await segmentWithinVisionContour(imageUrl, points, options);
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "视觉对象识别失败",
    };
  }
}
