/**
 * TopBar — Simplified top navigation
 * Shows: 五行饮品 Logo（兼故事菜单）、story panel toggles、user avatar
 *
 * 纳音五行主题切换原来挂在最左边那颗 Logo 上，现在 Logo 让给了故事菜单，
 * 主题切换挪进右上角的用户菜单。
 */
import { useNayin } from "@/features/nayin/NayinContext";
import WuxingDrinkIcon from "@/features/nayin/views/WuxingDrinkIcon";
import StoryLogoMenu, {
  type StoryLogoMenuStory,
} from "@/app/shell/StoryLogoMenu";
import { STORY_PANELS } from "@/features/analysis/storyPanels";
import { useStoryPanelVisibility } from "@/features/storyAgent/spine/selectors";
import { useState, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAuth } from "@/_core/hooks/useAuth";
import { BarChart3 } from "lucide-react";

interface TopBarPanelToggle {
  label: string;
  active: boolean;
  onToggle: () => void;
  controls?: string;
  testId?: string;
}

/** 顶栏 Logo 上那层故事菜单要的数据与动作；不传就只显示一个不可点的 Logo。 */
interface TopBarStoryMenu {
  stories?: StoryLogoMenuStory[];
  onNewStory?: () => void;
  onOpenStory?: (storyId: number) => void;
  onBrowseAll?: () => void;
}

interface TopBarProps {
  onStoryPanelToggle?: () => void;
  showStoryPanelNav?: boolean;
  panelToggle?: TopBarPanelToggle;
  panelToggles?: TopBarPanelToggle[];
  panelActions?: ReactNode;
  storyMenu?: TopBarStoryMenu;
  /**
   * 顶栏第二行（今日来信）。放进来是为了让左边那颗 Logo 竖着贯穿两行，
   * 右边这一列自己上下堆：上面是工作区按钮，下面是这条。
   */
  secondaryRow?: ReactNode;
}

