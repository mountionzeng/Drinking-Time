import { createRequire } from "node:module";
import path from "node:path";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { withMysqlTestDatabase } from "./mysqlTestHarness";
const access = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../repositories/runtime", async original => ({
  ...(await original<typeof import("../repositories/runtime")>()),
  getDb: access.getDb,
}));
vi.mock("../db", async original => ({
  ...(await original<typeof import("../db")>()),
  getDb: access.getDb,
}));
import { resolveWechatAccount } from "../services/accountIdentity";
import { createWebLoginRequest, confirmWebLoginBySubject, pollWebLoginRequest } from "../services/webLogin";
import { ENV } from "../_core/env";
import { createWechatBookImportService } from "../services/wechatBookImport";
import { listChapters, saveChapterContent } from "../repositories/chapters";
import {
  wechatImportSubject,
  ownsWechatImportImage,
} from "../repositories/wechatBookImport";
const integration =
  process.env.TEST_MYSQL_DATABASE_URL && process.env.WECHAT_NATIVE_REPO
    ? it
    : it.skip;
integration(
  "verified native identity → signed native catalog/media → atomic MySQL book → save/retry/new revision",
  async () => {
    const require = createRequire(import.meta.url);
    const { fixture } = require(
      path.join(
        process.env.WECHAT_NATIVE_REPO!,
        "tests/helpers/web-import-fixture.js"
      )
    );
    const { webImport } = require(
      path.join(
        process.env.WECHAT_NATIVE_REPO!,
        "cloudfunctions/storyDesktopAccess/webImport.js"
      )
    );
    const f = fixture();
    await f.ready();
    f.options.download = async () =>
      sharp({
        create: { width: 2, height: 2, channels: 3, background: "#fff" },
      })
        .png()
        .toBuffer();
    vi.stubEnv(
      "CHAPTER_MEDIA_DIR",
      path.join(path.dirname(process.env.LOCAL_PERSIST_PATH!), "media")
    );
    await withMysqlTestDatabase(async database => {
      const pool = mysql.createPool({
        uri: database.databaseUrl,
        connectionLimit: 8,
      });
      access.getDb.mockResolvedValue(drizzle(pool));
      try {
        const ids = await Promise.all(
          Array.from({ length: 4 }, () => resolveWechatAccount(f.subject))
        );
        expect(new Set(ids).size).toBe(1);
        const userId = ids[0];
        expect(await wechatImportSubject(userId)).toBe(f.subject);
        const priorSecret=ENV.otpDigestSecret;
        ENV.otpDigestSecret="mysql-wechat-qr-isolated-test-secret";
        try {
          const login=await createWebLoginRequest({requestIp:"qr-test",qr:true});
          if(login.outcome!=="created")throw new Error(login.outcome);
          const {webLoginBody}=require(path.join(process.env.WECHAT_NATIVE_REPO!,"cloudfunctions/drinkingTimeBridge/core.js"));
          expect(await confirmWebLoginBySubject(webLoginBody({code:login.code,decision:"preview"},f.context))).toMatchObject({outcome:"preview"});
          expect(await pollWebLoginRequest({l:login.l,v:login.v,requestIp:"qr-test"})).toEqual({status:"scanned"});
          expect(await confirmWebLoginBySubject(webLoginBody({code:login.code,decision:"confirm"},f.context))).toEqual({outcome:"confirmed"});
          expect(await pollWebLoginRequest({l:login.l,v:"x".repeat(43),requestIp:"other"})).toEqual({status:"expired"});
          expect(await pollWebLoginRequest({l:login.l,v:login.v,requestIp:"qr-test"})).toMatchObject({status:"confirmed",userId});
          expect(await pollWebLoginRequest({l:login.l,v:login.v,requestIp:"qr-test"})).toEqual({status:"expired"});
          const [beforeImport]=await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM stories");
          expect(Number(beforeImport[0].n)).toBe(0);
        } finally { ENV.otpDigestSecret=priorSecret; }
        const api = createWechatBookImportService({
          request: async (subject, input) => {
            expect(subject).toBe(f.subject);
            return webImport(f.repo, f.signed(input), f.options);
          },
        });
        const before = JSON.stringify(
          f.data.get("biography_drafts/family_demo_revision-one")
        );
        expect((await api.catalog(userId)).stories).toHaveLength(1);
        const results = await Promise.all(
          Array.from({ length: 4 }, () => api.importBook(userId, f.ref))
        );
        expect(new Set(results.map(r => r.storyId)).size).toBe(1);
        expect(results.filter(r => !r.repeated)).toHaveLength(1);
        for (const table of [
          "users",
          "account_identities",
          "stories",
          "story_chapters",
          "chapter_imports",
        ]) {
          const [rows] = await pool.query<mysql.RowDataPacket[]>(
            `SELECT COUNT(*) AS n FROM ${table}`
          );
          expect(Number(rows[0].n)).toBe(1);
        }
        const [chapter] = await listChapters(results[0].storyId, userId);
        expect(
          chapter.blocks.writingStyle?.filter(r => r.format === "heading1")
        ).toHaveLength(3);
        expect(Object.keys(chapter.blocks.images)).toHaveLength(1);
        const imageKey = Object.keys(chapter.blocks.images)[0];
        expect(await ownsWechatImportImage(userId, imageKey)).toBe(true);
        expect(await ownsWechatImportImage(userId + 1, imageKey)).toBe(false);
        expect(
          await ownsWechatImportImage(userId, `chapters/${userId}/missing.png`)
        ).toBe(false);
        const blocks = {
          ...chapter.blocks,
          body: chapter.blocks.body + "\n网页独立草稿",
        };
        delete blocks.writingStyle;
        await saveChapterContent({
          id: chapter.id,
          userId,
          expectedVersion: chapter.version,
          content: { blocks },
          reason: "用户编辑",
        });
        expect((await api.importBook(userId, f.ref)).repeated).toBe(true);
        expect(
          (await listChapters(chapter.storyId, userId))[0].blocks.body
        ).toContain("网页独立草稿");
        expect((await api.catalog(userId)).stories[0].importedStoryId).toBe(
          chapter.storyId
        );
        expect(
          JSON.stringify(
            f.data.get("biography_drafts/family_demo_revision-one")
          )
        ).toBe(before);
        await expect(api.importBook(userId + 1, f.ref)).rejects.toThrow(
          "请先使用微信登录"
        );
        const next = { ...f.ref, revisionId: "revision-two", version: 2 },
          row = f.data.get("biography_drafts/family_demo_revision-one");
        f.data.set("biography_drafts/family_demo_revision-two", {
          ...row,
          revision: { ...row.revision, id: next.revisionId },
        });
        Object.assign(f.data.get("stories/family_demo_story-demo"), {
          currentRevisionId: next.revisionId,
          version: 2,
        });
        const newer = await api.importBook(userId, next);
        expect(newer.storyId).not.toBe(chapter.storyId);
        expect(
          (await listChapters(chapter.storyId, userId))[0].blocks.body
        ).toContain("网页独立草稿");
      } finally {
        await pool.end();
      }
    });
  },
  120000
);
