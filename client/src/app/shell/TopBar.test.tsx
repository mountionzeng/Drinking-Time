import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TopBar from "./TopBar";
import { STORY_PANELS } from "@/features/analysis/storyPanels";

vi.stubGlobal("React", React);

vi.mock("@/features/nayin/NayinContext", () => ({
  useNayin: () => ({
    theme: { elementCn: "水" },
    allThemes: [{ element: "water", elementCn: "水" }],
    setPreviewElement: vi.fn(),
    previewElement: null,
    element: "water",
    today: {
      cstDateStr: "2026-06-17",
      ganzhi: "丁亥",
      nayinName: "屋上土",
      theme: { element: "water", elementCn: "水" },
      lunar: { yearGanzhi: "丙午", monthCn: "五月", dayCn: "初三" },
    },
  }),
}));

vi.mock("@/features/nayin/views/WuxingDrinkIcon", () => ({
  default: () => <span data-testid="drink-icon" />,
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { name: "Li", email: "li@example.com", role: "admin" },
    logout: vi.fn(),
  }),
}));

vi.mock("@/features/storyAgent/spine/selectors", () => ({
  useStoryPanelVisibility: () => ({
    visibleStoryPanels: ["storyboard"],
    toggleVisibleStoryPanel: vi.fn(),
  }),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe("TopBar story panel controls", () => {
  it("uses the left top area for the five story panel buttons", () => {
    const html = renderToStaticMarkup(<TopBar />);

    expect(html).toContain('aria-label="纳音五行"');
    expect(html).toContain("w-[250px]");
    expect(html).toContain("Nayin Five Elements / 纳音五行");
    expect(html).toContain("素材仓库");
    expect(html).toContain("故事卡片");
    expect(html).toContain("故事版看板");
    expect(html).toContain("动态分镜");
    expect(html).toContain("镜头设计表");
    expect(html.match(/aria-pressed=/g)).toHaveLength(STORY_PANELS.length);
    expect(html).not.toContain("Story Cards");
    expect(html).not.toContain("Script");
    expect(html).not.toContain("默认分析项目");
    expect(html).not.toContain("DRINKING TIME");
    expect(html).toContain("访问情况");
  });

  it("can hide story panel buttons on the welcome page", () => {
    const html = renderToStaticMarkup(<TopBar showStoryPanelNav={false} />);

    expect(html).toContain('aria-label="纳音五行"');
    expect(html).not.toContain("素材仓库");
    expect(html).not.toContain("故事卡片");
    expect(html).not.toContain("故事版看板");
    expect(html).not.toContain("动态分镜");
    expect(html).not.toContain("镜头设计表");
  });

  it("uses the same top navigation position for a timeline visibility toggle", () => {
    const html = renderToStaticMarkup(
      <TopBar
        showStoryPanelNav={false}
        panelToggle={{
          label: "时间线",
          active: true,
          onToggle: vi.fn(),
        }}
      />
    );

    expect(html).toContain('aria-label="剪辑面板切换"');
    expect(html).toContain('data-testid="topbar-panel-toggle"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="隐藏时间线"');
    expect(html).toContain("时间线");
    expect(html).not.toContain("故事版看板");
  });

  it("supports independent material warehouse and timeline toggles", () => {
    const html = renderToStaticMarkup(
      <TopBar
        showStoryPanelNav={false}
        panelToggles={[
          {
            label: "素材仓库",
            active: false,
            controls: "editing-material-warehouse",
            testId: "topbar-material-warehouse-toggle",
            onToggle: vi.fn(),
          },
          {
            label: "时间线",
            active: true,
            testId: "topbar-timeline-toggle",
            onToggle: vi.fn(),
          },
        ]}
      />
    );

    expect(html).toContain('data-testid="topbar-material-warehouse-toggle"');
    expect(html).toContain('aria-label="显示素材仓库"');
    expect(html).toContain('aria-controls="editing-material-warehouse"');
    expect(html).toContain('data-testid="topbar-timeline-toggle"');
    expect(html).toContain('aria-label="隐藏时间线"');
    expect(html.match(/aria-pressed=/g)).toHaveLength(2);
  });
});
