import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarHeart,
  CheckCircle2,
  Clock3,
  HeartPulse,
  History,
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
  EMOTION_DAILY_LETTER_VERSION,
  EMOTION_ANALYSIS_CONSENT_TEXT,
  isValidBirthDate,
  loadLocalGuestEmotionAnalysisProfile,
  loadLocalEmotionAnalysisProfile,
  saveLocalEmotionAnalysisProfile,
  type EmotionConversationMode,
  type EmotionMessageEntry,
  type EmotionAnalysisProfile,
  type SaveEmotionAnalysisProfileInput,
} from "@/features/analysis/emotionAnalysis";
import { toast } from "sonner";
import type { BirthDatePillars } from "@shared/bazi";
import BirthMomentDial from "@/features/analysis/views/BirthMomentDial";
import ConversationMonthArchive, {
  type ConversationDay,
} from "@/features/analysis/views/ConversationMonthArchive";

interface EmotionAnalysisInvitePanelProps {
  today: TodayNayin;
  almanac: AlmanacDay | null | undefined;
  profile?: EmotionAnalysisProfile | null;
  profileLoading?: boolean;
  embedded?: boolean;
  compactEntry?: boolean;
  persistLocalProfile?: boolean;
  guestMode?: boolean;
  onSaveProfile?: (
    input: SaveEmotionAnalysisProfileInput
  ) => Promise<EmotionAnalysisProfile | void>;
  onPreviewChange?: (profile: EmotionAnalysisProfile | null) => void;
}

function formatSavedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
}

function BirthDatePillarsLine({
  pillars,
  className = "",
}: {
  pillars: BirthDatePillars | null;
  className?: string;
}) {
  if (!pillars) return null;
  return (
    <p
      className={`flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-5 text-muted-foreground/75 ${className}`}
      aria-label={pillars.label}
    >
      <span>
        年柱{" "}
        <strong className="font-medium text-foreground">{pillars.year}</strong>
      </span>
      <span>
        月柱{" "}
        <strong className="font-medium text-foreground">{pillars.month}</strong>
      </span>
      <span>
        日柱{" "}
        <strong className="font-medium text-foreground">{pillars.day}</strong>
      </span>
    </p>
  );
}

function profileMessageHistory(
  profile: EmotionAnalysisProfile | null | undefined
): EmotionMessageEntry[] {
  if (!profile) return [];
  if (profile.analysisSeed.messageHistory?.length) {
    return profile.analysisSeed.messageHistory;
  }
  const text = profile.analysisSeed.userMessage?.trim();
  return text
    ? [{ id: `legacy-${profile.savedAt}`, text, saidAt: profile.savedAt }]
    : [];
}

function updateMessageHistory({
  history,
  text,
  editingId,
  now,
}: {
  history: EmotionMessageEntry[];
  text: string;
  editingId: string | null;
  now: string;
}) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return history;
  if (editingId) {
    return history.map(item =>
      item.id === editingId && item.text !== cleaned
        ? { ...item, text: cleaned, editedAt: now }
        : item
    );
  }
  return [
    ...history,
    {
      id: `message-${now}-${history.length + 1}`,
      text: cleaned,
      saidAt: now,
    },
  ].slice(-30);
}

function letterParagraphs(profile: EmotionAnalysisProfile) {
  const reference = profile.dailyReference;
  const paragraphs = reference.summary
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean);
  if (reference.summary.length < 180 && reference.avoid) {
    paragraphs.push(`今天尤其可以留意：${reference.avoid}`);
  }
  if (reference.summary.length < 180 && reference.note) {
    paragraphs.push(reference.note);
  }
  return Array.from(new Set(paragraphs));
}

