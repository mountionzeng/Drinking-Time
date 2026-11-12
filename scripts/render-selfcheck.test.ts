import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkBreakerLog, checkProfiles, checkStoryboardTasks, checkTempFiles, checkVideoTakes, currentVideoRoute, parseEnvFile } from "./render-selfcheck";

describe("render selfcheck", () => {
  it("reports duplicate .env keys without exposing values", () => {
    const report = parseEnvFile("API302_KEY=secret-one\nFOO=1\n# comment\nAPI302_KEY=secret-two\nFOO=1\n");
    expect(report.duplicates).toEqual([
      { key: "API302_KEY", lines: [1, 4], valuesDiffer: true },
      { key: "FOO", lines: [2, 5], valuesDiffer: false },
    ]);
    expect(report.values.get("API302_KEY")).toBe("secret-two"); // dotenv: last wins
    expect(JSON.stringify(report.duplicates)).not.toContain("secret");
  });

  it("flags missing env per render profile", () => {
    const env = (key: string) => ({ API302_KEY: "x", VIDEO_302_SUBMIT_PATH: "/302/v2/video/{model}" } as Record<string, string>)[key] ?? "";
    const messages = checkProfiles(env).map(f => `${f.severity}:${f.message}`);
    expect(messages.some(m => m.startsWith("warn:MJ 出图（Legnext）") && m.includes("LEGNEXT_API_KEY"))).toBe(true);
    expect(messages.some(m => m.includes("自定义路径") && m.includes("VIDEO_302_MODEL") && m.includes("VIDEO_302_POLL_PATH"))).toBe(true);
    expect(messages.some(m => m.startsWith("ok:MJ 出图（302）"))).toBe(true);
  });

  it("separates releasable stuck shot locks from protected ones", () => {
    const now = Date.now();
    const findings = checkStoryboardTasks([{ id: 7, body: { storyboardImageTasks: [
      { shotIdentity: "a", status: "preparing", createdAt: now - 3_600_000 },
      { shotIdentity: "b", status: "unknown", createdAt: now - 60_000 },
      { shotIdentity: "c", status: "accepted", providerTaskId: "legnext:x", createdAt: now - 60_000 },
      { shotIdentity: "d", status: "succeeded" },
    ] } }], now);
    expect(findings).toHaveLength(3);
    expect(findings[0]!.message).toContain("下次生成会自动释放");
    expect(findings[1]!.message).toContain("保护期");
    expect(findings[2]!.severity).toBe("warn");
  });

  it("detects video takes whose submission route differs from current config", () => {
    const route = currentVideoRoute(key => ({ VIDEO_302_SUBMIT_PATH: "/mj/submit/video", API302_BASE_URL: "https://api.302ai.cn" } as Record<string, string>)[key] ?? "");
    const findings = checkVideoTakes([
      { id: 1, status: "processing", parameterSnapshot: { submitPath: "/mj-turbo/submit/video", pollPath: "/mj-turbo/task/{taskId}/fetch", submitUrl: "https://api.302.ai/mj-turbo/submit/video" } },
      { id: 2, status: "processing", parameterSnapshot: {} },
      { id: 3, status: "available", parameterSnapshot: {} },
    ], route);
    const text = findings.map(f => f.message).join("\n");
    expect(text).toContain("take #1");
    expect(text).toContain("提交路径、查询路径、接口域名");
    expect(text).toContain("1 条处理中的视频没有提交快照");
  });

  it("counts orphaned .tmp files per target", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "selfcheck-"));
    writeFileSync(path.join(dir, "local-persist.json"), "{}");
    writeFileSync(path.join(dir, "local-persist.json.123-1787313050070-abc.tmp"), "half");
    writeFileSync(path.join(dir, "local-persist.json.456-1787313050071-def.tmp"), "half");
    const findings = checkTempFiles(dir, Date.now(), () => false);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("local-persist.json：2 个残留");
    // A fresh temp file owned by a live writer is not an orphan.
    const live = checkTempFiles(dir, Date.now(), pid => pid === 123);
    expect(live.map(f => f.message).join("\n")).toContain("1 个残留");
    expect(live.map(f => f.message).join("\n")).toContain("可能正在写盘");
  });

  it("extracts only provider keys from breaker log lines", () => {
    const findings = checkBreakerLog("[imageGen] Provider midjourney:mj paused after 3 consecutive failures\n[imageGen] Provider short cooldown (overload): gpt-image:gpt-image-2: secret prompt text\n");
    expect(findings[0]!.message).toContain("midjourney:mj ×1");
    expect(findings[0]!.message).toContain("gpt-image:gpt-image-2 ×1");
    expect(findings[0]!.message).not.toContain("secret");
    expect(checkBreakerLog("[imageGen] Provider cooldown opened")[0]!.message).toContain("旧格式");
  });
});
