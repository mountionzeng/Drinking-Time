/**
 * TopBar — Simplified top navigation
 * Shows: 五行饮品 Logo（兼故事菜单）、story panel toggles、user avatar
 *
 * 纳音五行主题切换原来挂在最左边那颗 Logo 上，现在 Logo 让给了故事菜单，
 * 主题切换挪进右上角的用户菜单。
 */
import { useNayin } from "@/features/nayin/NayinContext";
import { LegacyStoryRecoveryEntry } from "@/features/storyAgent/views/LegacyStoryRecovery";
import PairingCodeButton from "@/features/auth/views/PairingCodeButton";
import { MobileMePage } from "@/features/mobileWorkspace/MobileMePage";

import { ComputeBalanceBadge } from "@/features/computeAccount/ComputeBalanceBadge";
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
import { BarChart3, Compass } from "lucide-react";

interface TopBarPanelToggle {
  label: string;
  active: boolean;
  onToggle: () => void;
  illustrationSrc?: string;
  controls?: string;
  testId?: string;
  subnav?: ReactNode;
  /** 首次使用引导用来定位这颗按钮。 */
  tourAnchor?: string;
}

/** 顶栏 Logo 上那层故事菜单要的数据与动作；不传就只显示一个不可点的 Logo。 */
interface TopBarStoryMenu {
  stories?: StoryLogoMenuStory[];
  onNewStory?: () => void;
  onOpenStory?: (storyId: number) => void;
  onBrowseAll?: () => void;
}

interface TopBarProps {
  hideStoryLogo?: boolean;
  onStoryPanelToggle?: () => void;
  showStoryPanelNav?: boolean;
  panelToggle?: TopBarPanelToggle;
  panelToggles?: TopBarPanelToggle[];
  panelActions?: ReactNode;
  accountActions?: ReactNode;
  storyMenu?: TopBarStoryMenu;
  /**
   * 顶栏第二行（今日来信）。放进来是为了让左边那颗 Logo 竖着贯穿两行，
   * 右边这一列自己上下堆：上面是工作区按钮，下面是这条。
   */
  secondaryRow?: ReactNode;
  /** 传了就在用户菜单里显示「重看使用引导」。 */
  onReplayTour?: () => void;
  showLocalDraftRecovery?: boolean;
  onOpenLetter?: () => void;
}

