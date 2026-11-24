import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import { WarehouseRenderCards } from "./WarehouseRenderCards";
import type { WarehouseRenderJob } from "../warehouseRenderActivity";
import type { CreationEditorShot } from "../types";
vi.stubGlobal("React", React);
const job: WarehouseRenderJob = { id: "r", storyId: 7, shotId: "a", kind: "image", startedAt: 1000, state: "rendering" };
const shots = [{ shotNo: 2, stableShotId: "a" }] as CreationEditorShot[];
function view(jobs: WarehouseRenderJob[], language: "zh" | "en" = "zh") {
  return renderToStaticMarkup(<UiLanguageContext.Provider value={{ language, setLanguage: vi.fn() }}><WarehouseRenderCards jobs={jobs} shots={shots} /></UiLanguageContext.Provider>);
}
it("shows compact, non-blocking media placeholders without adding action buttons", () => {
  const html = view([job, { ...job, id: "a", kind: "audio" }, { ...job, id: "v", kind: "video" }]);
  expect(html).toContain("第 02 镜");
  expect(html).toContain("生成中 / Generating");
  expect(html).toContain("overflow-x-auto");
  expect(html).toContain("motion-reduce:animate-none");
  expect(html).not.toMatch(/<button|disabled|dialog|[0-9]%/);
});
it("stops spinners for unknown/failed results and shows the completed image", () => {
  const html = view([{ ...job, state: "unknown" }, { ...job, id: "f", state: "failed" }, { ...job, id: "r2", state: "ready", url: "/ready.png" }]);
  expect(html).not.toContain("animate-spin");
  expect(html).toContain("/ready.png");
  expect(html).toContain("状态待确认");
  expect(html).toContain("生成失败");
});
it("uses English labels throughout English mode", () => {
  const html = view([job], "en");
  expect(html).toContain("Shot 02");
  expect(html).toContain("Generating");
  expect(html).not.toMatch(/[\u4e00-\u9fff]/);
});

it("offers a fresh single-shot estimate and feedback after repeated failures", () => {
  const html = view([{ ...job, state: "failed", error: "参考图已更新", failureCount: 2, previewRetry: { failedId: "r", version: 1 } }]);
  expect(html).toContain("参考图已更新");
  expect(html).toContain("重新渲染");
  expect(html).toContain("已失败 2 次 · 反馈问题");
  const old = view([{ ...job, state: "failed" }]);
  expect(old).toContain("反馈问题");
  expect(old).not.toContain("重新渲染");
});

it("only attaches a reference action when a ready image has an asset id", () => {
  const ready = { ...job, state: "ready" as const, url: "/ready.png" };
  const html = renderToStaticMarkup(<WarehouseRenderCards shots={shots} onReference={vi.fn()}
    jobs={[{ ...ready, assetId: 123 }, { ...ready, id: "without-id" }, { ...job, id: "pending", assetId: 234 }]} />);
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).toContain("123");
});
