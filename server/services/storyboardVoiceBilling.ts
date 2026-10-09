import { estimateStoryNarrationCostMinor } from "../../shared/narrationCost";
import {
  generateStoryVoice302,
  StoryVoice302Error,
  type StoryVoice302Result,
} from "./storyVoice302";
import { settleOperation } from "./computeLedger";
import {
  mediaBillingEnabled,
  mediaOperationId,
  reserveMedia,
  readMediaResult,
  recordMediaResult,
  settleMediaQuote,
} from "./mediaComputeBilling";

/** A stable narration intent recovers its durable URL after a crash/CAS failure. */
export async function generateBilledStoryboardVoice(
  input: {
    key: string;
    userId: number;
    storyId: number;
    text: string;
    provider?: string;
    voice?: string;
  },
  generate = generateStoryVoice302
): Promise<StoryVoice302Result> {
  if (!mediaBillingEnabled()) return generate(input);
  const baseOperationId = mediaOperationId("voice", input.userId, input.key);
  let operationId = baseOperationId;
  const maxCostMinor = estimateStoryNarrationCostMinor(input.text);
  let reservation = await reserveMedia({
    ...input,
    operationId,
    maxCostMinor,
    requestHash: baseOperationId,
  });
  // Only a proven uncharged previous failure permits a new explicit click to
  // retry. The next ordinal is deterministic, so concurrent clicks still share
  // one atomic claim; unknown/settled operations are never retried.
  for (
    let retry = 1;
    reservation.outcome === "replayed" &&
    reservation.status === "released" &&
    retry <= 100;
    retry++
  ) {
    operationId = `${baseOperationId}-retry-${retry}`;
    reservation = await reserveMedia({
      ...input,
      operationId,
      maxCostMinor,
      requestHash: baseOperationId,
    });
  }
  if (reservation.outcome === "replayed") {
    const receipt = await readMediaResult(operationId);
    if (
      receipt &&
      typeof receipt.audioUrl === "string" &&
      typeof receipt.provider === "string" &&
      typeof receipt.voice === "string"
    ) {
      await settleMediaQuote(operationId);
      return {
        audioUrl: receipt.audioUrl,
        provider: receipt.provider,
        voice: receipt.voice,
      };
    }
    throw new Error(
      reservation.status === "released"
        ? "这次旁白请求已结束且未扣费，请修改后重新生成"
        : "旁白正在生成或结果待核对，已保留预占，不会重复提交"
    );
  }
  let result: StoryVoice302Result;
  try {
    result = await generate(input);
  } catch (error) {
    await settleOperation({
      operationId,
      outcome:
        error instanceof StoryVoice302Error &&
        error.outcome === "not_charged_failure"
          ? { kind: "not_charged_failure" }
          : { kind: "submission_unknown" },
    });
    throw error;
  }
  // Store before settlement and Story CAS. A later retry reuses this exact URL.
  await recordMediaResult(operationId, result.provider, result);
  await settleMediaQuote(operationId);
  return result;
}
