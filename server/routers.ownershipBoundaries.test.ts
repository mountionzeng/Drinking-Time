import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const routersDir = path.join(import.meta.dirname, "routers");

/**
 * `protectedProcedure` only proves the caller is logged in — it says nothing
 * about whether the resource they named is theirs. Any procedure that accepts a
 * `projectId` and uses it as an access key must therefore prove ownership too,
 * or an authenticated user can read/write another user's data by passing their
 * id. Six procedures had drifted this way; this guard exists so the seventh
 * fails the build instead of shipping.
 *
 * The guard fails CLOSED: every projectId-accepting procedure is a violation
 * unless it either verifies ownership itself, or appears in the allowlist below
 * with a reason. Adding a procedure to the allowlist is a deliberate, reviewable
 * act; forgetting to guard a new one is not silently tolerated.
 */

/**
 * Procedures where `projectId` genuinely is only a label written onto rows that
 * are themselves owner-scoped by another key — ownership is enforced via
 * `getStoryById(storyId, ctx.user.id)` or by writing `userId: ctx.user.id`.
 * Passing someone else's projectId here mislabels your OWN row; it does not
 * read or write theirs.
 *
 * Keep this list SHORT and verify every entry by following projectId to its
 * sinks. An earlier version of this file exempted storyAgent chat/mobileChat
 * and creationAgent chat/generateNextImage/inpaint on exactly this reasoning
 * and the reasoning was wrong: they pass projectId into `getRecentAnnotations`
 * / `getRecentEditPreferences` / `getRecentChatCorrections`, which filter on
 * projectId alone — a live cross-tenant read. An allowlist that certifies a
 * hole as safe is worse than no guard, because it keeps the build green and
 * tells the next reader the question was already settled.
 */
const projectIdIsLabelOnly = new Map<string, string>([
  [
    "storyAgent.ts:classify",
    "写镜头前用 getStoryById(storyId, ctx.user.id) 校验归属，projectId 仅作列值",
  ],
  [
    "storyAgent.ts:storyUpsert",
    "用 getStoryById + userId 校验，projectId 仅作列值",
  ],
  [
    "index.ts:saveBirthProfile",
    "projectId 可选且只作标签，画像按 userId upsert 自己的",
  ],
]);

// A bare textual mention is not proof of authorization — require the call to
// actually carry the session user id.
const ownershipVerifiers = [
  /assertProjectOwner\(\s*input\.projectId\s*,\s*ctx\.user\.id/,
  /assertOptionalProjectOwner\(\s*input\.projectId\s*,\s*ctx\.user\.id/,
  /getProjectById\([^)]*ctx\.user\.id[^)]*\)/,
];

async function routerSources() {
  const entries = await fs.readdir(routersDir, { withFileTypes: true });
  return Promise.all(
    entries
      .filter(
        entry =>
          entry.isFile() &&
          entry.name.endsWith(".ts") &&
          !entry.name.endsWith(".test.ts")
      )
      .map(async entry => ({
        file: entry.name,
        content: await fs.readFile(path.join(routersDir, entry.name), "utf8"),
      }))
  );
}

/**
 * Splits a router file into `[procedureName, kind, body]` triples.
 *
 * `publicProcedure` must be in the split pattern even though it can never be
 * allowlisted: if it were omitted, a public procedure sitting after a guarded
 * one would have its `projectId` text absorbed into the guarded procedure's
 * body, and the guard would report zero violations for the worst case there is
 * — an unauthenticated procedure taking a projectId.
 */
function procedureBlocks(content: string): Array<[string, string, string]> {
  const marks: Array<[number, string, string]> = [];
  const pattern =
    /(\w+):\s*(protectedProcedure|adminProcedure|publicProcedure)\b/g;
  for (const match of content.matchAll(pattern)) {
    marks.push([match.index, match[1], match[2]]);
  }
  return marks.map(([start, name, kind], index) => {
    const end = index + 1 < marks.length ? marks[index + 1][0] : content.length;
    return [name, kind, content.slice(start, end)] as [string, string, string];
  });
}

describe("router ownership boundaries", () => {
  it("verifies project ownership on every procedure that accepts a projectId", async () => {
    const sources = await routerSources();
    const violations: string[] = [];

    for (const { file, content } of sources) {
      for (const [name, kind, body] of procedureBlocks(content)) {
        // Only procedures that actually declare projectId in their input.
        if (!/projectId:\s*z\./.test(body)) continue;
        const key = `${file}:${name}`;
        // An unauthenticated procedure taking a projectId is never acceptable,
        // allowlist or not — there is no session user to check ownership against.
        if (kind === "publicProcedure") {
          violations.push(`${key} (publicProcedure)`);
          continue;
        }
        if (projectIdIsLabelOnly.has(key)) continue;
        if (ownershipVerifiers.some(verifier => verifier.test(body))) continue;
        violations.push(key);
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps the label-only allowlist honest — every entry must still exist", async () => {
    // A stale allowlist entry silently widens the guard's blind spot: the
    // procedure may have been renamed or deleted while its exemption lingers.
    const sources = await routerSources();
    const present = new Set<string>();
    for (const { file, content } of sources) {
      for (const [name, , body] of procedureBlocks(content)) {
        if (/projectId:\s*z\./.test(body)) present.add(`${file}:${name}`);
      }
    }

    const stale = [...projectIdIsLabelOnly.keys()].filter(
      key => !present.has(key)
    );

    expect(stale).toEqual([]);
  });

  it("keeps every projectId-accepting procedure inside the scanned directory", async () => {
    // routerSources() only walks server/routers/. A procedure defined outside
    // it and mounted into appRouter would never be checked by the guard above.
    // Rather than pin an exact file list (which churns on unrelated additions
    // and trips over procedures mentioned in doc comments), assert the thing
    // that actually matters: nothing outside server/routers/ takes a projectId.
    const { execSync } = await import("node:child_process");
    const serverRoot = import.meta.dirname;
    const candidates = execSync(
      `grep -rl "protectedProcedure\\|publicProcedure\\|adminProcedure" "${serverRoot}" --include="*.ts" || true`,
      { encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean)
      .map(file => path.relative(serverRoot, file))
      .filter(file => !file.endsWith(".test.ts"))
      .filter(file => !file.startsWith("routers/"))
      .filter(file => file !== "_core/trpc.ts");

    const unscanned: string[] = [];
    for (const file of candidates) {
      const content = await fs.readFile(path.join(serverRoot, file), "utf8");
      for (const [name, , body] of procedureBlocks(content)) {
        if (/projectId:\s*z\./.test(body)) unscanned.push(`${file}:${name}`);
      }
    }

    // If this fails: move the procedure under server/routers/, or widen
    // routerSources() so the ownership guard above covers it.
    expect(unscanned).toEqual([]);
  });
});
