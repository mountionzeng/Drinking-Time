/**
 * Adapter dispatch for submitRender. Each adapter performs at most one paid
 * submission for the profile it is given and returns its own result shape.
 * The local adapter computes on this machine and makes no network call.
 */
import type { RenderProfile } from "@shared/renderProfiles";
import { runImageRenderProfile } from "../imageGen";
import { generateLegnextImage } from "../legnextImage";
import { submitShotVideoForProfile } from "../videoGen";
import { submitViduTransition } from "../videoTransition302";
import { runLocalColorTransfer } from "./adapters/localColorTransfer";
import type {
  ImageRenderInput,
  LocalColorTransferRenderInput,
  LegnextRenderInput,
  ShotVideoProfileId,
  ShotVideoRenderInput,
  StartEndVideoRenderInput,
} from "./types";

export async function runRenderAdapter(profile: RenderProfile, input: unknown): Promise<unknown> {
  switch (profile.adapter) {
    case "image":
      return runImageRenderProfile(profile, input as ImageRenderInput);
    case "legnext": {
      const legnext = input as LegnextRenderInput;
      return legnext.options === undefined
        ? generateLegnextImage(legnext.prompt, legnext.onAccepted)
        : generateLegnextImage(legnext.prompt, legnext.onAccepted, legnext.options);
    }
    case "shot-video": {
      const video = input as ShotVideoRenderInput;
      return submitShotVideoForProfile(profile.id as ShotVideoProfileId, video.input, video.options);
    }
    case "start-end-video": {
      const startEnd = input as StartEndVideoRenderInput;
      return startEnd.options === undefined ? submitViduTransition(startEnd.spec) : submitViduTransition(startEnd.spec, startEnd.options);
    }
    case "local-color-transfer":
      return runLocalColorTransfer(input as LocalColorTransferRenderInput);
  }
}
