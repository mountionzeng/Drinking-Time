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
import { trpc } from "@/lib/trpc";
import { liaoliaoForm, liaoliaoSpriteStyle } from "./liaoliaoForms";
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
  const { today, element, previewElement } = useNayin();
  const almanacQuery = useDailyAlmanac(today.cstDateStr);
  const utils = trpc.useUtils();

  const [formPickerOpen, setFormPickerOpen] = useState(false);
  const [desktopLoginOpen, setDesktopLoginOpen] = useState(false);
  const [birthOpen, setBirthOpen] = useState(false);

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
        <span
          aria-hidden="true"
          className="size-14 shrink-0 rounded-full border border-border/70"
          style={liaoliaoSpriteStyle(element)}
        />
        {/*
          访客账号的 email 是 null，但它**是**一个已登录的身份（openId 形如
          guest:…），故事和余额都挂在它名下。原来这里直接写「未登录」，
          等于告诉用户「你没登录」——然后他看见自己的故事都在，只会更糊涂。
        */}
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {user?.email ?? (user ? "访客身份 · 未绑定邮箱" : "未登录")}
        </p>
      </div>

      <section aria-label="算力余额" className="border-b border-border/70 py-5">
        <h2 className="font-chat-brand text-lg text-foreground">还剩多少</h2>
        <div className="mt-2">
          <ComputeBalanceBadge enabled={Boolean(user?.id)} />
        </div>
      </section>

      <Row
        title="今天的来信"
        hint="今天写给你的那封"
        onClick={onOpenLetter}
      />

      <Row
        title="聊聊的外形"
        hint={`${currentForm.label}${previewElement ? "" : " · 跟随当天五行"}`}
        leading={
          <span
            aria-hidden="true"
            className="size-11 shrink-0"
            style={liaoliaoSpriteStyle(element)}
          />
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