export default function TopBar({
  hideStoryLogo = false,
  onStoryPanelToggle,
  showStoryPanelNav = true,
  panelToggle,
  panelToggles,
  panelActions,
  accountActions,
  storyMenu,
  secondaryRow,
  onReplayTour,
  showLocalDraftRecovery = false,
  onOpenLetter,
}: TopBarProps) {
  const { element, visualTheme } = useNayin();
  const { user } = useAuth();
  const { visibleStoryPanels, toggleVisibleStoryPanel } =
    useStoryPanelVisibility();
  const [userOpen, setUserOpen] = useState(false);
  const editingPanelToggles =
    panelToggles && panelToggles.length > 0
      ? panelToggles
      : panelToggle
        ? [panelToggle]
        : [];
  const shiguangAvatarText = Array.from(user?.name?.trim() || "我")[0] ?? "我";

  return (
    <div className="app-topbar sticky top-0 z-50 backdrop-blur-md">
      {/* Nayin color strip */}
      <div className="nayin-strip" />

      <div
        className="app-topbar-surface border-b px-4 md:px-6"
        style={{
          background:
            visualTheme === "shiguang"
              ? "linear-gradient(180deg, color-mix(in oklab, var(--panel-bg) 92%, transparent), color-mix(in oklab, var(--nayin-surface) 84%, transparent))"
              : "linear-gradient(180deg, oklch(1 0 0 / 92%), oklch(from var(--nayin-surface) l c h / 80%))",
          borderColor: "var(--nayin-border)",
          backdropFilter: "blur(20px) saturate(140%)",
        }}
      >
        <div className="flex items-stretch gap-3">
          {/* 左：Logo，竖着居中，贯穿右边那两行 */}
          {!hideStoryLogo && <div className="flex shrink-0 items-center" data-tour="story-menu">
            <StoryLogoMenu
              element={element}
              visualTheme={visualTheme}
              stories={storyMenu?.stories}
              onNewStory={storyMenu?.onNewStory}
              onOpenStory={storyMenu?.onOpenStory}
              onBrowseAll={storyMenu?.onBrowseAll}
            />
          </div>}

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
                          className={`shiguang-toolbar-button min-h-[32px] rounded-sm px-2.5 text-[11px] font-mono transition-colors sm:min-w-[92px] ${
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
                          <span className="shiguang-nav-label">
                            {panel.label}
                          </span>
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
                      <div
                        key={toggle.testId ?? toggle.label}
                        className="topbar-panel-toggle-group flex shrink-0 flex-col items-center"
                      >
                        <button
                          type="button"
                          data-testid={
                            toggle.testId ??
                            (editingPanelToggles.length === 1
                              ? "topbar-panel-toggle"
                              : `topbar-panel-toggle-${index}`)
                          }
                          data-tour={toggle.tourAnchor}
                          aria-pressed={toggle.active}
                          aria-controls={toggle.controls}
                          aria-label={`${toggle.active ? "隐藏" : "显示"}${toggle.label}`}
                          title={`${toggle.active ? "隐藏" : "显示"}${toggle.label}`}
                          onClick={toggle.onToggle}
                          className={`shiguang-toolbar-button min-h-[32px] rounded-sm px-2.5 font-sans text-[12px] font-bold uppercase tracking-[0.08em] transition-colors sm:min-w-[92px] ${
                            toggle.active ? "" : "hover:brightness-110"
                          }`}
                          style={
                            visualTheme === "nayin" && toggle.active
                              ? {
                                  color: "var(--nayin-accent)",
                                  background: "var(--nayin-surface)",
                                  boxShadow:
                                    "inset 0 -2px 0 var(--nayin-accent)",
                                }
                              : visualTheme === "nayin"
                                ? {
                                    color: "var(--nayin-accent-dim)",
                                  }
                                : undefined
                          }
                        >
                          {visualTheme === "shiguang" &&
                          toggle.illustrationSrc ? (
                            <img
                              src={toggle.illustrationSrc}
                              alt=""
                              aria-hidden="true"
                              className="shiguang-nav-illustration"
                            />
                          ) : null}
                          <span className="shiguang-nav-label">
                            {toggle.label}
                          </span>
                        </button>
                        {toggle.subnav ? (
                          <div className="topbar-panel-subnav w-full">
                            {toggle.subnav}
                          </div>
                        ) : null}
                      </div>
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
                {/* 算力余额：钱要一直看得见，不能藏在二级菜单里 */}
                {accountActions}
                <span data-tour="compute-balance">
                  <ComputeBalanceBadge compact enabled={Boolean(user?.id)} />
                </span>
                {/* User avatar + logout popover */}
                <Popover open={userOpen} onOpenChange={setUserOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className={
                        visualTheme === "shiguang"
                          ? "shiguang-user-avatar flex h-10 w-10 items-center justify-center rounded-full transition-all hover:-translate-y-0.5"
                          : "flex h-9 w-9 items-center justify-center rounded-full transition-all hover:scale-105"
                      }
                      style={{
                        border: "1.4px solid var(--foreground)",
                        background: "var(--background)",
                        boxShadow:
                          "0 0 0 3px var(--background), 0 0 0 4px var(--nayin-border)",
                      }}
                      aria-label="用户"
                      data-tour="account"
                    >
                      {visualTheme === "shiguang" ? (
                        <span
                          className="shiguang-member-avatar"
                          aria-hidden="true"
                        >
                          <img
                            src="/shiguang/book-wash.png"
                            alt=""
                            className="shiguang-member-avatar-backdrop"
                          />
                          <span className="shiguang-member-avatar-letter">
                            {shiguangAvatarText}
                          </span>
                        </span>
                      ) : (
                        <span
                          className="text-sm font-medium"
                          style={{
                            fontFamily: "'Noto Serif SC', serif",
                            color: "var(--foreground)",
                          }}
                        >
                          {user?.name ? user.name[0].toUpperCase() : "G"}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[min(420px,calc(100vw-32px))] max-h-[85dvh] overflow-y-auto p-0"
                    align="end"
                    style={{
                      background: "var(--panel-bg)",
                      border: "1px solid var(--nayin-border)",
                    }}
                  >
                    <MobileMePage
                      pairingControl={<PairingCodeButton />}
                      onOpenLetter={() => {
                        setUserOpen(false);
                        if (onOpenLetter) onOpenLetter();
                        else window.location.assign("/personal-memory");
                      }}
                    />
                    <div className="border-t border-border/70 p-1.5">
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
                      {showLocalDraftRecovery && <LegacyStoryRecoveryEntry onOpen={() => setUserOpen(false)} />}
                      {onReplayTour ? (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-[var(--muted)] hover:text-foreground"
                          data-testid="topbar-replay-tour"
                          onClick={() => {
                            setUserOpen(false);
                            onReplayTour();
                          }}
                        >
                          <Compass className="h-3.5 w-3.5" />
                          重看使用引导
                        </button>
                      ) : null}
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
