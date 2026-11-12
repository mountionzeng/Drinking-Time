/**
 * submitRender — the only execution exit for images and videos: every paid
 * profile, and the 0-price local profile (image.local-color-transfer), which
 * computes on this machine, reserves nothing and writes no consumption ledger.
 *
 * One call = one profile = at most one paid submission. It never retries on
 * another profile: a refusal or failure goes back to the caller with the
 * alternatives (and their existing prices) spelled out, and switching is the
 * user's decision.
 */
import {
  getRenderProfile,
  renderProfileRefusal,
  type RenderProfile,
  type RenderProfileId,
} from "@shared/renderProfiles";
import type { ImageGenResult } from "../imageGen";
import type { ShotVideoSubmitResult } from "../videoGen";
import { routeMatchesProfile } from "./routing";
import type {
  ImageRenderInput,
  RenderInputByProfile,
  RenderOutputByProfile,
  ShotVideoRenderInput,
  StartEndVideoRenderInput,
  LegnextRenderInput,
  LocalColorTransferResult,
} from "./types";

/** Thrown for start-end video (whose adapter contract is throw-on-failure) when nothing was submitted. */
export class RenderRefusedError extends Error {
  readonly submissionState = "not_submitted" as const;
  constructor(message: string, readonly profileId: RenderProfileId) {
    super(message);
    this.name = "RenderRefusedError";
  }
}

function promptOf(profile: RenderProfile, input: unknown): string {
  switch (profile.adapter) {
    case "image": return (input as ImageRenderInput).prompt;
    case "legnext": return (input as LegnextRenderInput).prompt;
    case "shot-video": return (input as ShotVideoRenderInput).input.prompt;
    case "start-end-video": return (input as StartEndVideoRenderInput).spec.prompt;
    case "local-color-transfer": return "";
  }
}

/** Why this submission must not happen (checked before any network call), or null. */
export function renderRefusalReason(profileId: RenderProfileId, input: unknown): string | null {
  const profile = getRenderProfile(profileId);
  if (!profile) return `未知的渲染档位 ${String(profileId)}，本次没有提交付费任务。`;
  if (!profile.enabled) return renderProfileRefusal(profileId, `${profile.label}已停用：${profile.disabledReason ?? "未说明原因"}`);
  if (profile.adapter === "image") {
    const route = (input as ImageRenderInput).route;
    if (!route || !routeMatchesProfile(profileId, route)) {
      return `渲染档位 ${profileId} 与本次路由不一致，已停止，本次没有提交付费任务，也没有改用其他供应商。`;
    }
  }
  if (profile.adapter === "legnext" && ((input as LegnextRenderInput).options?.editMode === "retexture") !== (profileId === "image.legnext-retexture")) {
    return "MJ 编辑方式与渲染档位不一致，本次没有提交付费任务。";
  }
  const max = profile.maxPromptChars;
  if (max != null && profile.overLimit === "reject") {
    const length = promptOf(profile, input).trim().length;
    if (length > max) return renderProfileRefusal(profileId, `提示词 ${length} 字，超过${profile.label}的上限 ${max} 字，请精简后再提交。`);
  }
  return null;
}

function refusal(profile: RenderProfile, message: string): unknown {
  switch (profile.adapter) {
    case "image":
    case "legnext":
      return { status: "error", message } satisfies ImageGenResult;
    case "local-color-transfer":
      return { status: "error", message } satisfies LocalColorTransferResult;
    case "shot-video":
      return { status: "error", submissionState: "not_submitted", message } satisfies ShotVideoSubmitResult;
    case "start-end-video":
      throw new RenderRefusedError(message, profile.id);
  }
}

export async function submitRender<P extends RenderProfileId>(
  profileId: P,
  input: RenderInputByProfile<P>
): Promise<RenderOutputByProfile<P>> {
  const reason = renderRefusalReason(profileId, input);
  const profile = getRenderProfile(profileId);
  if (reason) {
    console.warn("[render] refused before submission", { profileId });
    return refusal(profile ?? ({ adapter: "image", id: profileId } as RenderProfile), reason) as RenderOutputByProfile<P>;
  }
  // Loaded lazily: the adapters import imageGen/videoGen, which import this module.
  const { runRenderAdapter } = await import("./executors");
  console.log("[render] submit", { profileId, provider: profile.provider });
  return (await runRenderAdapter(profile, input)) as RenderOutputByProfile<P>;
}
