import type { RenderProfileId } from "@shared/renderProfiles";
import type { ImageGenOptions, ImageGenResult } from "../imageGen";
import type { LegnextOptions } from "../legnextImage";
import type { ShotVideoInput, ShotVideoSubmitResult } from "../videoGen";
import type { ViduTransitionSpec } from "../videoTransition302";
import type { MidjourneyChannel } from "./adapters/midjourney302";

export type LegnextProfileId = "image.legnext-v7-fast" | "image.legnext-retexture";
export type ShotVideoProfileId = "video.vidu-q2-pro-fast" | "video.mj-video" | "video.302-configured";
export type StartEndVideoProfileId = "video.vidu-q2-turbo-start-end";
export type LocalColorTransferProfileId = "image.local-color-transfer";
export type ImageProfileId = Exclude<RenderProfileId, LegnextProfileId | ShotVideoProfileId | StartEndVideoProfileId | LocalColorTransferProfileId>;

/** What routing decided for an image request; executed verbatim by the image adapter. */
export type ImageRouteDetail =
  | { adapter: "mj"; channel: MidjourneyChannel; mode: "generate" }
  | { adapter: "mj"; channel: MidjourneyChannel; mode: "edit"; inputImageUrls: string[] }
  | { adapter: "mj"; channel: MidjourneyChannel; mode: "revision" }
  | { adapter: "kontext"; referenceImageUrl: string }
  | { adapter: "gpt-generate" }
  | { adapter: "gpt-edit" }
  | { adapter: "draft" }
  | { adapter: "disabled" };

export type ImageRenderInput = {
  prompt: string;
  /** Base image for edits. */
  imageUrl?: string;
  options: ImageGenOptions;
  route: ImageRouteDetail;
};

export type LegnextRenderInput = {
  prompt: string;
  onAccepted: (id: string) => Promise<void>;
  options?: LegnextOptions;
};

export type ShotVideoRenderInput = {
  input: ShotVideoInput;
  options?: { fetcher?: typeof fetch };
};

export type StartEndVideoRenderInput = {
  spec: ViduTransitionSpec;
  options?: { fetcher?: typeof fetch; timeoutMs?: number };
};

/** 本地调色：两张图的原始字节（参考图在前），本机计算，不走网络。 */
export type LocalColorTransferRenderInput = {
  referenceBytes: Uint8Array;
  targetBytes: Uint8Array;
};

export type LocalColorTransferResult =
  | {
      status: "ok";
      png: Buffer;
      width: number;
      height: number;
      lMaxAbsDiff: number;
      lMeanAbsDiff: number;
      stats: import("../colorTransfer").ColorTransferStats;
    }
  | { status: "error"; message: string };

export type StartEndVideoSubmission = {
  taskId: string;
  submitUrl: string;
  submittedParameters: Record<string, unknown>;
};

export type RenderInputByProfile<P extends RenderProfileId> =
  P extends LegnextProfileId ? LegnextRenderInput :
  P extends ShotVideoProfileId ? ShotVideoRenderInput :
  P extends StartEndVideoProfileId ? StartEndVideoRenderInput :
  P extends LocalColorTransferProfileId ? LocalColorTransferRenderInput :
  ImageRenderInput;

export type RenderOutputByProfile<P extends RenderProfileId> =
  P extends LegnextProfileId ? ImageGenResult :
  P extends ShotVideoProfileId ? ShotVideoSubmitResult :
  P extends StartEndVideoProfileId ? StartEndVideoSubmission :
  P extends LocalColorTransferProfileId ? LocalColorTransferResult :
  ImageGenResult;
