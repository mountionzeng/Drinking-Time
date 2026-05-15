/**
 * TopBar — Simplified top navigation
 * Shows: project name/switcher, nayin theme button, user avatar
 */
import { useNayin } from '@/features/nayin/NayinContext';
import WuxingDrinkIcon from '@/features/nayin/views/WuxingDrinkIcon';
import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface TopBarProps {
  projects: Array<{ id: number; name: string }>;
  currentProjectId: number | null;
  onSelectProject: (id: number) => void;
}

export default function TopBar({
  projects,
  currentProjectId,
  onSelectProject,
}: TopBarProps) {
  const { theme, allThemes, setPreviewElement, previewElement, element, today } = useNayin();
  const [themeOpen, setThemeOpen] = useState(false);

  const currentProject = projects.find((p) => p.id === currentProjectId);

  return (
    <div className="sticky top-0 z-50 backdrop-blur-md">
      {/* Nayin color strip */}
      <div className="nayin-strip" />

      <div
        className="border-b px-4 py-2.5 md:px-6"
        style={{
          background:
            'linear-gradient(180deg, oklch(1 0 0 / 92%), oklch(from var(--nayin-surface) l c h / 80%))',
          borderColor: 'var(--nayin-border)',
          backdropFilter: 'blur(20px) saturate(140%)',
        }}
      >
        <div className="flex items-center justify-between gap-4">
          {/* Left: Project name/switcher */}
          <div className="flex items-center gap-3 min-w-0">
            <WuxingDrinkIcon element={element} size={36} />
            <div className="text-sm font-semibold tracking-[0.12em] text-foreground truncate">
              {currentProject?.name ?? 'DRINKING TIME'}
            </div>
            {projects.length > 1 && (
              <select
                className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-transparent text-muted-foreground"
                style={{ borderColor: 'var(--nayin-border)' }}
                value={currentProjectId ?? ''}
                onChange={(e) => onSelectProject(Number(e.target.value))}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Right: nayin + avatar */}
          <div className="flex items-center gap-2">
            {/* Nayin theme button */}
            <Popover open={themeOpen} onOpenChange={setThemeOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 transition-all duration-200 hover:bg-foreground/[0.04]"
                  style={{
                    borderColor: 'var(--nayin-border)',
                    background: 'oklch(1 0 0 / 60%)',
                    boxShadow: '0 0 16px -6px var(--nayin-glow)',
                  }}
                >
                  <WuxingDrinkIcon element={element} size={20} />
                  <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    {theme.elementCn}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-64 p-0"
                style={{ background: 'var(--panel-bg)', border: '1px solid var(--nayin-border)' }}
              >
                <div className="p-3 border-b" style={{ borderColor: 'var(--nayin-border)' }}>
                  <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                    Nayin Five Elements / 纳音五行
                  </div>
                  <div className="text-xs text-foreground mt-1.5 leading-relaxed">
                    {today.cstDateStr}（东八区）
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    农历 {today.lunar.yearGanzhi}年 {today.lunar.monthCn}{today.lunar.dayCn}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    日柱 <span className="text-nayin-bright">{today.ganzhi}</span>
                    <span className="mx-1 opacity-40">·</span>
                    纳音 <span className="text-nayin-bright font-semibold">{today.nayinName}</span>
                    <span className="mx-1 opacity-40">·</span>
                    五行 <span className="text-nayin-bright">{today.theme.elementCn}</span>
                    {today.theme.element !== element && (
                      <span className="ml-1.5 text-[10px] opacity-60">(已切换预览)</span>
                    )}
                  </div>
                </div>
                <div className="p-2">
                  {allThemes.map((t) => (
                    <button
                      key={t.element}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors hover:bg-[var(--muted)]"
                      onClick={() => {
                        setPreviewElement(t.element === today.element ? null : t.element);
                        setThemeOpen(false);
                      }}
                    >
                      <WuxingDrinkIcon element={t.element} size={28} />
                      <div className="flex-1">
                        <div className="text-xs font-medium text-foreground">
                          {t.elementCn}
                          {t.element === today.element && (
                            <span className="ml-2 text-[10px] text-muted-foreground">(今日)</span>
                          )}
                        </div>
                      </div>
                      {t.element === element && (
                        <div className="w-1.5 h-1.5 rounded-full bg-nayin" />
                      )}
                    </button>
                  ))}
                </div>
                {previewElement && (
                  <div className="p-2 border-t" style={{ borderColor: 'var(--nayin-border)' }}>
                    <button
                      className="w-full text-xs text-center py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--muted)] transition-colors"
                      onClick={() => {
                        setPreviewElement(null);
                        setThemeOpen(false);
                      }}
                    >
                      恢复今日主题
                    </button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {/* User avatar — hand-drawn double-ring style */}
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105"
              style={{
                border: '1.4px solid var(--foreground)',
                background: 'var(--background)',
                boxShadow: '0 0 0 3px var(--background), 0 0 0 4px var(--nayin-border)',
              }}
              aria-label="用户"
            >
              <span
                className="text-sm font-medium"
                style={{ fontFamily: "'Noto Serif SC', serif", color: 'var(--foreground)' }}
              >
                Y
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
