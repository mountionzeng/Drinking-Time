/**
 * fal.ai SAM 2 segmentation service
 * Accepts image + click coordinates, returns a mask image for the selected object.
 * Injectable fetcher for testing, normalized status union, never throws.
 * Includes circuit breaker after consecutive failures (10-minute cooldown).
 */

import { ENV } from "../_core/env";
import { storagePut } from "../storage";

// ── Types ──

export type SegmentationStatus = "ok" | "error";

export interface SegmentationResult {
  status: SegmentationStatus;
  maskUrl?: string | null;
  maskKey?: string | null;
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
}

// ── Constants ──

const SAM2_URL = "https://queue.fal.run/fal-ai/sam2";
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
      `[segmentation] Circuit breaker opened after ${consecutiveFailures} consecutive failures`,
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

function makeMaskKey(): string {
  return `masks/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
}

// ── Main function ──

export async function segmentAtPoint(
  imageUrl: string,
  x: number,
  y: number,
  options: SegmentationOptions = {},
): Promise<SegmentationResult> {
  if (isCircuitOpen()) {
    return { status: "error", message: "circuit breaker open" };
  }

  const fetcher: Fetcher = (options.fetcher ?? globalThis.fetch) as Fetcher;

  try {
    const body = {
      image_url: imageUrl,
      point_coords: [[x, y]],
      point_labels: [1],
    };

    const response = await withTimeout(
      fetcher(SAM2_URL, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
      }),
      TIMEOUT_MS,
    );

    if (!response.ok) {
      recordFailure();
      return { status: "error", message: `fal.ai SAM2 HTTP ${response.status}` };
    }

    const json = (await response.json()) as {
      masks?: Array<{ url: string }>;
    };

    const maskImageUrl = json.masks?.[0]?.url;
    if (!maskImageUrl) {
      // No mask found at this point — valid case (clicked empty area)
      recordSuccess();
      return { status: "ok", maskUrl: null, maskKey: null };
    }

    // Download mask and persist to storage
    const maskResponse = await withTimeout(
      fetcher(maskImageUrl, { method: "GET" }),
      TIMEOUT_MS,
    );

    if (!maskResponse.ok) {
      recordFailure();
      return { status: "error", message: `Failed to download mask: HTTP ${maskResponse.status}` };
    }

    const maskBuffer = await maskResponse.arrayBuffer();
    const maskKey = makeMaskKey();
    const stored = await storagePut(maskKey, new Uint8Array(maskBuffer), "image/png");

    recordSuccess();
    return {
      status: "ok",
      maskUrl: stored.url,
      maskKey: stored.key,
    };
  } catch (error) {
    recordFailure();
    const message = error instanceof Error ? error.message : "segmentation failed";
    return { status: "error", message };
  }
}
