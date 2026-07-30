import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EmotionMessageEntry } from "@/features/analysis/emotionAnalysis";

export interface ConversationDay {
  dateKey: string;
  dayLabel: string;
  entries: EmotionMessageEntry[];
}

function chinaDateParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value;
  const year = read("year");
  const month = read("month");
  const day = read("day");
  return year && month && day ? { year, month, day } : null;
}

export function conversationMonthKey(value: string) {
  const parts = chinaDateParts(value);
  return parts ? `${parts.year}-${parts.month}` : null;
}

export function conversationMonthKeys(entries: EmotionMessageEntry[]) {
  return Array.from(
    new Set(
      entries
        .map(entry => conversationMonthKey(entry.saidAt))
        .filter((value): value is string => Boolean(value))
    )
  ).sort((left, right) => right.localeCompare(left));
}

export function conversationDaysForMonth(
  entries: EmotionMessageEntry[],
  monthKey: string
): ConversationDay[] {
  const groups = new Map<string, EmotionMessageEntry[]>();
  entries.forEach(entry => {
    const parts = chinaDateParts(entry.saidAt);
    if (!parts || `${parts.year}-${parts.month}` !== monthKey) return;
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    groups.set(dateKey, [...(groups.get(dateKey) ?? []), entry]);
  });
  return Array.from(groups.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([dateKey, dayEntries]) => ({
      dateKey,
      dayLabel: `${Number(dateKey.slice(8, 10))}日`,
      entries: [...dayEntries].sort((left, right) =>
        left.saidAt.localeCompare(right.saidAt)
      ),
    }));
}

export function formatConversationMonth(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${year}年${Number(month)}月`;
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

interface ConversationMonthArchiveProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: EmotionMessageEntry[];
  onEdit: (entry: EmotionMessageEntry) => void;
  onDelete: (id: string) => void;
  onContinue: (day: ConversationDay) => void;
}

export default function ConversationMonthArchive({
  open,
  onOpenChange,
  entries,
  onEdit,
  onDelete,
  onContinue,
}: ConversationMonthArchiveProps) {
  const months = useMemo(() => conversationMonthKeys(entries), [entries]);
  const [monthIndex, setMonthIndex] = useState(0);
  const selectedMonth = months[monthIndex] ?? "";
  const days = useMemo(
    () =>
      selectedMonth ? conversationDaysForMonth(entries, selectedMonth) : [],
    [entries, selectedMonth]
  );
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const selectedDay =
    days.find(day => day.dateKey === selectedDayKey) ?? days[0] ?? null;

  useEffect(() => {
    if (!open) return;
    setMonthIndex(0);
    setSelectedDayKey("");
  }, [open]);

  useEffect(() => {
    if (monthIndex < months.length) return;
    setMonthIndex(Math.max(0, months.length - 1));
  }, [monthIndex, months.length]);

  useEffect(() => {
    if (!days.length) {
      setSelectedDayKey("");
      return;
    }
    if (!days.some(day => day.dateKey === selectedDayKey)) {
      setSelectedDayKey(days[0].dateKey);
    }
  }, [days, selectedDayKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] max-w-[620px] overflow-y-auto rounded-md border-0 px-4 pb-4 pt-5 sm:px-6 sm:pb-5"
        style={{ boxShadow: "0 24px 80px -32px rgba(40, 28, 18, 0.45)" }}
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="font-chat-brand text-xl font-normal">
            和以前的自己聊聊
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            按月份翻一翻。那时说过的话还在，今天可以从任何一天接着聊。
          </DialogDescription>
        </DialogHeader>

        {months.length > 0 ? (
          <>
            <div
              className="flex items-center justify-between border-y py-2"
              style={{ borderColor: "var(--nayin-border)" }}
              aria-label="月份标题栏"
            >
              <button
                type="button"
                onClick={() =>
                  setMonthIndex(current =>
                    Math.min(current + 1, months.length - 1)
                  )
                }
                disabled={monthIndex >= months.length - 1}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-25"
                aria-label="上一个月"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-chat-brand text-lg text-foreground">
                {formatConversationMonth(selectedMonth)}
              </span>
              <button
                type="button"
                onClick={() =>
                  setMonthIndex(current => Math.max(current - 1, 0))
                }
                disabled={monthIndex === 0}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-25"
                aria-label="下一个月"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1" aria-label="日期">
              {days.map(day => {
                const selected = selectedDay?.dateKey === day.dateKey;
                return (
                  <button
                    key={day.dateKey}
                    type="button"
                    onClick={() => setSelectedDayKey(day.dateKey)}
                    className="h-8 shrink-0 rounded-full border px-3 text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{
                      borderColor: selected
                        ? "var(--nayin-accent)"
                        : "var(--nayin-border)",
                      color: selected
                        ? "var(--nayin-accent)"
                        : "var(--muted-foreground)",
                      background: selected
                        ? "var(--nayin-glow)"
                        : "transparent",
                    }}
                    aria-pressed={selected}
                  >
                    {day.dayLabel}
                    <span className="ml-1 opacity-60">
                      {day.entries.length}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedDay && (
              <div>
                <div className="space-y-0">
                  {selectedDay.entries.map(entry => (
                    <div
                      key={entry.id}
                      className="group border-b py-3 last:border-b-0"
                      style={{ borderColor: "var(--nayin-border)" }}
                    >
                      <p className="text-sm leading-7 text-foreground">
                        {entry.text}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5 text-[9px] text-muted-foreground/65">
                        <span>说于 {formatMessageTime(entry.saidAt)}</span>
                        {entry.editedAt && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              改于 {formatMessageTime(entry.editedAt)}
                            </span>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => onEdit(entry)}
                          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/55 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`修改这句话：${entry.text.slice(0, 16)}`}
                          title="修改这句话"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(entry.id)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/45 transition hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`删除这句话：${entry.text.slice(0, 16)}`}
                          title="删除这句话"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onContinue(selectedDay)}
                  className="mt-2 inline-flex h-9 items-center gap-2 rounded-md px-4 text-xs font-medium text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ background: "var(--nayin-accent)" }}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  从这一天接着聊
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            这里还没有以前说过的话。
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
