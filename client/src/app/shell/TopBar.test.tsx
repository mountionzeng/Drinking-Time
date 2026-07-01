import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TopBar from './TopBar';

vi.stubGlobal('React', React);

vi.mock('@/features/nayin/NayinContext', () => ({
  useNayin: () => ({
    theme: { elementCn: '水' },
    allThemes: [{ element: 'water', elementCn: '水' }],
    setPreviewElement: vi.fn(),
    previewElement: null,
    element: 'water',
    today: {
      cstDateStr: '2026-06-17',
      ganzhi: '丁亥',
      nayinName: '屋上土',
      theme: { element: 'water', elementCn: '水' },
      lunar: { yearGanzhi: '丙午', monthCn: '五月', dayCn: '初三' },
    },
  }),
}));

vi.mock('@/features/nayin/views/WuxingDrinkIcon', () => ({
  default: () => <span data-testid="drink-icon" />,
}));

vi.mock('@/_core/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { name: 'Li', email: 'li@example.com' },
    logout: vi.fn(),
  }),
}));

vi.mock('@/features/storyAgent/spine/selectors', () => ({
  useStoryPanelVisibility: () => ({
    visibleStoryPanels: ['storyboard'],
    toggleVisibleStoryPanel: vi.fn(),
  }),
}));

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('TopBar story panel controls', () => {
  it('uses the left top area for the four story panel buttons', () => {
    const html = renderToStaticMarkup(<TopBar />);

    expect(html).toContain('aria-label="纳音五行"');
    expect(html).toContain('w-[250px]');
    expect(html).toContain('Nayin Five Elements / 纳音五行');
    expect(html).toContain('故事卡片');
    expect(html).toContain('故事版看板');
    expect(html).toContain('动态分镜');
    expect(html).toContain('镜头设计表');
    expect(html.match(/aria-pressed=/g)).toHaveLength(4);
    expect(html).not.toContain('Story Cards');
    expect(html).not.toContain('Script');
    expect(html).not.toContain('默认分析项目');
    expect(html).not.toContain('DRINKING TIME');
  });
});
