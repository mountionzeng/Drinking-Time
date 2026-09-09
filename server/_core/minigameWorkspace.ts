import { createHmac } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../routers";
import { getAccountWorkspaceUser } from "../services/accountIdentity";
import { getAccountBalance } from "../services/computeLedger";
import type { GameDependencies } from "./minigameRouter";

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
