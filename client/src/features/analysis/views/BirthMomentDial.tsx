import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Minus,
  Plus,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shichenFromTime } from "@shared/shichen";

type PickerMode = "date" | "time";

type DateParts = {
  year: number;
  month: number;
  day: number;
};

export const MINUTE_DIAL_VALUES = Array.from(
  { length: 12 },
  (_, index) => index * 5
);

function parseDate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const parsed = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return parsed.getUTCFullYear() === parts.year &&
    parsed.getUTCMonth() === parts.month - 1 &&
    parsed.getUTCDate() === parts.day
    ? parts
    : null;
}

export function daysInBirthMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatBirthDateParts(parts: DateParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

export function clampBirthDateParts(
  parts: DateParts,
  maxDate: string
): DateParts {
  const max = parseDate(maxDate) ?? {
    year: new Date().getFullYear(),
    month: 12,
    day: 31,
  };
  const year = Math.min(Math.max(parts.year, 1900), max.year);
  const month = Math.min(Math.max(parts.month, 1), 12);
  const day = Math.min(Math.max(parts.day, 1), daysInBirthMonth(year, month));
  const candidate = { year, month, day };
  return formatBirthDateParts(candidate) > maxDate ? max : candidate;
}

function ringPosition(index: number, total: number, radius = 43) {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return {
    left: `${50 + Math.cos(angle) * radius}%`,
    top: `${50 + Math.sin(angle) * radius}%`,
  };
}

function formatVisibleDate(value: string) {
  const parts = parseDate(value);
  return parts
    ? `${parts.year} / ${String(parts.month).padStart(2, "0")} / ${String(
        parts.day
      ).padStart(2, "0")}`
    : "选择生日";
}

export function clockHourTo24Hour(clockHour: number, isAfternoon: boolean) {
  const normalized = clockHour === 12 ? 0 : clockHour;
  return normalized + (isAfternoon ? 12 : 0);
}

interface BirthMomentDialProps {
  birthDate: string;
  birthTime: string;
  maxDate: string;
  onBirthDateChange: (value: string) => void;
  onBirthTimeChange: (value: string) => void;
  variant?: "compact" | "standard";
}

export default function BirthMomentDial({
  birthDate,
  birthTime,
  maxDate,
  onBirthDateChange,
  onBirthTimeChange,
  variant = "compact",
}: BirthMomentDialProps) {
  const maxParts = useMemo(
    () =>
      parseDate(maxDate) ?? {
        year: new Date().getFullYear(),
        month: 1,
        day: 1,
      },
    [maxDate]
  );
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PickerMode>("date");
  const [draftDate, setDraftDate] = useState<DateParts>(
    () => parseDate(birthDate) ?? maxParts
  );
  const [draftYearText, setDraftYearText] = useState(() =>
    String((parseDate(birthDate) ?? maxParts).year)
  );
  const initialTime = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(birthTime);
  const [draftHour, setDraftHour] = useState(Number(initialTime?.[1] ?? "12"));
  const [draftMinute, setDraftMinute] = useState(
    Number(initialTime?.[2] ?? "0")
  );
  const [hasTime, setHasTime] = useState(Boolean(initialTime));
  const [draftLunarLabel, setDraftLunarLabel] = useState("");

  const openPicker = (nextMode: PickerMode) => {
    const nextDate = parseDate(birthDate) ?? maxParts;
    setMode(nextMode);
    setDraftDate(nextDate);
    setDraftYearText(String(nextDate.year));
    const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(birthTime);
    setDraftHour(Number(time?.[1] ?? "12"));
    setDraftMinute(Number(time?.[2] ?? "0"));
    setHasTime(Boolean(time));
    setOpen(true);
  };

  const updateDate = (patch: Partial<DateParts>) => {
    setDraftDate(current => {
      const next = clampBirthDateParts({ ...current, ...patch }, maxDate);
      if (patch.year !== undefined) setDraftYearText(String(next.year));
      return next;
    });
  };

  const commitYearInput = () => {
    const year = Number(draftYearText);
    if (!/^\d{4}$/.test(draftYearText) || !Number.isInteger(year)) {
      setDraftYearText(String(draftDate.year));
      return;
    }
    updateDate({ year });
  };

  const changeYearInput = (value: string) => {
    const nextValue = value.replace(/\D/g, "").slice(0, 4);
    setDraftYearText(nextValue);
    if (/^\d{4}$/.test(nextValue)) {
      updateDate({ year: Number(nextValue) });
    }
  };

  const chooseClockHour = (clockHour: number) => {
    setDraftHour(clockHourTo24Hour(clockHour, draftHour >= 12));
    setHasTime(true);
  };

  const draftTime = `${String(draftHour).padStart(2, "0")}:${String(
    draftMinute
  ).padStart(2, "0")}`;
  const draftShichen = shichenFromTime(draftTime);

  useEffect(() => {
    let active = true;
    if (!open || mode !== "date") return () => {};
    const solarDate = formatBirthDateParts(draftDate);
    void import("@shared/bazi").then(({ calculateBirthLunarDate }) => {
      if (!active) return;
      setDraftLunarLabel(calculateBirthLunarDate(solarDate)?.label ?? "");
    });
    return () => {
      active = false;
    };
  }, [draftDate, mode, open]);

  const save = () => {
    if (mode === "date") {
      onBirthDateChange(formatBirthDateParts(draftDate));
    } else {
      onBirthTimeChange(hasTime ? draftTime : "");
    }
    setOpen(false);
  };

  const triggerClass =
    variant === "compact" ? "h-11 px-3 text-left" : "h-10 px-3 text-left";

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => openPicker("date")}
          className={`${triggerClass} flex w-full items-center gap-3 rounded-md border bg-background text-foreground transition hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          style={{ borderColor: "var(--nayin-border)" }}
          aria-label="设置生日"
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-nayin" />
          <span className="min-w-0">
            <span className="block text-[9px] leading-none text-muted-foreground">
              公历生日
            </span>
            <span className="mt-1 block truncate text-sm">
              {formatVisibleDate(birthDate)}
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => openPicker("time")}
          className={`${triggerClass} flex w-full items-center gap-3 rounded-md border bg-background text-foreground transition hover:bg-foreground/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          style={{ borderColor: "var(--nayin-border)" }}
          aria-label="设置出生时间"
        >
          <Clock3 className="h-3.5 w-3.5 shrink-0 text-nayin" />
          <span className="min-w-0">
            <span className="block text-[9px] leading-none text-muted-foreground">
              时辰
            </span>
            <span className="mt-1 block truncate text-sm">
              {birthTime
                ? `${birthTime} · ${shichenFromTime(birthTime)}`
                : "可以不填"}
            </span>
          </span>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={`max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md border-0 px-4 pb-4 pt-5 sm:px-6 sm:pb-5 ${
            mode === "time" ? "max-w-[660px]" : "max-w-[420px]"
          }`}
          style={{ boxShadow: "0 24px 80px -32px rgba(40, 28, 18, 0.45)" }}
        >
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="text-xl font-medium">
              {mode === "date" ? "你的生日" : "出生时辰"}
            </DialogTitle>
            <DialogDescription className="text-xs leading-5">
              {mode === "date"
                ? "按公历选择年月日，农历与三柱会自动换算。"
                : "左边选小时，右边选分钟；不确定也可以先留空。"}
            </DialogDescription>
          </DialogHeader>

          {mode === "date" ? (
            <div>
              <div className="mx-auto flex max-w-[280px] items-center justify-between">
                <button
                  type="button"
                  onClick={() => updateDate({ year: draftDate.year - 1 })}
                  disabled={draftDate.year <= 1900}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-30"
                  aria-label="上一年"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <label className="flex items-center gap-1 text-foreground">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={draftYearText}
                    onChange={event => changeYearInput(event.target.value)}
                    onBlur={commitYearInput}
                    onFocus={event => event.currentTarget.select()}
                    onKeyDown={event => {
                      if (event.key === "Enter") {
                        commitYearInput();
                        event.currentTarget.blur();
                      }
                    }}
                    className="h-9 w-[74px] rounded-full border bg-transparent px-2 text-center text-lg font-normal outline-none transition focus:ring-2 focus:ring-ring"
                    style={{ borderColor: "var(--nayin-border)" }}
                    aria-label="输入出生年份"
                  />
                  <span className="text-lg">年</span>
                </label>
                <button
                  type="button"
                  onClick={() => updateDate({ year: draftDate.year + 1 })}
                  disabled={draftDate.year >= maxParts.year}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-30"
                  aria-label="下一年"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div
                className="relative mx-auto mt-2 aspect-square w-[min(76vw,286px)] rounded-full border"
                style={{ borderColor: "var(--nayin-border)" }}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map(
                  (month, index) => {
                    const selected = draftDate.month === month;
                    return (
                      <button
                        key={month}
                        type="button"
                        onClick={() => updateDate({ month })}
                        className="absolute inline-flex h-8 w-8 items-center justify-center rounded-full text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{
                          ...ringPosition(index, 12),
                          transform: "translate(-50%, -50%)",
                          color: selected ? "white" : "var(--muted-foreground)",
                          background: selected
                            ? "var(--nayin-accent)"
                            : "transparent",
                        }}
                        aria-label={`${month}月`}
                        aria-pressed={selected}
                      >
                        {month}月
                      </button>
                    );
                  }
                )}
                <div
                  className="absolute left-1/2 top-1/2 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full"
                  style={{ background: "var(--nayin-glow)" }}
                >
                  <span className="text-[10px] text-muted-foreground">
                    {draftDate.month} 月
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateDate({ day: draftDate.day - 1 })}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background"
                      aria-label="前一天"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <strong className="w-9 text-center text-2xl font-medium text-foreground">
                      {draftDate.day}
                    </strong>
                    <button
                      type="button"
                      onClick={() => updateDate({ day: draftDate.day + 1 })}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background"
                      aria-label="后一天"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <span className="mt-1 text-[9px] text-muted-foreground/70">
                    {formatBirthDateParts(draftDate)}
                  </span>
                  {draftLunarLabel && (
                    <span className="mt-0.5 text-[8px] text-muted-foreground/60">
                      {draftLunarLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="grid items-start gap-5 sm:grid-cols-2 sm:gap-6">
                <div
                  className="relative mx-auto aspect-square w-[min(72vw,252px)] rounded-full border"
                  style={{ borderColor: "var(--nayin-border)" }}
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map(
                    (clockHour, index) => {
                      const selected =
                        hasTime &&
                        (draftHour % 12 === clockHour % 12 ||
                          (draftHour % 12 === 0 && clockHour === 12));
                      return (
                        <button
                          key={clockHour}
                          type="button"
                          onClick={() => chooseClockHour(clockHour)}
                          className="absolute inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          style={{
                            ...ringPosition(index, 12),
                            transform: "translate(-50%, -50%)",
                            color: selected
                              ? "white"
                              : "var(--muted-foreground)",
                            background: selected
                              ? "var(--nayin-accent)"
                              : "transparent",
                          }}
                          aria-label={`${clockHour}点`}
                          aria-pressed={selected}
                        >
                          {clockHour}
                        </button>
                      );
                    }
                  )}
                  <div
                    className="absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full"
                    style={{ background: "var(--nayin-glow)" }}
                  >
                    <span className="text-[9px] text-muted-foreground">
                      小时
                    </span>
                    <div className="mt-1 flex items-center gap-1 text-[10px]">
                      {[
                        { label: "上午", afternoon: false },
                        { label: "下午", afternoon: true },
                      ].map(item => {
                        const selected =
                          hasTime && draftHour >= 12 === item.afternoon;
                        return (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => {
                              setDraftHour(
                                clockHourTo24Hour(
                                  draftHour % 12 || 12,
                                  item.afternoon
                                )
                              );
                              setHasTime(true);
                            }}
                            className="rounded-full px-2 py-1 transition"
                            style={{
                              color: selected
                                ? "white"
                                : "var(--muted-foreground)",
                              background: selected
                                ? "var(--nayin-accent)"
                                : "transparent",
                            }}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                    <strong className="mt-1 text-xl font-medium tabular-nums text-foreground">
                      {String(draftHour).padStart(2, "0")}
                    </strong>
                  </div>
                </div>

                <div
                  className="relative mx-auto aspect-square w-[min(72vw,252px)] rounded-full border"
                  style={{ borderColor: "var(--nayin-border)" }}
                >
                  {MINUTE_DIAL_VALUES.map((minute, index) => {
                    const selected = hasTime && draftMinute === minute;
                    return (
                      <button
                        key={minute}
                        type="button"
                        onClick={() => {
                          setDraftMinute(minute);
                          setHasTime(true);
                        }}
                        className="absolute inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{
                          ...ringPosition(index, MINUTE_DIAL_VALUES.length),
                          transform: "translate(-50%, -50%)",
                          color: selected ? "white" : "var(--muted-foreground)",
                          background: selected
                            ? "var(--nayin-accent)"
                            : "transparent",
                        }}
                        aria-label={`${minute}分`}
                        aria-pressed={selected}
                      >
                        {String(minute).padStart(2, "0")}
                      </button>
                    );
                  })}
                  <div
                    className="absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full"
                    style={{ background: "var(--nayin-glow)" }}
                  >
                    <span className="text-[9px] text-muted-foreground">
                      分钟
                    </span>
                    <strong className="mt-1 text-xl font-medium tabular-nums text-foreground">
                      {String(draftMinute).padStart(2, "0")}
                    </strong>
                    <div className="mt-1 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setDraftMinute((draftMinute + 59) % 60);
                          setHasTime(true);
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background"
                        aria-label="分钟减一"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDraftMinute((draftMinute + 1) % 60);
                          setHasTime(true);
                        }}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition hover:bg-background"
                        aria-label="分钟加一"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-xs tabular-nums text-muted-foreground">
                {hasTime
                  ? `${draftTime} · ${draftShichen}`
                  : "暂不填写出生时间"}
              </p>
              <button
                type="button"
                onClick={() => setHasTime(false)}
                className="mx-auto mt-1 block text-[10px] text-muted-foreground underline decoration-transparent underline-offset-4 transition hover:decoration-current"
              >
                不填写具体时间
              </button>
            </div>
          )}

          <div
            className="flex items-center justify-end gap-2 border-t pt-3"
            style={{ borderColor: "var(--nayin-border)" }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 px-3 text-xs text-muted-foreground transition hover:text-foreground"
            >
              先不改
            </button>
            <button
              type="button"
              onClick={save}
              className="h-9 rounded-md px-4 text-xs font-medium text-white transition hover:opacity-90"
              style={{ background: "var(--nayin-accent)" }}
            >
              确定
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
