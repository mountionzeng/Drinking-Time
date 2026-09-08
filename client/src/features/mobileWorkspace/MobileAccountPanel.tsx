/**
 * 「我」——手机端的账号页。
 *
 * 原来是个 max-w-sm 的小对话框，只放了邮箱和退出登录。八字要能在这里设置，
 * 那个尺寸装不下表单，所以改成整屏。
 *
 * 里面的东西按「先看清自己是谁、还剩多少，再谈设置」排：
 *   账号 → 算力余额 → 今天的来信 → 出生信息 → 退出登录
 *
 * 八字表单直接复用电脑端那个 EmotionAnalysisInvitePanel，不另写一份：
 * 字段、校验和保存语义只要有一处不一样，两端算出来的就是两个人的命盘。
 */
import { X } from "lucide-react";
import React from "react";

import { useAuth } from "@/_core/hooks/useAuth";
import {
  normalizeEmotionAnalysisProfile,
  type SaveEmotionAnalysisProfileInput,
} from "@/features/analysis/emotionAnalysis";
import EmotionAnalysisInvitePanel from "@/features/analysis/views/EmotionAnalysisInvitePanel";
import { ComputeBalanceBadge } from "@/features/computeAccount/ComputeBalanceBadge";
import { useDailyAlmanac } from "@/features/nayin/hooks/useDailyAlmanac";
import { useNayin } from "@/features/nayin/NayinContext";
import { trpc } from "@/lib/trpc";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-chat-brand text-lg font-normal text-foreground">
      {children}
    </h2>
  );
}

export function MobileAccountPanel({
  open,
  onOpenChange,
  onOpenLetter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenLetter: () => void;
}) {
  const { user, logout } = useAuth();
  const { today } = useNayin();
  const almanacQuery = useDailyAlmanac(today.cstDateStr);
  const utils = trpc.useUtils();

  const profileQuery = trpc.emotionAnalysis.getProfile.useQuery(undefined, {
    enabled: open && Boolean(user?.id),
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

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="我"
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain"
      style={{
        background: "var(--background)",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <header
          className="flex items-start justify-between gap-4 border-b pb-4"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          <div className="min-w-0">
            <h1 className="font-chat-brand text-2xl font-normal text-foreground">
              我
            </h1>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {user?.email ?? "未登录"}
            </p>
          </div>
          <button
            type="button"
            aria-label="返回"
            className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>

        <section
          aria-label="算力余额"
          className="border-b py-5"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          <SectionTitle>还剩多少</SectionTitle>
          <div className="mt-2">
            <ComputeBalanceBadge enabled={Boolean(user?.id)} />
          </div>
        </section>

        <section
          aria-label="今天的来信"
          className="border-b py-5"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
            onClick={() => {
              onOpenChange(false);
              onOpenLetter();
            }}
          >
            <SectionTitle>今天的来信</SectionTitle>
            <span className="text-xs text-muted-foreground">打开 ›</span>
          </button>
        </section>

        <section
          aria-label="出生信息"
          className="border-b py-5"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          <SectionTitle>出生信息</SectionTitle>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            {profile
              ? "来信会按这些资料写。改完之后，今天的信会重新算一遍。"
              : "只填一次。不填也能读信，只是那封信不会贴着你写。"}
          </p>
          <div className="mt-3">
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
              // 不要 compactEntry：那是访客引导用的折叠入口（先给一句
              // 「再聊聊」再展开），不是设置表单。设置页要的是登录页
              // GuidedLanding 第二处那种传法——只 embedded，直接给完整
              // 的出生日期和时辰选择。传了 compactEntry，生日和时辰就
              // 藏在折叠层里点不到。
              persistLocalProfile={false}
            />
          </div>
        </section>

        <div className="flex justify-between py-5">
          <button
            type="button"
            className="min-h-11 px-2 text-xs text-muted-foreground"
            onClick={() => onOpenChange(false)}
          >
            返回
          </button>
          <button
            type="button"
            className="min-h-11 px-2 text-xs text-muted-foreground"
            onClick={() => void logout()}
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
