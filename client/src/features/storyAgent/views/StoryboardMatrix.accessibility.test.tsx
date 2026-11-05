import React from "react";
import { UiLanguageContext } from "@/features/uiLanguage/UiLanguage";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  STORYBOARD_MATRIX_ROWS,
  STORYBOARD_MATRIX_VISIBLE_ROWS,
  StoryboardMatrixFieldCell,
  StoryboardVoiceCell,
  StoryboardVideoButtonContent,
  StoryboardVideoBlockHint,
} from "./StoryboardMatrix";

vi.stubGlobal("React", React);

describe("StoryboardMatrixFieldCell accessibility", () => {
  it("keeps a narration failure beside its button without removing existing audio", () => {
    const props: React.ComponentProps<typeof StoryboardVoiceCell> = {
      shot: {
        shotNo: 2,
        dialogue: "原旁白",
        sound: "环境声",
        voiceAudioUrl: "/existing.mp3",
        voiceAudioText: "原旁白",
      } as React.ComponentProps<typeof StoryboardVoiceCell>["shot"],
      shotLabel: "02", selected: false, editable: true, generating: false,
      onFocus: vi.fn(), onCommit: vi.fn(), onGenerate: vi.fn(),
      generationError: "配音服务暂时不可用，未扣费，请稍后重试",
    };
    const html = renderToStaticMarkup(<StoryboardVoiceCell {...props} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain(props.generationError);
    expect(html).toContain('/existing.mp3');
    expect(html.match(/<button/g)).toHaveLength(1);
    const pending = renderToStaticMarkup(<StoryboardVoiceCell {...props} generating />);
    expect(pending).not.toContain('role="alert"');
    expect(pending).toContain("生成中");
    const cleared = renderToStaticMarkup(<StoryboardVoiceCell {...props} generationError="" />);
    expect(cleared).not.toContain('role="alert"');
  });
  it("labels one-result, four-candidate and free local render costs explicitly", () => {
    const single = renderToStaticMarkup(<StoryboardVideoButtonContent checking={false} busy={false} estimatedCny={0.54} />);
    expect(single).toContain("生成1条视频");
    expect(single).toContain("总计约 1.08 算力");
    const batch = renderToStaticMarkup(<StoryboardVideoButtonContent checking={false} busy={false} estimatedCny={4.04} candidateCount={4} />);
    expect(batch).toContain("生成4条视频");
    expect(batch).toContain("总计约 8.08 算力");
    const local = renderToStaticMarkup(<StoryboardVideoButtonContent checking={false} busy={false} estimatedCny={0} />);
    expect(local).toContain("生成本地动画");
    expect(local).toContain("免费 · 不调用AI");
  });
  it("explains a missing image without implying a video is running", () => {
    const html = renderToStaticMarkup(<StoryboardVideoBlockHint reason="需要先选择当前主图" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('先选中镜头，再到仓库把图片设为当前首帧。');
    expect(html).not.toContain('animate-spin');
    expect(renderToStaticMarkup(<StoryboardVideoBlockHint reason={null} />)).toBe('');
    const english = renderToStaticMarkup(<UiLanguageContext.Provider value={{ language: 'en', setLanguage: () => {} }}>
      <StoryboardVideoBlockHint reason="需要先选择当前主图" />
    </UiLanguageContext.Provider>);
    expect(english).toContain('Select a shot, then set its image as the current first frame in Library.');
  });
  it("associates the script description with its editable cell", () => {
    const row = STORYBOARD_MATRIX_ROWS.find(item => item.field === "scriptText")!;
    const html = renderToStaticMarkup(
      <StoryboardMatrixFieldCell
        value="可表演的剧本"
        row={row}
        shotLabel="01"
        selected={false}
        dropTarget={false}
        editable
        onFocus={vi.fn()}
        onCommit={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
      />
    );

    expect(html).toContain('aria-describedby="storyboard-scriptText-01-description"');
    expect(html).toContain('id="storyboard-scriptText-01-description"');
    expect(html).toContain("文字稿转写 · 可表演/可执行");
  });

  it("shows one voice row with separate narration and sound editing", () => {
    expect(STORYBOARD_MATRIX_VISIBLE_ROWS.map(row => row.field)).toEqual([
      "promptDraft",
      "videoPrompt",
      "dialogue",
    ]);
    const videoRow = STORYBOARD_MATRIX_ROWS.find(
      item => item.field === "videoPrompt"
    )!;
    expect(`${videoRow.description} ${videoRow.placeholder}`).not.toMatch(
      /旁白|声音/
    );

    const html = renderToStaticMarkup(
      <StoryboardVoiceCell
        shot={{
          shotNo: 1,
          subject: "人物",
          action: "抬头",
          scriptText: "文字稿原文",
          dialogue: "文字稿原文",
          shotType: "中景",
          beat: "开场",
          cameraAngle: "",
          cameraMove: "",
          location: "",
          timeLight: "",
          mood: "",
          sound: "纸张摩擦声",
          styleRef: "",
          note: "",
          emotion: "克制",
          sourceCardContent: "",
        }}
        shotLabel="0101"
        selected={false}
        editable
        generating={false}
        onFocus={vi.fn()}
        onCommit={vi.fn()}
        onGenerate={vi.fn()}
      />
    );

    expect(html).toContain("旁白 / 对白");
    expect(html).toContain("文字稿原文");
    expect(html).toContain("背景音 / 音效");
    expect(html).toContain("纸张摩擦声");
    expect(html).toContain("生成旁白");
    expect(html).toContain("0.04 算力");
  });
});
