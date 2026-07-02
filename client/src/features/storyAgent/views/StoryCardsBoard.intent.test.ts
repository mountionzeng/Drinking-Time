import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("StoryCardsBoard intent entry", () => {
  it("does not keep the old StoryIntentGate entry point on the cards board", () => {
    const boardSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryCardsBoard.tsx"),
      "utf8"
    );

    expect(boardSource).not.toContain("StoryIntentGate");
    expect(boardSource).not.toContain("generateScript(confirmedIntent");
    expect(
      existsSync(
        resolve(
          root,
          "client/src/features/storyAgent/views/StoryIntentGate.tsx"
        )
      )
    ).toBe(false);
  });

  it("keeps the storyboard review board in the right-side storyboard panel", () => {
    const boardSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryCardsBoard.tsx"),
      "utf8"
    );
    const panelSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryboardPanel.tsx"),
      "utf8"
    );

    expect(boardSource).toContain("故事版看板");
    expect(boardSource).toContain("StoryboardReviewBoard");
    expect(boardSource).not.toContain("<StoryboardReviewBoard");
    expect(panelSource).toContain("<StoryboardReviewBoard");
    expect(panelSource).toContain("整理好求职优势后");
    expect(boardSource).toContain("GenerationSettingsPanel");
    expect(boardSource).toContain("aria-label=\"剧本生成设置\"");
    expect(boardSource).toContain("aria-label=\"美术生成设置\"");
    expect(boardSource).toContain("generationProfile");
    expect(boardSource).toContain("generateScript(undefined, generationProfile)");
    expect(boardSource).toContain("onSelectArtLibrary");
    expect(boardSource).toContain("先用于本次生成，故事保存后可绑定");
    expect(boardSource).not.toContain("叙事风格");
    expect(boardSource).not.toContain("美术风格");
    expect(boardSource).not.toContain("artDirection={artDirection}");
    expect(boardSource).not.toContain("onUpdateAllShotsField");
    expect(boardSource).toContain("导演理由");
    expect(boardSource).toContain("ShotMaterialBasket");
    expect(boardSource).toContain('useState<"full" | "simple">("simple")');
    expect(boardSource).toContain("setViewMode(\"simple\")");
    expect(boardSource).toContain("openFullShot");
    expect(boardSource).toContain("storyboardScriptText");
    expect(boardSource).toContain("snap-y snap-mandatory");
    expect(boardSource).not.toContain("snap-x snap-mandatory");
    expect(
      readFileSync(
        resolve(
          root,
          "client/src/features/storyAgent/views/ShotMaterialBasket.tsx"
        ),
        "utf8"
      )
    ).toContain("视频的生成、预览和采用都在故事版看板完成");
    expect(boardSource).toContain("confirmFictionStoryCards");
    expect(boardSource).toContain("pendingIntentDraft");
    expect(boardSource).toContain("hasPendingFictionIntent");
    expect(boardSource).toContain("handlePrimaryAction");
    expect(boardSource).toContain("primaryActionDisabled");
    expect(boardSource).toContain("确认意图");
    expect(boardSource).toContain("先确认虚构故事卡");
    expect(boardSource).toContain("确认故事卡");
    expect(boardSource).toContain("shouldGateFictionStoryboard");
    expect(panelSource).toContain("generateShotVideo");
    expect(panelSource).toContain("refreshShotVideoStatus");
    expect(panelSource).toContain("shotVideoProviderStatus");
    expect(boardSource).toContain(
      "shotVideoProviderStatus={shotVideoProviderStatus}"
    );
    expect(boardSource).toContain("latestStoryboardFrames");
    expect(boardSource).not.toContain("trpc.storyAgent.cycleStyle");
  });

  it("keeps the server recognizeIntent route for the background direct-speech entry", () => {
    const routerSource = readFileSync(
      resolve(root, "server/routers.ts"),
      "utf8"
    );

    expect(routerSource).toContain("recognizeIntent: protectedProcedure");
    expect(routerSource).toContain("recognizeStoryIntent");
  });
});
