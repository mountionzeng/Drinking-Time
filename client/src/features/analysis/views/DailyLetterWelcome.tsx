import {
  CalendarDays,
  Check,
  Loader2,
  MessageCircle,
  Pencil,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  clearLocalGuestEmotionAnalysisProfile,
  getOrCreateLocalEmotionGuestId,
  loadLocalGuestEmotionAnalysisProfile,
  normalizeEmotionAnalysisProfile,
  normalizeEmotionDailyLetter,
  type SaveEmotionAnalysisProfileInput,
} from "@/features/analysis/emotionAnalysis";
import EmotionAnalysisInvitePanel from "@/features/analysis/views/EmotionAnalysisInvitePanel";
import { publicDailyLetterForDate } from "@/features/analysis/publicDailyLetter";
import { useNayin } from "@/features/nayin/NayinContext";
import { useDailyAlmanac } from "@/features/nayin/hooks/useDailyAlmanac";
import DailyAtmospherePanel from "@/features/nayin/views/DailyAtmospherePanel";
import { trpc } from "@/lib/trpc";

const DAILY_LETTER_SEEN_PREFIX = "dt:dailyLetterSeen";
const PUBLIC_DAILY_LETTER_SEEN_KEY = "dt:publicDailyLetterSeen";

export function dailyLetterSeenKey(userId: number) {
  return `${DAILY_LETTER_SEEN_PREFIX}:${userId}`;
}

export function shouldShowDailyLetter(
  profileDate: string,
  seenDate: string | null,
  closedDate: string | null
) {
  return Boolean(
    profileDate && profileDate !== seenDate && profileDate !== closedDate
  );
}

export function shouldMarkDailyLetterSeen(
  selectedDate: string,
  profileDate: string
) {
  return Boolean(profileDate && selectedDate === profileDate);
}

export function nextDailyLetterDate(
  current: string,
  profileDate: string,
  previousProfileDate: string,
  availableDates: string[]
) {
  if (!profileDate) return current;
  if (profileDate !== previousProfileDate) return profileDate;
  return current && availableDates.includes(current) ? current : profileDate;
}

function readSeenDate(userId: number) {
  try {
    return window.localStorage.getItem(dailyLetterSeenKey(userId));
  } catch {
    return null;
  }
}

function writeSeenDate(userId: number, date: string) {
  try {
    window.localStorage.setItem(dailyLetterSeenKey(userId), date);
  } catch {
    // 浏览器禁用本地存储时，只影响“当天只展示一次”，不影响回信本身。
  }
}

function readPublicSeenDate() {
  try {
    return window.localStorage.getItem(PUBLIC_DAILY_LETTER_SEEN_KEY);
  } catch {
    return null;
  }
}

function writePublicSeenDate(date: string) {
  try {
    window.localStorage.setItem(PUBLIC_DAILY_LETTER_SEEN_KEY, date);
  } catch {
    // 浏览器禁用本地存储时，只影响“当天只展示一次”。
  }
}

function dateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${Number(match[2])}月${Number(match[3])}日`;
}

export function dailyLetterGreeting(hour: number) {
  if (hour < 5) return "夜深了，先让自己慢一点";
  if (hour < 11) return "早上好，今天也从容一点";
  if (hour < 14) return "中午好，先照顾好自己";
  if (hour < 19) return "下午好，给自己留点余地";
  return "晚上好，今天辛苦了";
}

function timestampLabel(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function letterParagraphs(summary: string) {
  return summary
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean);
}

export default function DailyLetterWelcome({
  forceOpen = false,
  onRequestClose,
}: {
  forceOpen?: boolean;
  onRequestClose?: () => void;
}) {
  const { user } = useAuth();
  const { today } = useNayin();
  const almanacQuery = useDailyAlmanac(today.cstDateStr);
  const profileQuery = trpc.emotionAnalysis.getProfile.useQuery(undefined, {
    enabled: Boolean(user?.id),
    retry: false,
  });
  const lettersQuery = trpc.emotionAnalysis.listDailyLetters.useQuery(
    { limit: 90 },
    {
      enabled: Boolean(user?.id && profileQuery.isSuccess),
      retry: false,
    }
  );
  const rewriteMut = trpc.emotionAnalysis.rewriteDailyLetter.useMutation();
  const saveProfileMut = trpc.emotionAnalysis.saveBirthProfile.useMutation();
  const importGuestProfileMut =
    trpc.emotionAnalysis.importGuestProfile.useMutation();
  const utils = trpc.useUtils();
  const [closedDate, setClosedDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [editingMessage, setEditingMessage] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [guestProfile, setGuestProfile] = useState(() =>
    loadLocalGuestEmotionAnalysisProfile()
  );
  const [guestImportDismissed, setGuestImportDismissed] = useState(false);
  const lastProfileDateRef = useRef("");
  const dialogRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const profile = useMemo(
    () => normalizeEmotionAnalysisProfile(profileQuery.data, "server"),
    [profileQuery.data]
  );
  const publicLetter = useMemo(
    () => publicDailyLetterForDate(today.cstDateStr),
    [today.cstDateStr]
  );
  const saveInitialProfile = useCallback(
    async (input: SaveEmotionAnalysisProfileInput) => {
      const saved = await saveProfileMut.mutateAsync(input);
      await Promise.all([
        utils.emotionAnalysis.getProfile.invalidate(),
        utils.emotionAnalysis.listDailyLetters.invalidate(),
      ]);
      return normalizeEmotionAnalysisProfile(saved, "server") ?? undefined;
    },
    [
      saveProfileMut,
      utils.emotionAnalysis.getProfile,
      utils.emotionAnalysis.listDailyLetters,
    ]
  );
  const importGuestProfile = useCallback(async () => {
    if (!guestProfile || importGuestProfileMut.isPending) return;
    try {
      await importGuestProfileMut.mutateAsync({
        guestId: getOrCreateLocalEmotionGuestId(),
        birthDate: guestProfile.birthDate,
        dailyReference: guestProfile.dailyReference,
        analysisSeed: guestProfile.analysisSeed,
        consentAccepted: true,
        consentText: guestProfile.consentText,
      });
      clearLocalGuestEmotionAnalysisProfile();
      setGuestProfile(null);
      setGuestImportDismissed(false);
      await Promise.all([
        utils.emotionAnalysis.getProfile.invalidate(),
        utils.emotionAnalysis.listDailyLetters.invalidate(),
      ]);
      toast.success("这台设备上的资料和旧话已经带进账号");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "旧话暂时没有带进账号"
      );
    }
  }, [
    guestProfile,
    importGuestProfileMut,
    utils.emotionAnalysis.getProfile,
    utils.emotionAnalysis.listDailyLetters,
  ]);
  const letters = useMemo(
    () =>
      (lettersQuery.data ?? [])
        .map(normalizeEmotionDailyLetter)
        .filter(item => item !== null),
    [lettersQuery.data]
  );
  const profileDate = profile?.dailyReference.todayDate ?? "";
  const letterDates = useMemo(
    () =>
      Array.from(
        new Set(
          [profileDate, ...letters.map(item => item.letterDate)].filter(Boolean)
        )
      ).sort((a, b) => b.localeCompare(a)),
    [letters, profileDate]
  );

  useEffect(() => {
    if (!profileDate) return;
    const previousProfileDate = lastProfileDateRef.current;
    const nextDate = nextDailyLetterDate(
      selectedDate,
      profileDate,
      previousProfileDate,
      letterDates
    );
    if (previousProfileDate !== profileDate) {
      lastProfileDateRef.current = profileDate;
      setEditingMessage(false);
    }
    if (nextDate !== selectedDate) setSelectedDate(nextDate);
  }, [letterDates, profileDate, selectedDate]);

  const selectedLetter =
    letters.find(item => item.letterDate === selectedDate) ?? null;
  const selectedReference =
    selectedLetter?.dailyReference ??
    (selectedDate === profileDate ? profile?.dailyReference : null);
  const selectedSeed =
    selectedLetter?.analysisSeed ??
    (selectedDate === profileDate ? profile?.analysisSeed : null);
  const selectedMessage =
    selectedLetter?.userMessage ??
    (selectedDate === profileDate
      ? (profile?.analysisSeed.userMessage ?? "")
      : "");
  const saidAt =
    selectedLetter?.userMessageSaidAt ??
    (selectedMessage && selectedDate === profileDate
      ? (profile?.savedAt ?? null)
      : null);
  const editedAt = selectedLetter?.userMessageEditedAt ?? null;
  const userId = user?.id;
  const seenDate = userId ? readSeenDate(userId) : readPublicSeenDate();
  const autoVisible = userId
    ? Boolean(profile) &&
      shouldShowDailyLetter(profileDate, seenDate, closedDate)
    : shouldShowDailyLetter(publicLetter.date, seenDate, closedDate);
  const visible = forceOpen || autoVisible;

  useEffect(() => {
    if (!editingMessage) setMessageDraft(selectedMessage);
  }, [editingMessage, selectedMessage, selectedDate]);

  const closeLetter = useCallback(() => {
    if (userId && shouldMarkDailyLetterSeen(selectedDate, profileDate)) {
      writeSeenDate(userId, profileDate);
      setClosedDate(profileDate);
    } else if (!userId) {
      writePublicSeenDate(publicLetter.date);
      setClosedDate(publicLetter.date);
    }
    setEditingMessage(false);
    onRequestClose?.();
  }, [onRequestClose, profileDate, publicLetter.date, selectedDate, userId]);

  useEffect(() => {
    if (!visible) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    dialog?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLetter();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [closeLetter, visible]);

  const beginEditing = () => {
    if (!selectedLetter) return;
    setMessageDraft(selectedMessage);
    setEditingMessage(true);
  };

  const saveMessage = async () => {
    if (!selectedDate || !selectedLetter || rewriteMut.isPending) return;
    try {
      await rewriteMut.mutateAsync({
        letterDate: selectedDate,
        userMessage: messageDraft,
        expectedRevision: selectedLetter.revision,
      });
      await Promise.all([
        utils.emotionAnalysis.listDailyLetters.invalidate(),
        utils.emotionAnalysis.getProfile.invalidate(),
      ]);
      setEditingMessage(false);
      toast.success("这一天的话已保存，回信也重新写好了");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "回信暂时没有改好");
    }
  };

  if (!userId) {
    if (!visible) return null;
    return (
      <div
        className="fixed inset-0 z-[100] overflow-y-auto bg-background/95 px-4 py-6"
        role="dialog"
        aria-modal="true"
        aria-label="今日来信"
      >
        <section
          ref={dialogRef}
          tabIndex={-1}
          className="mx-auto flex min-h-full w-full max-w-2xl items-center outline-none"
        >
          <div className="w-full border-y py-8">
            <header className="flex items-start justify-between gap-5">
              <div>
                <p className="text-[10px] text-muted-foreground">
                  {publicLetter.date} · 写给今天打开页面的你
                </p>
                <h1 className="font-chat-brand mt-2 text-3xl font-normal text-foreground">
                  {dailyLetterGreeting(new Date().getHours())}
                </h1>
              </div>
              <button
                type="button"
                onClick={closeLetter}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="收起今日来信"
                title="收起今日来信"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="mt-7 space-y-4 border-t pt-6">
              {publicLetter.paragraphs.map(paragraph => (
                <p
                  key={paragraph}
                  className="text-sm leading-7 text-foreground"
                >
                  {paragraph}
                </p>
              ))}
            </div>

            <div className="mt-7 flex justify-end border-t pt-4">
              <button
                type="button"
                onClick={closeLetter}
                className="px-2 py-2 text-xs text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                把信收好，开始今天
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (profileQuery.isSuccess && guestProfile && !guestImportDismissed) {
    const localMessageCount =
      guestProfile.analysisSeed.messageHistory?.length ??
      (guestProfile.analysisSeed.userMessage ? 1 : 0);
    return (
      <div
        className="fixed inset-0 z-[100] overflow-y-auto bg-background/95 px-4 py-6"
        role="dialog"
        aria-modal="true"
        aria-label="导入本机资料"
      >
        <section className="mx-auto flex min-h-full w-full max-w-xl items-center">
          <div className="w-full border-y py-8">
            <p className="text-[10px] text-muted-foreground">
              登录成功 · 由你决定
            </p>
            <h1 className="font-chat-brand mt-2 text-3xl font-normal text-foreground">
              把这台设备上的旧话带进账号吗？
            </h1>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              我们找到了生日 {guestProfile.birthDate}
              {localMessageCount
                ? `，以及 ${localMessageCount} 条你说过的话`
                : "和一份本地资料"}
              。带进账号后，换设备也能接着聊。
            </p>
            {profile ? (
              <p className="mt-2 text-xs leading-6 text-muted-foreground/80">
                账号已经有生日资料，因此这里只合并旧话和缺少的地点，不覆盖账号里的生日。
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void importGuestProfile()}
                disabled={importGuestProfileMut.isPending}
                className="inline-flex h-10 items-center gap-2 rounded-md px-4 text-xs font-medium text-white disabled:opacity-50"
                style={{ background: "var(--nayin-accent)" }}
              >
                {importGuestProfileMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                带进账号
              </button>
              <button
                type="button"
                onClick={() => setGuestImportDismissed(true)}
                disabled={importGuestProfileMut.isPending}
                className="h-10 rounded-md px-4 text-xs text-muted-foreground hover:bg-foreground/[0.04]"
              >
                暂时不带
              </button>
            </div>
            <p className="mt-4 text-[10px] leading-5 text-muted-foreground/70">
              暂时不带不会删除本机内容；下次登录仍可以再决定。
            </p>
          </div>
        </section>
      </div>
    );
  }

  if (profileQuery.isSuccess && !profile) {
    return (
      <div
        className="fixed inset-0 z-[100] overflow-y-auto bg-background/95 px-4 py-6"
        role="dialog"
        aria-modal="true"
        aria-label="第一次写回信"
      >
        <section className="mx-auto w-full max-w-3xl">
          <header
            className="border-b pb-5"
            style={{ borderColor: "var(--nayin-border)" }}
          >
            <p className="text-[10px] text-muted-foreground">
              只需填写一次，之后可以随时修改
            </p>
            <h1 className="font-chat-brand mt-2 text-3xl font-normal text-foreground">
              先留一点关于你的信息
            </h1>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              这些资料会保存在你的账号里。今天的回信会由服务器重新计算，
              不再使用浏览器里的固定模板。
            </p>
          </header>
          <EmotionAnalysisInvitePanel
            today={today}
            almanac={almanacQuery.data}
            profile={null}
            profileLoading={
              profileQuery.isFetching ||
              almanacQuery.isLoading ||
              saveProfileMut.isPending
            }
            onSaveProfile={saveInitialProfile}
            embedded
            compactEntry
            persistLocalProfile={false}
          />
        </section>
      </div>
    );
  }

  if (!visible || !profile || !selectedReference || !selectedSeed) return null;

  const messageChanged = messageDraft.trim() !== selectedMessage.trim();

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-background/95 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="你的每日回信"
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl outline-none"
      >
        <header
          className="flex items-start justify-between gap-5 border-b pb-5"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground">
              {selectedDate} · {selectedReference.lunarLabel}
            </p>
            <h1 className="font-chat-brand mt-2 text-3xl font-normal text-foreground">
              {selectedDate === profileDate
                ? dailyLetterGreeting(new Date().getHours())
                : `${dateLabel(selectedDate)}的回信`}
            </h1>
          </div>
          <button
            type="button"
            onClick={closeLetter}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="收起回信"
            title="收起回信"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div
          className="flex items-center gap-3 border-b py-3"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-nayin" />
          <label
            htmlFor="daily-letter-date"
            className="text-xs text-muted-foreground"
          >
            想翻回哪一天
          </label>
          <select
            id="daily-letter-date"
            value={selectedDate}
            disabled={rewriteMut.isPending}
            onChange={event => {
              setSelectedDate(event.target.value);
              setEditingMessage(false);
            }}
            className="min-w-0 bg-transparent text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
          >
            {letterDates.map(date => (
              <option key={date} value={date}>
                {date === profileDate ? `今天 · ${date}` : date}
              </option>
            ))}
          </select>
          {lettersQuery.isFetching && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        <DailyAtmospherePanel
          today={today}
          almanac={almanacQuery.data}
          loading={almanacQuery.isLoading}
          embedded
          compact
          personalizedYi={selectedReference.personalizedYi}
          personalizedJi={selectedReference.personalizedJi}
        />

        <section
          className="border-b py-5"
          style={{ borderColor: "var(--nayin-border)" }}
          aria-label="你在这天说的话"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-nayin" />
              <h2 className="font-chat-brand text-lg font-normal text-foreground">
                那天，你这样说
              </h2>
            </div>
            {!editingMessage && (
              <button
                type="button"
                onClick={beginEditing}
                disabled={!selectedLetter || lettersQuery.isFetching}
                className="inline-flex h-8 items-center gap-1.5 px-2 text-xs text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
              >
                <Pencil className="h-3 w-3" />
                {!selectedLetter
                  ? "整理中"
                  : selectedMessage
                    ? "修改"
                    : "写一点"}
              </button>
            )}
          </div>

          {editingMessage ? (
            <div className="mt-3">
              <textarea
                value={messageDraft}
                onChange={event => setMessageDraft(event.target.value)}
                rows={4}
                maxLength={800}
                placeholder="今天发生了什么，或者你现在是什么感受？"
                className="w-full resize-none border-0 bg-transparent p-0 text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground/55 focus:ring-0"
                autoFocus
              />
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveMessage()}
                  disabled={!messageChanged || rewriteMut.isPending}
                  className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "var(--nayin-accent)" }}
                >
                  {rewriteMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  记下这句，再读一遍
                </button>
                <button
                  type="button"
                  onClick={() => setEditingMessage(false)}
                  className="h-9 px-2 text-xs text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  先放着
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-3 text-sm leading-7 text-foreground">
                {selectedMessage ||
                  "这一天还没有写下新话，所以来信不会翻出以前的具体事情。"}
              </p>
              {(saidAt || editedAt) && (
                <p className="mt-1 text-[9px] text-muted-foreground/65">
                  {saidAt ? `说于 ${timestampLabel(saidAt)}` : ""}
                  {saidAt && editedAt ? " · " : ""}
                  {editedAt ? `改于 ${timestampLabel(editedAt)}` : ""}
                </p>
              )}
            </>
          )}
          <p className="mt-3 text-[10px] leading-5 text-muted-foreground/70">
            只有你今天写下新话时，聊会儿才会在确有关系的地方参考以前的文字。
          </p>
        </section>

        <section className="py-6" aria-label="聊会儿的回信">
          <div className="space-y-4">
            {letterParagraphs(selectedReference.summary).map(paragraph => (
              <p key={paragraph} className="text-sm leading-7 text-foreground">
                {paragraph}
              </p>
            ))}
          </div>
          <p className="mt-5 text-[9px] text-muted-foreground/60">
            第 {selectedLetter?.revision ?? 1} 版
            {selectedLetter?.updatedAt
              ? ` · 更新于 ${timestampLabel(selectedLetter.updatedAt)}`
              : ""}
          </p>
        </section>

        <div
          className="flex justify-end border-t pt-4"
          style={{ borderColor: "var(--nayin-border)" }}
        >
          <button
            type="button"
            onClick={closeLetter}
            className="px-2 py-2 text-xs text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            把信收好，继续聊
          </button>
        </div>
      </section>
    </div>
  );
}
