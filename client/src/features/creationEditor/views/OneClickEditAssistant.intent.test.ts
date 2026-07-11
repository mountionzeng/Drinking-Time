import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "client/src/features/creationEditor/views/OneClickEditAssistant.tsx"
  ),
  "utf8"
);

function handlerSource(start: string, end: string) {
  const startIndex = source.indexOf(start);
  return source.slice(startIndex, source.indexOf(end, startIndex));
}

describe("OneClickEditAssistant selection intent", () => {
  it("opens with no video shots selected", () => {
    const openHandler = handlerSource(
      "const handleOpenChange",
      "const handleTargetAspectRatioChange"
    );

    expect(openHandler).toContain("setSelectedVideoKeys(new Set());");
    expect(openHandler).not.toContain("new Set(selectableVideoKeys)");
  });

  it("clears the selection when the target aspect ratio changes", () => {
    const aspectHandler = handlerSource(
      "const handleTargetAspectRatioChange",
      "const toggleTake"
    );

    expect(aspectHandler).toContain("setSelectedVideoKeys(new Set());");
    expect(aspectHandler).not.toContain("report.checks.flatMap");
  });

  it("asks the user to select a shot when candidates are available", () => {
    const actionButton = handlerSource(
      "disabled={conforming || selectedCount === 0}",
      "</button>"
    );

    expect(actionButton).toContain("请先勾选镜头");
    expect(actionButton).toContain("没有待统一的视频");
  });
});
