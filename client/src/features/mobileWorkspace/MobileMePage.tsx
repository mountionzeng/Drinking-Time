import {
  UI_LANGUAGES,
  useUiLanguage,
  useUiText,
} from "@/features/uiLanguage/UiLanguage";
import { MobileNavBar } from "./MobileNavBar";
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
import PersonalMemoryPage from "@/pages/PersonalMemoryPage";
import { trpc } from "@/lib/trpc";
import { LiaoliaoMascot } from "./LiaoliaoMascot";
import { LIAOLIAO_FORMS } from "./liaoliaoForms";
import { MobileDesktopLogin } from "./MobileDesktopLogin";
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

export function MobileMePage({
  onOpenLetter,
  onBack,
  pairingControl,
}: {
  onOpenLetter: () => void;
  onBack?: () => void;
  pairingControl?: React.ReactNode;
}) {
  const t = useUiText();

  const { user, logout } = useAuth();
  const { language, setLanguage } = useUiLanguage();
  const [languageOpen, setLanguageOpen] = useState(false);
  const {
    today,
    element,
    previewElement,
    setPreviewElement,
    visualTheme,
    setVisualTheme,
  } = useNayin();
  const almanacQuery = useDailyAlmanac(today.cstDateStr);
  const utils = trpc.useUtils();

  const [desktopLoginOpen, setDesktopLoginOpen] = useState(false);
  const [birthOpen, setBirthOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);

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

  return (
    <section
      aria-label={t("我")}
      className="h-full overflow-y-auto px-5 pb-6 pt-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-chat-brand text-[28px] leading-none text-foreground">
          {t("我")}
        </h1>
        {onBack && <MobileNavBar current="me" onNavigate={onBack} />}
      </div>

      <div className="mt-4 flex items-center gap-3 border-b border-border/70 pb-5">
        <LiaoliaoMascot element={element} visualTheme={visualTheme} />
        {/*
          访客账号的 email 是 null，但它**是**一个已登录的身份（openId 形如
          guest:…），故事和余额都挂在它名下。原来这里直接写「未登录」，
          等于告诉用户「你没登录」——然后他看见自己的故事都在，只会更糊涂。
        */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg text-foreground">
            {user?.name || t("访客")}
          </p>
          <p className="mt-1 break-all text-sm text-muted-foreground">
            {user?.email ?? (user ? t("访客身份 · 未绑定邮箱") : t("未登录"))}
          </p>
        </div>
      </div>

      <section
        aria-label={t("算力余额")}
        className="border-b border-border/70 py-5"
      >
        <h2 className="font-chat-brand text-lg text-foreground">
          {t("算力余额")}
        </h2>
        <div className="mt-2">
          <ComputeBalanceBadge enabled={Boolean(user?.id)} />
        </div>
      </section>

      <Row
        title={t("我的语言")}
        hint={UI_LANGUAGES.find(item => item.id === language)?.label}
        onClick={() => setLanguageOpen(true)}
      />
      <MobileSheet
        open={languageOpen}
        onOpenChange={setLanguageOpen}
        title={t("我的语言")}
      >
        <div role="group" aria-label={t("界面语言")} className="space-y-2">
          {UI_LANGUAGES.map(item => (
            <button
              key={item.id}
              type="button"
              lang={item.id}
              aria-pressed={language === item.id}
              onClick={() => setLanguage(item.id)}
              className={`flex min-h-14 w-full items-center justify-between rounded-xl border px-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${language === item.id ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <span>{item.label}</span>
              <span aria-hidden="true">{language === item.id ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      </MobileSheet>
      <Row
        title={t("我的日历")}
        hint={t("今天的来信与过往记录")}
        onClick={() => setCalendarOpen(true)}
      />

      <Row
        title={t("我的风格")}
        hint={
          visualTheme === "shiguang"
            ? "拾光家忆"
            : `纳音五行 · ${previewElement ? t(LIAOLIAO_FORMS.find(form => form.element === element)?.label.split(" · ")[0] ?? "") : t("跟随当天五行")}`
        }
        onClick={() => setStyleOpen(true)}
      />
      <MobileSheet
        open={styleOpen}
        onOpenChange={setStyleOpen}
        title={t("我的风格")}
      >
        <div className="grid auto-rows-fr gap-3">
          <button
            type="button"
            aria-pressed={visualTheme === "shiguang"}
            onClick={() => setVisualTheme("shiguang")}
            className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${visualTheme === "shiguang" ? "border-primary bg-muted" : "border-border"}`}
          >
            <img
              src="/shiguang/xiaoyi-theme-avatar.png"
              alt=""
              className="size-12 object-contain"
            />
            <span className="flex-1">拾光家忆</span>
            {visualTheme === "shiguang" && (
              <span className="text-xs text-primary">{t("已选")}</span>
            )}
          </button>
          <div
            className={`rounded-2xl border transition-colors ${visualTheme === "nayin" ? "border-primary bg-muted/40" : "border-border"}`}
          >
            <button
              type="button"
              aria-pressed={visualTheme === "nayin"}
              onClick={() => setVisualTheme("nayin")}
              className="flex min-h-12 w-full items-center justify-between rounded-t-2xl px-4 text-left focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span>纳音五行</span>
              {visualTheme === "nayin" && (
                <span className="text-xs text-primary">{t("已选")}</span>
              )}
            </button>
            <div
              role="group"
              aria-label={t("五行杯子风格")}
              className="grid grid-cols-5 gap-1 px-2 pb-2"
            >
              {LIAOLIAO_FORMS.map(form => {
                const selected =
                  visualTheme === "nayin" && element === form.element;
                return (
                  <button
                    type="button"
                    key={form.element}
                    aria-label={t(form.label)}
                    aria-pressed={selected}
                    onClick={() => {
                      setPreviewElement(form.element);
                      setVisualTheme("nayin");
                    }}
                    className={`flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-primary ${selected ? "bg-primary/10 ring-1 ring-inset ring-primary/50" : "hover:bg-muted"}`}
                  >
                    <LiaoliaoMascot
                      element={form.element}
                      visualTheme="nayin"
                      size={44}
                    />
                    <span className="text-xs">
                      {t(form.label.split(" · ")[0])}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-pressed={visualTheme === "nayin" && !previewElement}
              onClick={() => {
                setPreviewElement(null);
                setVisualTheme("nayin");
              }}
              className="min-h-11 w-full rounded-b-2xl px-4 text-right text-xs text-muted-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
            >
              {visualTheme === "nayin" && !previewElement ? "✓ " : ""}
              {t("跟随当天五行")}
            </button>
          </div>
        </div>
      </MobileSheet>

      {pairingControl ? <div className="border-b border-border/70 py-3">{pairingControl}</div> : <Row
        title={t("电脑登录")}
        hint={t("用手机授权电脑登录同一账号")}
        onClick={() => setDesktopLoginOpen(true)}
      />}

      <Row
        title={t("出生信息")}
        hint={
          profile
            ? t("来信会按这些资料写。改完之后，今天的信会重新算一遍。")
            : t("只填一次。不填也能读信，只是那封信不会贴着你写。")
        }
        onClick={() => setBirthOpen(true)}
      />

      <div className="flex justify-end pt-6">
        <button
          type="button"
          className="min-h-11 px-2 text-sm text-muted-foreground"
          onClick={() => void logout()}
        >
          {t("退出登录")}
        </button>
      </div>

      <MobileSheet
        open={calendarOpen}
        onOpenChange={setCalendarOpen}
        title={t("我的日历")}
      >
        {calendarOpen ? (
          <>
            <Row
              title={t("今天的来信")}
              hint={t("今天写给你的那封")}
              onClick={() => {
                setCalendarOpen(false);
                onOpenLetter();
              }}
            />
            <PersonalMemoryPage embedded />
          </>
        ) : null}
      </MobileSheet>
      <MobileDesktopLogin
        email={user?.email}
        open={desktopLoginOpen}
        onOpenChange={setDesktopLoginOpen}
      />
      <MobileSheet
        open={birthOpen}
        title={t("出生信息")}
        description={
          profile
            ? t("改完之后，今天的信会重新算一遍。")
            : t("只填一次。不填也能读信，只是那封信不会贴着你写。")
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
