/**
 * 「我」页。
 *
 * 保留原 MobileAccountPanel 的全部能力（账号、算力余额、今天的来信、出生信息、
 * 退出登录），从整屏浮层升成一整页，并按设计稿新增两个入口：聊聊的外形、电脑登录。
 *
 * 出生信息仍然直接用电脑端那个 `EmotionAnalysisInvitePanel`（内含 `BirthMomentDial`），
 * 只是收进次一级弹层减少首屏拥挤——字段、校验和保存语义有一处不一样，
 * 两端算出来的就是两个人的命盘，所以绝不另写一份手机表单。
 */
import React, { useState } from "react";

import { useAuth } from "@/_core/hooks/useAuth";
import {
  normalizeEmotionAnalysisProfile,
  type SaveEmotionAnalysisProfileInput,
} from "@/features/analysis/emotionAnalysis";
import EmotionAnalysisInvitePanel from "@/features/analysis/views/EmotionAnalysisInvitePanel";
import { ComputeBalanceBadge } from "@/features/computeAccount/ComputeBalanceBadge";
import { useDailyAlmanac } from "@/features/nayin/hooks/useDailyAlmanac";
import { useNayin } from "@/features/nayin/NayinContext";
import PersonalMemorySummary from "@/features/personalMemory/PersonalMemorySummary";
import PersonalMemoryPage from "@/pages/PersonalMemoryPage";
import { trpc } from "@/lib/trpc";
import { LiaoliaoMascot } from "./LiaoliaoMascot";
import { liaoliaoForm } from "./liaoliaoForms";
import { MobileDesktopLogin } from "./MobileDesktopLogin";
import { MobileFormPicker } from "./MobileFormPicker";
import { MobileSheet } from "./MobileSheet";

