import { createHmac } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../routers";
import { getAccountWorkspaceUser } from "../services/accountIdentity";
import { getAccountBalance } from "../services/computeLedger";
import { getAccountStatement } from "../services/computeStatement";
import type { GameDependencies } from "./minigameRouter";
import {
  COMPUTE_STATEMENT_MAX_OFFSET,
  COMPUTE_STATEMENT_MAX_PAGE_LIMIT,
  COMPUTE_STATEMENT_PAGE_LIMIT,
  type ComputeStatementQuery,
} from "../../shared/computeStatement";

function boundedStatementInteger(
  input: Record<string, unknown>,
  key: keyof ComputeStatementQuery,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = input[key];
  return typeof value === "number" && Number.isInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

/** Existing mobile procedures retain their Zod, ownership, CAS and durable-turn guards.
 * No Web context factory, cookie, guest identity, arbitrary path or admin procedure. */
export const dispatchMinigameWorkspace: NonNullable<
  GameDependencies["workspace"]
> = async (principal, operation, input, req, res) => {
  const user = await getAccountWorkspaceUser(principal.id);
  if (!user || user.sessionVersion !== principal.sessionVersion)
    throw new TRPCError({ code: "UNAUTHORIZED" });
  if (operation === "account.read")
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      recoveryScope: createHmac("sha256", process.env.MINIGAME_SESSION_SECRET!)
        .update(`workspace:${user.id}`)
        .digest("hex"),
    };
  const caller = appRouter.createCaller({ req, res, user });
  if (operation === "account.balance") {
    const balance = await getAccountBalance(user.id);
    return {
      postedMinor: balance.balanceMinor,
      reservedMinor: balance.reservedMinor,
      availableMinor: balance.availableMinor,
      lifetimeSpentMinor: balance.lifetimeSpentMinor,
    };
  }
  if (operation === "account.statement") {
    const value =
      input && typeof input === "object"
        ? (input as Record<string, unknown>)
        : {};
    return getAccountStatement(user.id, {
      attentionOffset: boundedStatementInteger(
        value,
        "attentionOffset",
        0,
        0,
        COMPUTE_STATEMENT_MAX_OFFSET
      ),
      attentionLimit: boundedStatementInteger(
        value,
        "attentionLimit",
        COMPUTE_STATEMENT_PAGE_LIMIT,
        1,
        COMPUTE_STATEMENT_MAX_PAGE_LIMIT
      ),
      historyOffset: boundedStatementInteger(
        value,
        "historyOffset",
        0,
        0,
        COMPUTE_STATEMENT_MAX_OFFSET
      ),
      historyLimit: boundedStatementInteger(
        value,
        "historyLimit",
        COMPUTE_STATEMENT_PAGE_LIMIT,
        1,
        COMPUTE_STATEMENT_MAX_PAGE_LIMIT
      ),
    });
  }
  if (operation === "profile.read") return caller.emotionAnalysis.getProfile();
  if (operation === "profile.save") {
    // Mobile profile has no project binding; never accept a caller-chosen project.
    const { projectId: _projectId, ...profile } = (
      input && typeof input === "object" ? input : {}
    ) as Record<string, unknown>;
    return (
      caller.emotionAnalysis.saveBirthProfile as (
        value: unknown
      ) => Promise<unknown>
    )(profile);
  }
  if (operation === "stories.list") return caller.storyAgent.storyList();
  // Creating from mobile is intentionally narrow; never forward id/body/projectId.
  if (operation === "stories.create")
    return caller.storyAgent.storyUpsert({ title: "新的故事" });
  const procedures = {
    "body.read": caller.publishingDraft.readBody,
    "body.initialize": caller.publishingDraft.initBody,
    "body.save": caller.publishingDraft.saveBody,
    "chat.list": caller.storyConversation.list,
    "chat.generate": caller.storyConversation.generateMobileTurn,
    "chat.status": caller.storyConversation.mobileTurnStatus,
    "chat.append": caller.storyConversation.appendMobileTurn,
    "letters.list": caller.emotionAnalysis.listDailyLetters,
    "letters.rewrite": caller.emotionAnalysis.rewriteDailyLetter,
    "letters.reread": caller.emotionAnalysis.rereadDailyLetter,
  };
  // createCaller validates unknown input using each original procedure's schema.
  const invoke = procedures[operation] as (value: unknown) => Promise<unknown>;
  return invoke(input);
};
