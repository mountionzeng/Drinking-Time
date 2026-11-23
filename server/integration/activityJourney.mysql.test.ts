import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { withMysqlTestDatabase } from "./mysqlTestHarness";
import { activityBeijingDate, ACTIVITY_VISIT_HEADER } from "../../shared/activityJourney";
import { adminUsersRouter } from "../routers/adminUsers";
import { getDb } from "../repositories/runtime";
import { activityWebVisit, readActivityWebVisit } from "../services/activityJourneyContext";
import {
  recordGenerationResolved, recordGenerationSubmitted, recordVideoAvailability,
} from "../repositories/activityJourney";
import { createStory } from "../repositories/stories";
import { insertChapter } from "../repositories/chapters";
import { createVideoTake, updateVideoTake } from "../repositories/videos";
import { runModuleImageTask } from "../services/bookModuleImageRecovery";
import { getImageTaskStore } from "../repositories/imageGenerationTasks";
import {
  completeTask, markAccepted, markRequestSent, markSubmissionUnknown, pollImageTask, registerImageTask,
} from "../services/imageGenerationTaskService";
import type { TrpcContext } from "../_core/context";

const suite = process.env.TEST_MYSQL_DATABASE_URL ? describe : describe.skip;
suite("creation journey (synthetic isolated MySQL)", () => {
  it("runs authenticated visits, asynchronous business outcomes, retries, opening and filtered export", async () => {
    await withMysqlTestDatabase(async ({ databaseUrl }) => {
      const db = await mysql.createConnection(databaseUrl);
      vi.stubEnv("DATABASE_URL", databaseUrl);
      vi.stubEnv("ACTIVITY_JOURNEY_ENABLED", "true");
      vi.stubEnv("IMAGE_TASK_ASYNC_SUBMIT", "0");
      vi.stubEnv("APP_ORIGIN", "https://synthetic.example");
      const headers = {
        origin: "https://synthetic.example", "sec-fetch-site": "same-origin",
        [ACTIVITY_VISIT_HEADER]: randomUUID(),
      };
      const caller = (id: number, role: "user" | "admin") => adminUsersRouter.createCaller(
        { user: { id, role }, req: { headers }, res: {} } as unknown as TrpcContext,
      );
      const admin = caller(1, "admin");
      const web = caller(2, "user");
      const forWeb = <T,>(run: () => T) => activityWebVisit.run(readActivityWebVisit(2, headers), run);
      try {
        await db.query("INSERT INTO users (id,openId,role) VALUES (1,'synthetic-admin','admin'),(2,'synthetic-member','user')");
        const from = activityBeijingDate(Date.now());
        const enter = () => web.journeySignal({ eventName: "creation.entered" });
        await Promise.all(Array.from({ length: 4 }, enter));

        const store = await getImageTaskStore();
        const register = (requestId: string) => registerImageTask(store, {
          userId: 2, requestId, scope: "book_module", provider: "synthetic", billingOperationId: requestId,
        });
        const claim = await forWeb(() => Promise.all([register("synthetic-1"), register("synthetic-1")]));
        expect(new Set(claim.map(item => item.row.id)).size).toBe(1);
        const taskId = claim[0].row.id;
        await markRequestSent(store, taskId);
        await markAccepted(store, taskId, "synthetic-receipt-1");
        const settle = vi.fn(async () => {});
        const deps = { store, settle, resume: async () => ({ status: "error" as const, message: "synthetic 供应商确认失败" }) };
        const images = [{ imageUrl: "/synthetic-result.png" }, { imageUrl: "/synthetic-other-result.png" }];
        await Promise.all([completeTask(deps, taskId, images), completeTask(deps, taskId, images)]);
        const completed = await store.get(taskId);
        expect(completed?.candidates).toHaveLength(2);
        expect(settle).toHaveBeenCalledTimes(1);
        const result = { eventName: "result.opened" as const, subjectKind: "image" as const, subjectRef: completed!.candidates[0].imageId };
        await Promise.all([admin.journeySignal(result), web.journeySignal(result), web.journeySignal(result)]);

        const failed = await forWeb(() => register("synthetic-2"));
        await markRequestSent(store, failed.row.id);
        const accepted = await markAccepted(store, failed.row.id, "synthetic-receipt-2");
        await pollImageTask(deps, accepted!);
        const uncertain = await forWeb(() => register("synthetic-3"));
        await markSubmissionUnknown(deps, uncertain.row.id, "synthetic unknown");
        const pending = await forWeb(() => register("synthetic-4"));
        expect(pending.row.status).toBe("submitting");

        await forWeb(() => recordGenerationSubmitted(2, "video", 100));
        await recordGenerationResolved(2, "video", 100, "cancelled");
        await recordGenerationResolved(2, "video", 100, "timeout");
        await forWeb(() => recordGenerationSubmitted(2, "video", 200));
        await recordVideoAvailability({ id: 200, userId: 2, status: "available", videoKey: null, videoUrl: "synthetic" });
        await recordGenerationResolved(2, "image", "pre-feature-synthetic-task", "succeeded", [300]);

        const story = await createStory({ userId: 2, title: "Synthetic story", body: {} });
        const chapter = await insertChapter({ storyId: story.id, userId: 2, content: {
          title: "Synthetic chapter", layout: null,
          blocks: {
            body: "Synthetic text", blockIds: ["fixture"], containsAiText: false, settings: null,
            coverKey: null, bodyTextureKey: null, images: {}, illustrations: [],
            writingStyle: [{ id: "fixture", format: "text", lineCount: 1, parentId: null, collapsed: false }],
          },
        } });
        const syncScope = {
          storyId: story.id, userId: 2, chapterId: chapter.id, moduleId: "fixture",
          requestId: "synthetic-sync", expectedText: "Synthetic text", provider: "midjourney" as const,
        };
        const generate = vi.fn(async (hooks: Parameters<Parameters<typeof runModuleImageTask>[1]>[0]) => {
          await hooks.storeCandidates([{ imageUrl: "/synthetic-module.png" }], { prompt: "Synthetic fixture" });
          return { status: "ok" };
        });
        await forWeb(() => Promise.all([runModuleImageTask(syncScope, generate), runModuleImageTask(syncScope, generate)]));
        expect(generate).toHaveBeenCalledTimes(1);

        const video = await createVideoTake({
          storyId: story.id, userId: 2, stableShotId: "synthetic-shot", model: "mock", prompt: "Synthetic fixture",
        });
        await forWeb(() => recordGenerationSubmitted(2, "video", video.id));
        const ready = await updateVideoTake(video.id, 2, {
          status: "available", videoKey: "synthetic.mp4", videoUrl: "/synthetic.mp4",
        });
        await Promise.all([recordVideoAvailability(ready), recordVideoAvailability(ready)]);
        await web.journeySignal({ eventName: "result.opened", subjectKind: "video", subjectRef: video.id });

        const input = { from, through: activityBeijingDate(Date.now()), platform: "web" as const, category: "unclassified" as const };
        const report = await admin.journeySummary(input);
        expect(report.rows).toEqual([expect.objectContaining({
          enteredAccounts: 1, entries: 1, enteredThenSubmittedAttempts: 8,
          submittedAttempts: 8, imageAttempts: 5, videoAttempts: 3, succeededAttempts: 3,
          failedAttempts: 1, cancelledAttempts: 1, timeoutAttempts: 0, unknownAttempts: 2,
          pendingAttempts: 1, openedAttempts: 2,
        })]);
        const exported = await admin.journeyExport(input);
        expect(exported.split("\r\n")).toHaveLength(3);
        expect(exported).not.toMatch(/synthetic|userId|visitKey|subjectRef|attemptKey/);
        const [counts] = await db.query("SELECT eventName, COUNT(*) AS total FROM activity_journey_v2_events GROUP BY eventName");
        expect(counts).toEqual(expect.arrayContaining([
          { eventName: "creation.entered", total: 1 }, { eventName: "generation.submitted", total: 8 },
          { eventName: "result.opened", total: 2 },
        ]));
        vi.stubEnv("ACTIVITY_JOURNEY_ENABLED", "false");
        await forWeb(() => recordGenerationSubmitted(2, "video", 201));
        await recordGenerationResolved(2, "video", 200, "succeeded", [200]);
        expect(await admin.journeySummary(input)).toMatchObject({ enabled: false, rows: report.rows });
        await admin.setCategory({ userId: 2, category: "test" });
        const reclassified = await admin.journeySummary({ ...input, category: "test" });
        expect(reclassified.rows[0]).toMatchObject({ category: "test", submittedAttempts: 8, openedAttempts: 2 });
        const previous = await admin.journeySummary(input);
        expect(previous.rows[0]).toMatchObject({ submittedAttempts: 0, successAttemptRate: null });

        // A broken analytics table must never prevent a candidate or its existing settlement.
        vi.stubEnv("ACTIVITY_JOURNEY_ENABLED", "true");
        await db.query("RENAME TABLE activity_journey_v2_events TO synthetic_activity_unavailable");
        try {
          const missing = await forWeb(() => register("synthetic-during-analytics-outage"));
          await markRequestSent(store, missing.row.id);
          const durable = await completeTask(deps, missing.row.id, images);
          expect(durable).toMatchObject({ status: "succeeded", settlement: "charged" });
          expect(settle).toHaveBeenCalledWith("synthetic-during-analytics-outage", { kind: "succeeded_at_quote" });
        } finally {
          await db.query("RENAME TABLE synthetic_activity_unavailable TO activity_journey_v2_events");
        }

      } finally {
        await db.end();
        await (await getDb())?.$client.end();
        vi.unstubAllEnvs();
      }
    });
  });
});