function Row({
  title,
  hint,
  leading,
  onClick,
}: {
  title: string;
  hint?: string;
  leading?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex min-h-16 w-full items-center gap-3 border-b border-border/70 py-3 text-left"
      onClick={onClick}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] text-foreground">{title}</span>
        {hint ? (
          <span className="mt-1 block text-xs leading-6 text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        ›
      </span>
    </button>
  );
}

export function MobileMePage({ onOpenLetter }: { onOpenLetter: () => void }) {
  const { user, logout } = useAuth();
  const { today, element, previewElement, visualTheme, setVisualTheme } =
    useNayin();
  const almanacQuery = useDailyAlmanac(today.cstDateStr);
  const utils = trpc.useUtils();

  const [formPickerOpen, setFormPickerOpen] = useState(false);
  const [desktopLoginOpen, setDesktopLoginOpen] = useState(false);
  const [birthOpen, setBirthOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const profileQuery = trpc.emotionAnalysis.getProfile.useQuery(undefined, {
    enabled: Boolean(user?.id),
    retry: false,
  });
  const saveProfileMut = trpc.emotionAnalysis.saveBirthProfile.useMutation();
  const profile = normalizeEmotionAnalysisProfile(profileQuery.data, "server");

  // 存完把 profile 和信一起失效：今天的信要由服务器按新资料重算，
  // 而不是继续用旧的那封。
  const saveProfile = async (input: SaveEmotionAnalysisProfileInput) => {
    const saved = await saveProfileMut.mutateAsync(input);
    await Promise.all([
      utils.emotionAnalysis.getProfile.invalidate(),
      utils.emotionAnalysis.listDailyLetters.invalidate(),
    ]);
    return normalizeEmotionAnalysisProfile(saved, "server") ?? undefined;
  };

  const currentForm = liaoliaoForm(element);

  return (
    <section aria-label="我" className="h-full overflow-y-auto px-5 pb-6 pt-4">
      <h1 className="font-chat-brand text-[28px] leading-none text-foreground">
        我
      </h1>

      <div className="mt-4 flex items-center gap-3 border-b border-border/70 pb-5">
        <LiaoliaoMascot element={element} visualTheme={visualTheme} />
        {/*
          访客账号的 email 是 null，但它**是**一个已登录的身份（openId 形如
          guest:…），故事和余额都挂在它名下。原来这里直接写「未登录」，
          等于告诉用户「你没登录」——然后他看见自己的故事都在，只会更糊涂。
        */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg text-foreground">
            {user?.name || "访客"}
          </p>
          <p className="mt-1 break-all text-sm text-muted-foreground">
            {user?.email ?? (user ? "访客身份 · 未绑定邮箱" : "未登录")}
          </p>
        </div>
      </div>

      <section aria-label="算力余额" className="border-b border-border/70 py-5">
        <h2 className="font-chat-brand text-lg text-foreground">算力余额</h2>
        <div className="mt-2">
          <ComputeBalanceBadge enabled={Boolean(user?.id)} />
        </div>
      </section>

      <PersonalMemorySummary
        compact={false}
        onOpenAll={() => setCalendarOpen(true)}
      />

      <fieldset className="border-b border-border/70 py-5">
        <legend className="float-left mb-3 w-full font-chat-brand text-lg text-foreground">
          界面风格
        </legend>
        <div className="grid clear-both grid-cols-2 gap-3">
          {(
            [
              { mode: "shiguang", title: "拾光家忆", hint: "手绘记忆 · 小忆" },
              { mode: "nayin", title: "纳音五行", hint: "每日五行 · 饮品" },
            ] as const
          ).map(({ mode, title, hint }) => (
            <label key={mode} className="relative cursor-pointer">
              <input
                type="radio"
                name="mobile-visual-theme"
                value={mode}
                aria-label={title}
                checked={visualTheme === mode}
                onChange={() => setVisualTheme(mode)}
                className="peer sr-only"
              />
              <span className="flex h-full flex-col items-center gap-2 rounded-2xl border border-border px-2 py-4 text-center transition-colors peer-checked:border-[var(--nayin-accent)] peer-checked:bg-muted peer-checked:ring-1 peer-checked:ring-[var(--nayin-accent)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--nayin-accent)] motion-reduce:transition-none">
                <LiaoliaoMascot
                  element={element}
                  visualTheme={mode}
                  size={52}
                />
                <span>
                  <strong className="block text-base font-medium">
                    {title}
                  </strong>
                  <small className="mt-1 block text-xs text-muted-foreground">
                    {hint}
                  </small>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Row title="今天的来信" hint="今天写给你的那封" onClick={onOpenLetter} />

      <Row
        title="聊聊的外形"
        hint={`${currentForm.label}${previewElement ? "" : " · 跟随当天五行"}`}
        leading={
          <LiaoliaoMascot element={element} visualTheme="nayin" size={44} />
        }
        onClick={() => setFormPickerOpen(true)}
      />

      <Row
        title="电脑登录"
        hint="用手机授权电脑登录同一账号"
        onClick={() => setDesktopLoginOpen(true)}
      />

      <Row
        title="出生信息"
        hint={
          profile
            ? "来信会按这些资料写。改完之后，今天的信会重新算一遍。"
            : "只填一次。不填也能读信，只是那封信不会贴着你写。"
        }
        onClick={() => setBirthOpen(true)}
      />

      <div className="flex justify-end pt-6">
        <button
          type="button"
          className="min-h-11 px-2 text-sm text-muted-foreground"
          onClick={() => void logout()}
        >
          退出登录
        </button>
      </div>

      <MobileFormPicker
        open={formPickerOpen}
        onOpenChange={setFormPickerOpen}
      />
      <MobileSheet
        open={calendarOpen}
        onOpenChange={setCalendarOpen}
        title="我的日历"
      >
        {calendarOpen ? <PersonalMemoryPage embedded /> : null}
      </MobileSheet>
      <MobileDesktopLogin
        email={user?.email}
        open={desktopLoginOpen}
        onOpenChange={setDesktopLoginOpen}
      />
      <MobileSheet
        open={birthOpen}
        title="出生信息"
        description={
          profile
            ? "改完之后，今天的信会重新算一遍。"
            : "只填一次。不填也能读信，只是那封信不会贴着你写。"
        }
        onOpenChange={setBirthOpen}
      >
        <EmotionAnalysisInvitePanel
          today={today}
          almanac={almanacQuery.data}
          profile={profile}
          profileLoading={
            profileQuery.isFetching ||
            almanacQuery.isLoading ||
            saveProfileMut.isPending
          }
          onSaveProfile={saveProfile}
          embedded
          // 不要 compactEntry：那是访客引导用的折叠入口，传了生日和时辰
          // 就藏在折叠层里点不到。这里要的是完整表单。
          persistLocalProfile={false}
        />
      </MobileSheet>
    </section>
  );
}
