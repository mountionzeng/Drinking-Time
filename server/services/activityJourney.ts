/** 网页会话与小程序桥上报的导航事件。身份只来自调用方已经核过的 userId。 */
import { z } from "zod";
import {
  CLIENT_ACTIVITY_EVENTS,
  CLIENT_SURFACES,
  type ActivityPlatform,
} from "../../shared/activityJourney";
import { consumePersistentRateLimit } from "../repositories/accounts";
import {
  activityKey,
  listActivityEventsForUser,
  noteActivityEvent,
  summarizeActivityEvents,
  type ActivityEventView,
} from "../repositories/activityJourney";
import { getGeneratedImageById } from "../repositories/images";
import { getVideoTakeById } from "../repositories/videos";

const clientEvent = z.object({
  event: z.enum(CLIENT_ACTIVITY_EVENTS),
  surface: z.enum(CLIENT_SURFACES).optional(),
  subjectKind: z.enum(["image", "video"]).optional(),
  subjectRef: z.number().int().positive().max(2_147_483_647).optional(),
  dedupeKey: z.string().regex(/^[a-z0-9][a-z0-9_:-]{7,63}$/),
}).strict();

export type ClientActivityInput = z.infer<typeof clientEvent>;

const CLIENT_LIMIT = 30;

export function parseClientActivity(input: unknown): ClientActivityInput | null {
  const parsed = clientEvent.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export async function acceptClientActivity(input: {
  userId: number;
  platform: ActivityPlatform;
  body: unknown;
}): Promise<"recorded" | "duplicate" | "invalid" | "not_found" | "limited" | "dropped"> {
  const body = parseClientActivity(input.body);
  if (!body || !clientShapeIsValid(body)) return "invalid";
  const limit = await consumePersistentRateLimit({
    scope: "activity-journey",
    subject: `${input.platform}:${input.userId}`,
    windowSeconds: 60,
    maxAttempts: CLIENT_LIMIT,
  }).catch(() => null);
  if (!limit?.allowed) return "limited";
  if (body.event === "result.opened") {
    const visible = await resultIsVisible(input.userId, body.subjectKind!, body.subjectRef!);
    if (!visible) return "not_found";
  }
  const outcome = await noteActivityEvent({
    userId: input.userId,
    platform: input.platform,
    eventName: body.event,
    result: "none",
    subjectKind: body.event === "result.opened" ? body.subjectKind : null,
    subjectRef: body.event === "result.opened" ? body.subjectRef : null,
    dedupeKey: `client${activityKey([input.platform, String(input.userId), body.event, body.dedupeKey])}`,
  });
  return outcome === "rejected" ? "invalid" : outcome;
}

function clientShapeIsValid(body: ClientActivityInput): boolean {
  if (body.event === "creation.entered" || body.event === "creation.edit_started") {
    return Boolean(body.surface) && body.subjectKind == null && body.subjectRef == null;
  }
  if (body.event === "result.opened") {
    return body.surface == null && (body.subjectKind === "image" || body.subjectKind === "video") && body.subjectRef != null;
  }
  return body.surface == null && body.subjectKind == null && body.subjectRef == null;
}

async function resultIsVisible(userId: number, kind: "image" | "video", subjectRef: number): Promise<boolean> {
  if (kind === "image") {
    const image = await getGeneratedImageById(subjectRef);
    return image?.userId === userId && Boolean(image.imageUrl);
  }
  const take = await getVideoTakeById(subjectRef, userId);
  return Boolean(take && take.status === "available" && (take.videoUrl || take.videoKey));
}

export async function activityFunnel(sinceDays: number): Promise<Awaited<ReturnType<typeof summarizeActivityEvents>>> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return summarizeActivityEvents(since);
}

export async function activityForAccount(userId: number): Promise<ActivityEventView[]> {
  return listActivityEventsForUser(userId);
}
