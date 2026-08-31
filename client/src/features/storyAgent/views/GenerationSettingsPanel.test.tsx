import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

import {
  CreatorSeasonSettingsView,
  seasonSettingsStatusLabel,
} from "./GenerationSettingsPanel";

const actions = {
  onProfileChange: vi.fn(),
  onTimeZoneChange: vi.fn(),
  onUseBrowserSuggestion: vi.fn(),
  onSave: vi.fn(),
  onClear: vi.fn(),
};

describe("CreatorSeasonSettingsView", () => {
  it("labels a browser zone as an unsaved suggestion", () => {
    const html = renderToStaticMarkup(
      <CreatorSeasonSettingsView
        {...actions}
        status="suggested"
        profile="unknown"
        timeZone=""
        browserSuggestion="Asia/Shanghai"
        saved={false}
      />
    );
    expect(html).toContain("浏览器建议：Asia/Shanghai（尚未保存）");
    expect(html).toContain("浏览器时区只是建议，尚未用于生成");
    expect(html).toContain("不会读取 GPS、IP");
    expect(html).toContain("未知（不猜服装）");
  });

  it("announces busy state and disables conflicting actions", () => {
    const html = renderToStaticMarkup(
      <CreatorSeasonSettingsView
        {...actions}
        status="saving"
        profile="northern_four_seasons"
        timeZone="Asia/Shanghai"
        browserSuggestion={null}
        saved={false}
      />
    );
    expect(html).toContain("正在保存季节设置");
    expect(html).toContain('role="status"');
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("keeps dirty values visible after a save error", () => {
    const html = renderToStaticMarkup(
      <CreatorSeasonSettingsView
        {...actions}
        status="save_error"
        profile="southern_four_seasons"
        timeZone="Australia/Sydney"
        browserSuggestion={null}
        saved={false}
      />
    );
    expect(html).toContain('value="southern_four_seasons"');
    expect(html).toContain('value="Australia/Sydney"');
    expect(html).toContain("保存失败，编辑内容仍保留");
  });

  it("distinguishes cleared saved state from a browser suggestion", () => {
    const html = renderToStaticMarkup(
      <CreatorSeasonSettingsView
        {...actions}
        status="cleared"
        profile="unknown"
        timeZone=""
        browserSuggestion="Asia/Shanghai"
        saved
      />
    );
    expect(html).toContain("已保存设置");
    expect(html).toContain("季节设置已清除，将不猜测服装");
    expect(html).not.toContain("浏览器建议：");
  });

  it("has explicit conflict copy", () => {
    expect(seasonSettingsStatusLabel("revision_conflict")).toContain(
      "已重新载入当前值"
    );
  });
});