export default function TopBar({
  onStoryPanelToggle,
  showStoryPanelNav = true,
  panelToggle,
  panelToggles,
  panelActions,
  storyMenu,
  secondaryRow,
}: TopBarProps) {
  const { allThemes, setPreviewElement, previewElement, element, today } =
    useNayin();
  const { user, logout } = useAuth();
  const { visibleStoryPanels, toggleVisibleStoryPanel } =
    useStoryPanelVisibility();
  const [userOpen, setUserOpen] = useState(false);
  const editingPanelToggles =
    panelToggles && panelToggles.length > 0
      ? panelToggles
      : panelToggle
        ? [panelToggle]
        : [];

  return (
    <div className="sticky top-0 z-50 backdrop-blur-md">
      {/* Nayin color strip */}
      <div className="nayin-strip" />

      <div
        className="border-b px-4 md:px-6"
        style={{
          background:
            "linear-gradient(180deg, oklch(1 0 0 / 92%), oklch(from var(--nayin-surface) l c h / 80%))",
          borderColor: "var(--nayin-border)",
          backdropFilter: "blur(20px) saturate(140%)",
        }}
      >
        <div className="flex items-stretch gap-3">
          {/* 左：Logo，竖着居中，贯穿右边那两行 */}
          <div className="flex shrink-0 items-center">
            <StoryLogoMenu
              element={element}
              stories={storyMenu?.stories}
              onNewStory={storyMenu?.onNewStory}
              onOpenStory={storyMenu?.onOpenStory}
              onBrowseAll={storyMenu?.onBrowseAll}
            />
          </div>

          {/* 右：上下两行 */}
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <div className="flex items-center justify-between gap-4 py-2">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {showStoryPanelNav ? (
                  <nav
                    aria-label="故事面板切换"
                    className="grid min-w-0 flex-1 grid-cols-2 gap-1 sm:flex sm:flex-wrap sm:items-center"
                  >
                    {STORY_PANELS.map(panel => {
                      const active = visibleStoryPanels.includes(panel.id);
                      return (
                        <button
                          key={panel.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            onStoryPanelToggle?.();
                            toggleVisibleStoryPanel(panel.id);
                          }}
                          className={`min-h-[32px] rounded-sm px-2.5 text-[11px] font-mono transition-colors sm:min-w-[92px] ${
                            active
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground/80"
                          }`}
                          style={
                            active
                              ? {
                                  background: "var(--nayin-surface)",
                                  boxShadow:
                                    "inset 0 -2px 0 var(--nayin-accent)",
                                }
                              : undefined
                          }
                        >
                          {panel.label}
                        </button>
                      );
                    })}
                  </nav>
                ) : editingPanelToggles.length > 0 ? (
                  <nav
                    aria-label="剪辑面板切换"
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
                  >
                    {editingPanelToggles.map((toggle, index) => (
                      <button
                        key={toggle.testId ?? toggle.label}
                        type="button"
                        data-testid={
                          toggle.testId ??
                          (editingPanelToggles.length === 1
                            ? "topbar-panel-toggle"
                            : `topbar-panel-toggle-${index}`)
                        }
                        aria-pressed={toggle.active}
                        aria-controls={toggle.controls}
                        aria-label={`${toggle.active ? "隐藏" : "显示"}${toggle.label}`}
                        title={`${toggle.active ? "隐藏" : "显示"}${toggle.label}`}
                        onClick={toggle.onToggle}
                        className={`min-h-[32px] rounded-sm px-2.5 font-sans text-[12px] font-bold uppercase tracking-[0.08em] transition-colors sm:min-w-[92px] ${
                          toggle.active ? "" : "hover:brightness-110"
                        }`}
                        style={
                          toggle.active
                            ? {
                                color: "var(--nayin-accent)",
                                background: "var(--nayin-surface)",
                                boxShadow: "inset 0 -2px 0 var(--nayin-accent)",
                              }
                            : {
                                color: "var(--nayin-accent-dim)",
                              }
                        }
                      >
                        {toggle.label}
                      </button>
                    ))}
                    {panelActions ? (
                      <div className="ml-1 flex shrink-0 items-center">
                        {panelActions}
                      </div>
                    ) : null}
                  </nav>
                ) : (
                  <div className="min-w-0 flex-1" aria-hidden="true" />
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* User avatar + logout popover */}
                <Popover open={userOpen} onOpenChange={setUserOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105"
                      style={{
                        border: "1.4px solid var(--foreground)",
                        background: "var(--background)",
                        boxShadow:
                          "0 0 0 3px var(--background), 0 0 0 4px var(--nayin-border)",
                      }}
                      aria-label="用户"
                    >
                      <span
                        className="text-sm font-medium"
                        style={{
                          fontFamily: "'Noto Serif SC', serif",
                          color: "var(--foreground)",
                        }}
                      >
                        {user?.name ? user.name[0].toUpperCase() : "G"}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-52 p-0"
                    align="end"
                    style={{
                      background: "var(--panel-bg)",
                      border: "1px solid var(--nayin-border)",
                    }}
                  >
                    <div
                      className="p-3 border-b"
                      style={{ borderColor: "var(--nayin-border)" }}
                    >
                      <div className="text-xs font-medium text-foreground truncate">
                        {user?.name || "访客"}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                        {user?.email || ""}
                      </div>
                    </div>
                    {/* 纳音五行主题切换：原来挂在最左边那颗 Logo 上，
                    Logo 让给故事菜单后挪到这里。 */}
                    <div
                      className="border-b p-3"
                      style={{ borderColor: "var(--nayin-border)" }}
                    >
                      <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                        Nayin Five Elements / 纳音五行
                      </div>
                      <div className="mt-1.5 text-xs leading-relaxed text-foreground">
                        {today.cstDateStr}（东八区）
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        农历 {today.lunar.yearGanzhi}年 {today.lunar.monthCn}
                        {today.lunar.dayCn}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        日柱{" "}
                        <span className="text-nayin-bright">
                          {today.ganzhi}
                        </span>
                        <span className="mx-1 opacity-40">·</span>
                        纳音{" "}
                        <span className="text-nayin-bright font-semibold">
                          {today.nayinName}
                        </span>
                        <span className="mx-1 opacity-40">·</span>
                        五行{" "}
                        <span className="text-nayin-bright">
                          {today.theme.elementCn}
                        </span>
                        {today.theme.element !== element && (
                          <span className="ml-1.5 text-[10px] opacity-60">
                            (已切换预览)
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {allThemes.map(t => (
                          <button
                            key={t.element}
                            type="button"
                            role="menuitemradio"
                            aria-checked={t.element === element}
                            title={`${t.elementCn}${t.element === today.element ? "（今日）" : ""}`}
                            className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-[var(--muted)]"
                            style={
                              t.element === element
                                ? { background: "var(--nayin-surface)" }
                                : undefined
                            }
                            onClick={() => {
                              setPreviewElement(
                                t.element === today.element ? null : t.element
                              );
                            }}
                          >
                            <WuxingDrinkIcon element={t.element} size={24} />
                          </button>
                        ))}
                      </div>
                      {previewElement && (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-md py-1.5 text-center text-xs text-muted-foreground transition-colors hover:bg-[var(--muted)] hover:text-foreground"
                          onClick={() => setPreviewElement(null)}
                        >
                          恢复今日主题
                        </button>
                      )}
                    </div>
                    <div className="p-1.5">
                      {user?.role === "admin" ? (
                        <button
                          className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-[var(--muted)] hover:text-foreground"
                          onClick={() => {
                            setUserOpen(false);
                            window.location.href = "/admin/users";
                          }}
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                          用户管理
                        </button>
                      ) : null}
                      <button
                        className="w-full text-left text-xs px-2.5 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-[var(--muted)] transition-colors"
                        onClick={async () => {
                          setUserOpen(false);
                          await logout();
                          window.location.href = "/login";
                        }}
                      >
                        退出登录
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {secondaryRow}
          </div>
        </div>
      </div>
    </div>
  );
}
