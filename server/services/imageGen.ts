/**
 * fal.ai image generation service
 * Provides text-to-image generation and inpainting via raw fetch calls.
 * Injectable fetcher for testing, normalized status union, never throws.
 * Includes circuit breaker after consecutive failures (10-minute cooldown).
 */

import { ENV } from "../_core/env";
import { storagePut } from "../storage";

// ── Types ──

export type ImageGenStatus = "ok" | "error";

export interface ImageGenResult {
  status: ImageGenStatus;
  imageUrl?: string;
  imageKey?: string;
  message?: string;
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;

export interface ImageGenOptions {
  fetcher?: Fetcher;
  aspectRatio?: string;
  seed?: number;
}

// ── Constants ──

const GENERATE_URL = "https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra";
const INPAINT_URL = "https://queue.fal.run/fal-ai/flux-pro/v1/fill";
const TIMEOUT_MS = 30_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

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
      `[imageGen] Circuit breaker opened after ${consecutiveFailures} consecutive failures`,
    );
  }
}

/** Reset circuit breaker — intended for testing only */
export function resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  circuitBreakerOpenUntil = null;
}

// ── Helpers ──

function buildHeaders(): Record<string, string> {
  return {
    Authorization: `Key ${ENV.falApiKey}`,
    "Content-Type": "application/json",
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function makeStorageKey(): string {
  return `generated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
}

// ── Main functions ──

export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {},
): Promise<ImageGenResult> {
  if (isCircuitOpen()) {
    return { status: "error", message: "circuit breaker open" };
  }

  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;

  try {
    const body: Record<string, unknown> = {
      prompt,
      output_format: "png",
    };
    if (options.aspectRatio) {
      body.aspect_ratio = options.aspectRatio;
    }
    if (options.seed !== undefined) {
      body.seed = options.seed;
    }

    const response = await withTimeout(
      fetcher(GENERATE_URL, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      }),
      TIMEOUT_MS,
    );

    if (!response.ok) {
      recordFailure();
      return { status: "error", message: `fal.ai API HTTP ${response.status}` };
    }

    const json = (await response.json()) as {
      images?: Array<{ url: string; width?: number; height?: number }>;
      seed?: number;
    };

    const imageUrl = json.images?.[0]?.url;
    if (!imageUrl) {
      recordFailure();
      return { status: "error", message: "fal.ai returned no images" };
    }

    // Download the generated image and upload to storage
    const imageResponse = await withTimeout(
      fetcher(imageUrl, { method: "GET" }),
      TIMEOUT_MS,
    );

    if (!imageResponse.ok) {
      recordFailure();
      return { status: "error", message: `Failed to download generated image: HTTP ${imageResponse.status}` };
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const storageKey = makeStorageKey();
    const stored = await storagePut(storageKey, new Uint8Array(imageBuffer), "image/png");

    recordSuccess();
    return {
      status: "ok",
      imageUrl: stored.url,
      imageKey: stored.key,
    };
  } catch (error) {
    recordFailure();
    const message = error instanceof Error ? error.message : "image generation failed";
    return { status: "error", message };
  }
}

export async function inpaintImage(
  imageUrl: string,
  maskUrl: string,
  prompt: string,
  options: ImageGenOptions = {},
): Promise<ImageGenResult> {
  if (isCircuitOpen()) {
    return { status: "error", message: "circuit breaker open" };
  }

  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;

  try {
    const body: Record<string, unknown> = {
      image_url: imageUrl,
      mask_url: maskUrl,
      prompt,
    };
    if (options.seed !== undefined) {
      body.seed = options.seed;
    }

    const response = await withTimeout(
      fetcher(INPAINT_URL, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      }),
      TIMEOUT_MS,
    );

    if (!response.ok) {
      recordFailure();
      return { status: "error", message: `fal.ai API HTTP ${response.status}` };
    }

    const json = (await response.json()) as {
      images?: Array<{ url: string; width?: number; height?: number }>;
      seed?: number;
    };

    const resultUrl = json.images?.[0]?.url;
    if (!resultUrl) {
      recordFailure();
      return { status: "error", message: "fal.ai returned no images" };
    }

    // Download the inpainted image and upload to storage
    const imageResponse = await withTimeout(
      fetcher(resultUrl, { method: "GET" }),
      TIMEOUT_MS,
    );

    if (!imageResponse.ok) {
      recordFailure();
      return { status: "error", message: `Failed to download inpainted image: HTTP ${imageResponse.status}` };
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const storageKey = makeStorageKey();
    const stored = await storagePut(storageKey, new Uint8Array(imageBuffer), "image/png");

    recordSuccess();
    return {
      status: "ok",
      imageUrl: stored.url,
      imageKey: stored.key,
    };
  } catch (error) {
    recordFailure();
    const message = error instanceof Error ? error.message : "inpainting failed";
    return { status: "error", message };
  }
}
