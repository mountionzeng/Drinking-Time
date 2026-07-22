import { useEffect, useMemo, useState } from "react";
import {
  CalendarHeart,
  CheckCircle2,
  Clock3,
  HeartPulse,
  Loader2,
  MapPin,
  MessageCircle,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import type { AlmanacDay } from "@/features/nayin/almanac";
import type { TodayNayin } from "@/features/nayin/nayin";
import {
  buildEmotionAnalysisProfile,
  EMOTION_ANALYSIS_CONSENT_TEXT,
  isValidBirthDate,
  loadLocalEmotionAnalysisProfile,
  saveLocalEmotionAnalysisProfile,
  type EmotionAnalysisProfile,
  type SaveEmotionAnalysisProfileInput,
} from "@/features/analysis/emotionAnalysis";
import { toast } from "sonner";

interface EmotionAnalysisInvitePanelProps {
  today: TodayNayin;
  almanac: AlmanacDay | null | undefined;
  profile?: EmotionAnalysisProfile | null;
  profileLoading?: boolean;
  embedded?: boolean;
  compactEntry?: boolean;
  onSaveProfile?: (
    input: SaveEmotionAnalysisProfileInput
  ) => Promise<EmotionAnalysisProfile | void>;
}

function formatSavedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

export default function EmotionAnalysisInvitePanel({
  today,
  almanac,
  profile,
  profileLoading = false,
  embedded = false,
  compactEntry = false,
  onSaveProfile,
}: EmotionAnalysisInvitePanelProps) {
  const [localProfile, setLocalProfile] =
    useState<EmotionAnalysisProfile | null>(() =>
      loadLocalEmotionAnalysisProfile()
    );
  const activeProfile = profile ?? localProfile;
  const [editing, setEditing] = useState(!activeProfile);
  const [birthDate, setBirthDate] = useState(activeProfile?.birthDate ?? "");
  const [birthPlace, setBirthPlace] = useState(
    activeProfile?.analysisSeed.birthPlace ?? ""
  );
  const [currentLocation, setCurrentLocation] = useState(
    activeProfile?.analysisSeed.currentLocation ?? ""
  );
  const [userMessage, setUserMessage] = useState(
    activeProfile?.analysisSeed.userMessage ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [entryOpen, setEntryOpen] = useState(!activeProfile);

  useEffect(() => {
    if (!profile) return;
    setLocalProfile(profile);
    saveLocalEmotionAnalysisProfile(profile);
    setBirthDate(profile.birthDate);
    setBirthPlace(profile.analysisSeed.birthPlace ?? "");
    setCurrentLocation(profile.analysisSeed.currentLocation ?? "");
    setUserMessage(profile.analysisSeed.userMessage ?? "");
    setEditing(false);
    setEntryOpen(false);
  }, [profile]);

  useEffect(() => {
    if (activeProfile || editing) return;
    setEditing(true);
  }, [activeProfile, editing]);

  const preview = useMemo(() => {
    if (!birthDate || !isValidBirthDate(birthDate, today)) return null;
    return buildEmotionAnalysisProfile(
      {
        birthDate,
        birthPlace,
        currentLocation,
        userMessage,
      },
      today,
      almanac
    );
  }, [almanac, birthDate, birthPlace, currentLocation, today, userMessage]);

  const shownProfile = editing ? preview : activeProfile;
  const isBirthDateValid = Boolean(preview);

  const handleSave = async () => {
    if (!preview || saving) return;
    setSaving(true);
    try {
      const input: SaveEmotionAnalysisProfileInput = {
        birthDate: preview.birthDate,
        dailyReference: preview.dailyReference,
        analysisSeed: preview.analysisSeed,
        consentAccepted: true,
        consentText: EMOTION_ANALYSIS_CONSENT_TEXT,
      };
      const saved = await onSaveProfile?.(input);
      const next = saved ?? preview;
      setLocalProfile(next);
      saveLocalEmotionAnalysisProfile(next);
      setEditing(false);
      if (compactEntry) setEntryOpen(false);
      toast.success(saved ? "今日回信已记入你的资料" : "今日回信已在本机记下");
    } catch {
      setLocalProfile(preview);
      saveLocalEmotionAnalysisProfile(preview);
      setEditing(false);
      toast.warning("暂时没写入账号，已先在这台设备记下");
    } finally {
      setSaving(false);
    }
  };

  if (compactEntry) {
    return (
      <section className="w-full px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-chat-brand text-xl font-normal leading-none text-foreground">
                {activeProfile && !entryOpen
                  ? "聊会儿的今日回信"
                  : "说一点关于你"}
              </h2>
              {profileLoading && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {activeProfile && !entryOpen
                ? "这是今天的版本，之后想补充什么都可以再说。"
                : "生日就够了，其他想说多少都随你。"}
            </p>
          </div>
          {activeProfile && !entryOpen && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setEntryOpen(true);
              }}
              className="shrink-0 rounded-md border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ borderColor: "var(--nayin-border)" }}
            >
              再说一点
            </button>
          )}
        </div>

        {(!activeProfile || entryOpen) && (
          <div className="mt-5 space-y-5">
            <div>
              <div className="font-chat-brand flex items-center gap-2 text-base font-normal text-foreground">
                <CalendarHeart className="h-3.5 w-3.5 text-nayin" />
                关于你
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-[11px] text-muted-foreground">
                    你的生日
                  </span>
                  <input
                    type="date"
                    value={birthDate}
                    max={today.cstDateStr}
                    onInput={event => setBirthDate(event.currentTarget.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
                    style={{ borderColor: "var(--nayin-border)" }}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    出生地（选填）
                  </span>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                    <input
                      type="text"
                      value={birthPlace}
                      onChange={event => setBirthPlace(event.target.value)}
                      placeholder="例如：北京"
                      maxLength={80}
                      className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-ring focus:ring-2 focus:ring-ring/25"
                      style={{ borderColor: "var(--nayin-border)" }}
                    />
                  </div>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    现在在哪里（选填）
                  </span>
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                    <input
                      type="text"
                      value={currentLocation}
                      onChange={event => setCurrentLocation(event.target.value)}
                      placeholder="例如：上海"
                      maxLength={80}
                      className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-ring focus:ring-2 focus:ring-ring/25"
                      style={{ borderColor: "var(--nayin-border)" }}
                    />
                  </div>
                </label>
              </div>
            </div>

            <label
              className="block border-t pt-4"
              style={{ borderColor: "var(--nayin-border)" }}
            >
              <span className="font-chat-brand flex items-center gap-2 text-base font-normal text-foreground">
                <MessageCircle className="h-3.5 w-3.5 text-nayin" />
                此刻想说什么
              </span>
              <textarea
                value={userMessage}
                onChange={event => setUserMessage(event.target.value)}
                placeholder="最近有点累、正在犹豫一件事、忽然想起一个人……都可以。"
                rows={3}
                maxLength={800}
                className="mt-3 w-full resize-none rounded-md border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-ring focus:ring-2 focus:ring-ring/25"
                style={{ borderColor: "var(--nayin-border)" }}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!isBirthDateValid || saving}
                className="inline-flex h-10 items-center gap-2 rounded-md px-4 text-xs font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "var(--nayin-accent)" }}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                听听聊会儿怎么说
              </button>
              {activeProfile && (
                <button
                  type="button"
                  onClick={() => {
                    setBirthDate(activeProfile.birthDate);
                    setBirthPlace(activeProfile.analysisSeed.birthPlace ?? "");
                    setCurrentLocation(
                      activeProfile.analysisSeed.currentLocation ?? ""
                    );
                    setUserMessage(
                      activeProfile.analysisSeed.userMessage ?? ""
                    );
                    setEditing(false);
                    setEntryOpen(false);
                  }}
                  className="h-10 rounded-md px-3 text-xs text-muted-foreground transition hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  先不改
                </button>
              )}
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground/80">
              {EMOTION_ANALYSIS_CONSENT_TEXT}
            </p>
          </div>
        )}

        {activeProfile && !entryOpen && (
          <div className="mt-5">
            <p className="text-sm leading-7 text-foreground">
              {activeProfile.dailyReference.summary}
            </p>

            <div
              className="mt-4 border-t pt-4"
              style={{ borderColor: "var(--nayin-border)" }}
            >
              <div className="font-chat-brand text-base font-normal text-foreground">
                今天可以这样过
              </div>
              <div className="mt-2 space-y-2">
                {activeProfile.dailyReference.schedule.map(item => (
                  <p
                    key={item.label}
                    className="text-xs leading-relaxed text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {item.label}，{item.title}
                    </span>
                    <span className="mx-1 opacity-40">·</span>
                    {item.detail}
                  </p>
                ))}
              </div>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              {activeProfile.dailyReference.note}
            </p>
            <p className="mt-3 text-[10px] text-muted-foreground/75">
              生日 {activeProfile.birthDate} · 更新于{" "}
              {formatSavedDate(activeProfile.savedAt)}
            </p>
          </div>
        )}
      </section>
    );
  }

  const content = (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "var(--nayin-glow)",
            color: "var(--nayin-accent)",
          }}
        >
          <HeartPulse className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-foreground">情绪分析</h2>
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] leading-none text-muted-foreground"
              style={{ borderColor: "var(--nayin-border)" }}
            >
              长期底盘
            </span>
            {profileLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            如果你愿意，可以留下出生日期。聊会儿会把它作为长期背景线索，结合今天的农历、社会角色和日常节奏，给出一份不诊断、不算命的今日参考。
          </p>
        </div>
        {activeProfile && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="修改出生日期"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {editing && (
        <div className="grid gap-3 rounded-md bg-foreground/[0.025] p-3 md:grid-cols-[0.85fr_1.15fr]">
          <label className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <CalendarHeart className="h-3.5 w-3.5 text-nayin" />
              出生日期
            </span>
            <input
              type="date"
              value={birthDate}
              max={today.cstDateStr}
              onInput={event => setBirthDate(event.currentTarget.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
              style={{ borderColor: "var(--nayin-border)" }}
            />
            <span className="block text-[11px] leading-relaxed text-muted-foreground">
              只需要日期，不需要具体时间。之后可以回来修改。
            </span>
          </label>

          <div className="flex flex-col justify-between gap-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {preview
                ? preview.dailyReference.summary
                : "填好日期后，这里会先预览一条今日情绪参考。"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!isBirthDateValid || saving}
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: "var(--nayin-accent)",
                  boxShadow: "0 10px 24px -18px var(--nayin-accent)",
                }}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                生成并保存
              </button>
              {activeProfile && (
                <button
                  type="button"
                  onClick={() => {
                    setBirthDate(activeProfile.birthDate);
                    setEditing(false);
                  }}
                  className="h-9 rounded-md px-3 text-xs text-muted-foreground transition hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  取消
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {shownProfile && (
        <div className="grid gap-3 md:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-md bg-foreground/[0.025] p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <Clock3 className="h-3.5 w-3.5 text-nayin" />
              今日情绪日程
            </div>
            <div className="mt-2 space-y-2">
              {shownProfile.dailyReference.schedule.map(item => (
                <div key={item.label} className="text-xs leading-relaxed">
                  <span className="font-medium text-foreground">
                    {item.label} · {item.title}
                  </span>
                  <span className="ml-1 text-muted-foreground">
                    {item.detail}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span
                className="rounded-full border px-2 py-1 text-[10px] leading-none"
                style={{
                  borderColor: "var(--nayin-border)",
                  color: "var(--nayin-accent-dim)",
                }}
              >
                {shownProfile.dailyReference.activity}
              </span>
              <span
                className="rounded-full border px-2 py-1 text-[10px] leading-none text-muted-foreground"
                style={{ borderColor: "var(--nayin-border)" }}
              >
                {shownProfile.dailyReference.lunarLabel}
              </span>
            </div>
          </div>

          <div className="rounded-md bg-foreground/[0.025] p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-nayin" />
              三个参照
            </div>
            <div className="mt-2 space-y-2">
              {shownProfile.dailyReference.lenses.map(lens => (
                <p
                  key={lens.label}
                  className="text-xs leading-relaxed text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    {lens.label}
                  </span>
                  <span className="mx-1 opacity-40">·</span>
                  {lens.detail}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {shownProfile && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>已记录到情绪分析</span>
          <span>生日 {shownProfile.birthDate}</span>
          <span>{shownProfile.analysisSeed.lifeStage}</span>
          <span>更新 {formatSavedDate(shownProfile.savedAt)}</span>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        {EMOTION_ANALYSIS_CONSENT_TEXT}
      </p>
    </div>
  );

  if (embedded) return <section className="w-full">{content}</section>;

  return (
    <section className="w-full max-w-3xl monitor-panel overflow-hidden">
      {content}
    </section>
  );
}
