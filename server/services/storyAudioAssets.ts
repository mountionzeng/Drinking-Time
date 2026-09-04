/**
 * The `ready`-gated Story audio asset boundary (U2).
 *
 * Everything downstream (audio clips in U9, the player, export) only ever needs
 * `storyId + assetId`. A Timeline clip holds a non-owning reference: deleting or
 * undoing a clip never touches an asset row or its bytes. Ownership is always
 * checked against the session `userId` + the `storyId` the caller is working
 * in; a bare assetId, a forged storyId, or a client-supplied storage key can
 * never read or reuse an asset.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { StoryAudioAsset } from "../../drizzle/schema";
import {
  createStoryAudioAssetRow,
  findReusableStoryAudioAssetRow,
  getStoryAudioAssetRow,
  listStoryAudioAssetRows,
  updateStoryAudioAssetRow,
} from "../db";
import type { AudioProbeFacts } from "./audioMedia";
import { resolveManagedAudioPath } from "./audioMedia";

export type StoryAudioAssetScope = { storyId: number; userId: number };

export type StoryAudioSourceKind = StoryAudioAsset["sourceKind"];
export type StoryAudioMediaKind = StoryAudioAsset["mediaKind"];

export function isReadyAudioAsset(asset: StoryAudioAsset | null): boolean {
  return asset?.status === "ready";
}

/** Sha-256 of the file at a managed storage key. */
export async function checksumManagedAudio(storageKey: string): Promise<string> {
  const bytes = await readFile(resolveManagedAudioPath(storageKey));
  return createHash("sha256").update(bytes).digest("hex");
}

export function checksumBytes(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function createPendingStoryAudioAsset(input: {
  scope: StoryAudioAssetScope;
  storageKey: string;
  displayName: string;
  sourceKind: StoryAudioSourceKind;
  mediaKind?: StoryAudioMediaKind;
  sourceKey?: string | null;
  provenance?: unknown;
}): Promise<StoryAudioAsset> {
  return createStoryAudioAssetRow({
    storyId: input.scope.storyId,
    userId: input.scope.userId,
    storageKey: input.storageKey,
    displayName: input.displayName.slice(0, 200) || "音频",
    sourceKind: input.sourceKind,
    mediaKind: input.mediaKind ?? "unknown",
    sourceKey: input.sourceKey ?? null,
    status: "pending",
    provenance: (input.provenance ?? null) as StoryAudioAsset["provenance"],
  });
}

export async function markStoryAudioAssetReady(input: {
  scope: StoryAudioAssetScope;
  assetId: number;
  probe: AudioProbeFacts;
  checksum: string;
}): Promise<StoryAudioAsset | null> {
  return updateStoryAudioAssetRow(input.assetId, input.scope.userId, {
    status: "ready",
    failureReason: null,
    checksum: input.checksum,
    durationFrames: input.probe.durationFrames,
    durationSeconds: input.probe.durationSeconds,
    sampleRate: input.probe.sampleRate,
    channels: input.probe.channels,
    codecName: input.probe.codecName,
    formatName: input.probe.formatName,
  });
}

export async function markStoryAudioAssetFailed(input: {
  scope: StoryAudioAssetScope;
  assetId: number;
  reason: string;
}): Promise<StoryAudioAsset | null> {
  return updateStoryAudioAssetRow(input.assetId, input.scope.userId, {
    status: "failed",
    failureReason: input.reason.slice(0, 255),
  });
}

/** Ownership-checked read. Returns `null` for a cross-Story / cross-user id. */
export async function loadOwnedStoryAudioAsset(input: {
  scope: StoryAudioAssetScope;
  assetId: number;
}): Promise<StoryAudioAsset | null> {
  return getStoryAudioAssetRow({
    assetId: input.assetId,
    storyId: input.scope.storyId,
    userId: input.scope.userId,
  });
}

/** Ownership-checked read that also requires `ready`. Timeline refs use this. */
export async function loadReadyStoryAudioAsset(input: {
  scope: StoryAudioAssetScope;
  assetId: number;
}): Promise<StoryAudioAsset | null> {
  const asset = await loadOwnedStoryAudioAsset(input);
  return isReadyAudioAsset(asset) ? asset : null;
}

export async function listOwnedStoryAudioAssets(
  scope: StoryAudioAssetScope
): Promise<StoryAudioAsset[]> {
  return listStoryAudioAssetRows(scope);
}

/**
 * A `ready` asset in the SAME Story with the same upstream identity, so a
 * repeated ChatCut attach or TTS adoption reuses bytes instead of re-importing.
 * Never shares across Stories.
 */
export async function findReusableReadyStoryAudioAsset(input: {
  scope: StoryAudioAssetScope;
  sourceKind: StoryAudioSourceKind;
  sourceKey: string;
}): Promise<StoryAudioAsset | null> {
  return findReusableStoryAudioAssetRow({
    storyId: input.scope.storyId,
    userId: input.scope.userId,
    sourceKind: input.sourceKind,
    sourceKey: input.sourceKey,
  });
}