export default function EmotionAnalysisInvitePanel({
  today,
  almanac,
  profile,
  profileLoading = false,
  embedded = false,
  compactEntry = false,
  persistLocalProfile = true,
  guestMode = false,
  onSaveProfile,
  onPreviewChange,
}: EmotionAnalysisInvitePanelProps) {
  const [localProfile, setLocalProfile] =
    useState<EmotionAnalysisProfile | null>(() =>
      persistLocalProfile
        ? guestMode
          ? loadLocalGuestEmotionAnalysisProfile()
          : loadLocalEmotionAnalysisProfile()
        : null
    );
  const activeProfile = profile ?? localProfile;
  const needsRealGuestReply =
    guestMode &&
    (activeProfile?.dailyReference.interpretationSource !== "302-deepseek" ||
      activeProfile?.dailyReference.letterVersion !==
        EMOTION_DAILY_LETTER_VERSION);
  const [editing, setEditing] = useState(!activeProfile || needsRealGuestReply);
  const [birthDate, setBirthDate] = useState(activeProfile?.birthDate ?? "");
  const [birthDatePillars, setBirthDatePillars] =
    useState<BirthDatePillars | null>(null);
  const [birthTime, setBirthTime] = useState(
    activeProfile?.analysisSeed.birthTime ?? ""
  );
  const [birthPlace, setBirthPlace] = useState(
    activeProfile?.analysisSeed.birthPlace ?? ""
  );
  const [currentLocation, setCurrentLocation] = useState(
    activeProfile?.analysisSeed.currentLocation ?? ""
  );
  const [userMessage, setUserMessage] = useState(
    activeProfile?.analysisSeed.userMessage ?? ""
  );
  const [messageHistory, setMessageHistory] = useState<EmotionMessageEntry[]>(
    () => profileMessageHistory(activeProfile)
  );
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [conversationMode, setConversationMode] =
    useState<EmotionConversationMode>(
      activeProfile?.analysisSeed.conversationMode ?? "today"
    );
  const [saving, setSaving] = useState(false);
  const [entryOpen, setEntryOpen] = useState(
    !activeProfile || needsRealGuestReply
  );
  const [historyArchiveOpen, setHistoryArchiveOpen] = useState(false);
  const [birthPrompted, setBirthPrompted] = useState(false);
  const birthFieldRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);

  function requestBirthDate() {
    setBirthPrompted(true);
    birthFieldRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    birthFieldRef.current?.querySelector("button")?.focus();
  }

  // 输入框随内容长高，封顶后再内部滚动，写长一点不会被 3 行的框压回去。
  useEffect(() => {
    const el = messageInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [userMessage, entryOpen, editing]);

  useEffect(() => {
    if (!profile) return;
    setLocalProfile(profile);
    if (persistLocalProfile) saveLocalEmotionAnalysisProfile(profile);
    setBirthDate(profile.birthDate);
    setBirthTime(profile.analysisSeed.birthTime ?? "");
    setBirthPlace(profile.analysisSeed.birthPlace ?? "");
    setCurrentLocation(profile.analysisSeed.currentLocation ?? "");
    setUserMessage(profile.analysisSeed.userMessage ?? "");
    setMessageHistory(profileMessageHistory(profile));
    setEditingMessageId(null);
    setConversationMode(profile.analysisSeed.conversationMode ?? "today");
    setEditing(false);
    setEntryOpen(false);
  }, [persistLocalProfile, profile]);

  useEffect(() => {
    if (activeProfile || editing) return;
    setEditing(true);
  }, [activeProfile, editing]);

  useEffect(() => {
    let active = true;
    if (!birthDate) {
      setBirthDatePillars(null);
      return () => {
        active = false;
      };
    }
    void import("@shared/bazi").then(({ calculateBirthDatePillars }) => {
      if (active) setBirthDatePillars(calculateBirthDatePillars(birthDate));
    });
    return () => {
      active = false;
    };
  }, [birthDate]);

  const preview = useMemo(() => {
    if (!birthDate || !isValidBirthDate(birthDate, today)) return null;
    return buildEmotionAnalysisProfile(
      {
        birthDate,
        birthTime,
        birthPlace,
        currentLocation,
        userMessage,
        conversationMode,
      },
      today,
      almanac
    );
  }, [
    almanac,
    birthDate,
    birthPlace,
    birthTime,
    currentLocation,
    conversationMode,
    today,
    userMessage,
  ]);

  const shownProfile = editing ? preview : activeProfile;
  const isBirthDateValid = Boolean(preview);
  useEffect(() => {
    onPreviewChange?.(shownProfile ?? null);
  }, [onPreviewChange, shownProfile]);

  const handleSave = async () => {
    if (saving) return;
    // 生日是回信的必要条件，但不该表现为一个灰着的死按钮：
    // 点下去就把人带回生日那一行，并说明为什么需要它。
    if (!preview) {
      requestBirthDate();
      return;
    }
    setSaving(true);
    const nextMessageHistory = updateMessageHistory({
      history: messageHistory,
      text: userMessage,
      editingId: editingMessageId,
      now: new Date().toISOString(),
    });
    const profileToSave =
      buildEmotionAnalysisProfile(
        {
          birthDate,
          birthTime,
          birthPlace,
          currentLocation,
          userMessage,
          messageHistory: nextMessageHistory,
          conversationMode,
        },
        today,
        almanac
      ) ?? preview;
    try {
      const input: SaveEmotionAnalysisProfileInput = {
        birthDate: profileToSave.birthDate,
        dailyReference: profileToSave.dailyReference,
        analysisSeed: profileToSave.analysisSeed,
        consentAccepted: true,
        consentText: EMOTION_ANALYSIS_CONSENT_TEXT,
      };
      const saved = await onSaveProfile?.(input);
      const next = saved ?? profileToSave;
      setLocalProfile(next);
      if (persistLocalProfile) saveLocalEmotionAnalysisProfile(next);
      setMessageHistory(profileMessageHistory(next));
      setEditingMessageId(null);
      setEditing(false);
      if (compactEntry) setEntryOpen(false);
      toast.success(
        guestMode
          ? "今日回信已留在这台设备"
          : saved
            ? "今日回信已记入你的资料"
            : "今日回信已在本机记下"
      );
    } catch (error) {
      if (persistLocalProfile) {
        setLocalProfile(profileToSave);
        saveLocalEmotionAnalysisProfile(profileToSave);
        setMessageHistory(nextMessageHistory);
        setEditingMessageId(null);
        if (guestMode) {
          setEditing(true);
          setEntryOpen(true);
          toast.error("资料已留在本机，回信暂时没有生成，请稍后再试");
        } else {
          setEditing(false);
          toast.warning("暂时没写入账号，已先在这台设备记下");
        }
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : "回信暂时没有生成，请再试一次"
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const openConversation = (mode: EmotionConversationMode) => {
    setEditing(true);
    setEntryOpen(true);
    setConversationMode(mode);
    setUserMessage("");
    setEditingMessageId(null);
  };

  const continueFromConversationDay = (day: ConversationDay) => {
    const latest = day.entries.at(-1);
    const [, month, date] = day.dateKey.split("-").map(Number);
    setConversationMode("history");
    setEditingMessageId(null);
    setUserMessage(
      latest
        ? `接着${month}月${date}日说的“${latest.text.slice(0, 42)}${latest.text.length > 42 ? "…" : ""}”，我现在想说：`
        : ""
    );
    setHistoryArchiveOpen(false);
  };

  if (compactEntry) {
    return (
      <section className="w-full px-5 py-5 sm:px-6">
        {activeProfile && !entryOpen && (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-medium leading-none text-foreground">
                  聊会儿写给你的信
                </h2>
                {profileLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                问题被好好看见，答案会慢慢浮出来。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => openConversation("today")}
                className="rounded-md border px-3 py-2 text-xs font-medium text-foreground transition hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ borderColor: "var(--nayin-border)" }}
              >
                再聊聊
              </button>
            </div>
          </div>
        )}

        {(!activeProfile || entryOpen) && (
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2 text-base font-medium text-foreground">
                <CalendarHeart className="h-3.5 w-3.5 text-nayin" />
                {guestMode ? "先在这台设备聊会儿" : "关于你"}
              </div>
              <div className="mt-3 space-y-3">
                <div
                  ref={birthFieldRef}
                  className={`rounded-md transition ${
                    birthPrompted && !isBirthDateValid
                      ? "ring-2 ring-ring/40 ring-offset-4 ring-offset-background"
                      : ""
                  }`}
                >
                  <div className="grid gap-3 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:items-center">
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                      你的生日
                    </span>
                    <div className="min-w-0">
                      <BirthMomentDial
                        birthDate={birthDate}
                        birthTime={birthTime}
                        maxDate={today.cstDateStr}
                        onBirthDateChange={setBirthDate}
                        onBirthTimeChange={setBirthTime}
                      />
                      <BirthDatePillarsLine
                        pillars={birthDatePillars}
                        className="mt-2"
                      />
                      {birthPrompted && !isBirthDateValid && (
                        <p
                          className="mt-2 text-[11px] leading-relaxed"
                          style={{ color: "var(--nayin-accent-dim)" }}
                        >
                          要按你的生日推今天的干支，先留一个再点。
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid items-center gap-3 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
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
                  <label className="grid items-center gap-3 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                      现在在哪里（选填）
                    </span>
                    <div className="relative">
                      <MapPin className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                      <input
                        type="text"
                        value={currentLocation}
                        onChange={event =>
                          setCurrentLocation(event.target.value)
                        }
                        placeholder="例如：上海"
                        maxLength={80}
                        className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-ring focus:ring-2 focus:ring-ring/25"
                        style={{ borderColor: "var(--nayin-border)" }}
                      />
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div
              className="block border-t pt-4"
              style={{ borderColor: "var(--nayin-border)" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="emotion-user-message"
                  className="flex items-center gap-2 text-base font-medium text-foreground"
                >
                  <MessageCircle className="h-3.5 w-3.5 text-nayin" />
                  今天想说什么
                </label>
                <button
                  type="button"
                  onClick={() => setHistoryArchiveOpen(true)}
                  disabled={messageHistory.length === 0}
                  className="flex items-center gap-2 text-base font-medium text-foreground transition hover:text-nayin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35"
                  title={
                    messageHistory.length > 0
                      ? "按月份看看以前说过的话"
                      : "还没有以前说过的话"
                  }
                >
                  <History className="h-3.5 w-3.5 text-nayin" />
                  和以前的自己聊聊
                </button>
              </div>
              <textarea
                id="emotion-user-message"
                value={userMessage}
                onChange={event => setUserMessage(event.target.value)}
                placeholder={
                  editingMessageId
                    ? "修改这句话"
                    : conversationMode === "history"
                      ? "可以说“接着上次那件事”，也可以直接写今天的新感受。"
                      : "今天发生了什么，或者此刻是什么感受？"
                }
                ref={messageInputRef}
                rows={3}
                maxLength={800}
                className="mt-3 w-full resize-none overflow-y-auto rounded-md border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none transition placeholder:text-muted-foreground/55 focus:border-ring focus:ring-2 focus:ring-ring/25"
                style={{ borderColor: "var(--nayin-border)", maxHeight: 320 }}
              />
              {userMessage.length > 640 && (
                <p className="mt-1 text-right text-[11px] text-muted-foreground">
                  {userMessage.length} / 800
                </p>
              )}
              <ConversationMonthArchive
                open={historyArchiveOpen}
                onOpenChange={setHistoryArchiveOpen}
                entries={messageHistory}
                onEdit={item => {
                  setConversationMode("history");
                  setUserMessage(item.text);
                  setEditingMessageId(item.id);
                  setHistoryArchiveOpen(false);
                }}
                onDelete={id => {
                  setMessageHistory(current =>
                    current.filter(message => message.id !== id)
                  );
                  if (editingMessageId === id) {
                    setEditingMessageId(null);
                    setUserMessage("");
                  }
                }}
                onContinue={continueFromConversationDay}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-md px-4 text-xs font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "var(--nayin-accent)" }}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                拆开看看
              </button>
              {saving && (
                <span className="text-[11px] text-muted-foreground">
                  正在写今天的回信，通常要十几秒。
                </span>
              )}
              {activeProfile && (
                <button
                  type="button"
                  onClick={() => {
                    setBirthDate(activeProfile.birthDate);
                    setBirthTime(activeProfile.analysisSeed.birthTime ?? "");
                    setBirthPlace(activeProfile.analysisSeed.birthPlace ?? "");
                    setCurrentLocation(
                      activeProfile.analysisSeed.currentLocation ?? ""
                    );
                    setUserMessage(
                      activeProfile.analysisSeed.userMessage ?? ""
                    );
                    setMessageHistory(profileMessageHistory(activeProfile));
                    setEditingMessageId(null);
                    setConversationMode(
                      activeProfile.analysisSeed.conversationMode ?? "today"
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
            {!guestMode && (
              <p className="text-[10px] leading-relaxed text-muted-foreground/80">
                {EMOTION_ANALYSIS_CONSENT_TEXT}
              </p>
            )}
          </div>
        )}

        {activeProfile && !entryOpen && (
          <div className="mt-5">
            <div className="space-y-4">
              {letterParagraphs(activeProfile).map(paragraph => (
                <p
                  key={paragraph}
                  className="text-sm leading-7 text-foreground"
                >
                  {paragraph}
                </p>
              ))}
            </div>

            <p className="mt-3 text-[10px] text-muted-foreground/75">
              生日 {activeProfile.birthDate}
              {activeProfile.analysisSeed.birthShichen
                ? ` · ${activeProfile.analysisSeed.birthShichen}`
                : ""}{" "}
              · 更新于 {formatSavedDate(activeProfile.savedAt)}
            </p>
            <BirthDatePillarsLine pillars={birthDatePillars} className="mt-1" />
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
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <CalendarHeart className="h-3.5 w-3.5 text-nayin" />
                你的生日
              </span>
              <BirthDatePillarsLine pillars={birthDatePillars} />
            </div>
            <BirthMomentDial
              birthDate={birthDate}
              birthTime={birthTime}
              maxDate={today.cstDateStr}
              onBirthDateChange={setBirthDate}
              onBirthTimeChange={setBirthTime}
              variant="standard"
            />
          </div>

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
                disabled={saving}
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
                    setBirthTime(activeProfile.analysisSeed.birthTime ?? "");
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
          {shownProfile.analysisSeed.birthShichen && (
            <span>{shownProfile.analysisSeed.birthShichen}</span>
          )}
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
