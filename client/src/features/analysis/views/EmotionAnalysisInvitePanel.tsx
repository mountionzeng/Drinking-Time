import { useEffect, useMemo, useState } from "react";
import {
  CalendarHeart,
  CheckCircle2,
  Clock3,
  HeartPulse,
  Loader2,
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
  onSaveProfile,
}: EmotionAnalysisInvitePanelProps) {
  const [localProfile, setLocalProfile] =
    useState<EmotionAnalysisProfile | null>(() =>
      loadLocalEmotionAnalysisProfile()
    );
  const activeProfile = profile ?? localProfile;
  const [editing, setEditing] = useState(!activeProfile);
  const [birthDate, setBirthDate] = useState(activeProfile?.birthDate ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setLocalProfile(profile);
    saveLocalEmotionAnalysisProfile(profile);
    setBirthDate(profile.birthDate);
    setEditing(false);
  }, [profile]);

  useEffect(() => {
    if (activeProfile || editing) return;
    setEditing(true);
  }, [activeProfile, editing]);

  const preview = useMemo(() => {
    if (!birthDate || !isValidBirthDate(birthDate, today)) return null;
    return buildEmotionAnalysisProfile(birthDate, today, almanac);
  }, [almanac, birthDate, today]);

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
      toast.success(saved ? "已存入情绪分析" : "已在本机保存情绪分析");
    } catch {
      setLocalProfile(preview);
      saveLocalEmotionAnalysisProfile(preview);
      setEditing(false);
      toast.warning("服务端暂时没写入，已先保存在这台设备");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="w-full max-w-3xl monitor-panel overflow-hidden">
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
              如果你愿意，可以留下出生日期。小酌会把它作为长期背景线索，结合今天的农历、社会角色和日常节奏，给出一份不诊断、不算命的今日参考。
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
                onChange={event => setBirthDate(event.target.value)}
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
    </section>
  );
}
