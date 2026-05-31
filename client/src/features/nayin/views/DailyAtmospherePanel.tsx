import { useState, type ReactNode } from "react";
import {
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  Clock3,
  Compass,
  ListChecks,
  Shirt,
  Sparkles,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  compactList,
  dailyAtmosphereLine,
  hasAuthorityBackedDetails,
  statusLabel,
  type AlmanacDay,
} from "@/features/nayin/almanac";
import {
  formatLunarDate,
  getDailyActivityAdvice,
  getDailyClothingAdvice,
} from "@/features/nayin/dailyPresentation";
import type { TodayNayin } from "@/features/nayin/nayin";

interface DailyAtmospherePanelProps {
  today: TodayNayin;
  almanac: AlmanacDay | null | undefined;
  loading?: boolean;
}

function ChipList({ items, tone }: { items: string[]; tone: "yi" | "ji" }) {
  const { shown, extra } = compactList(items, 5);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(item => (
        <span
          key={item}
          className="rounded-full border px-2 py-1 text-[11px] leading-none"
          style={{
            borderColor:
              tone === "yi"
                ? "var(--nayin-border)"
                : "oklch(0.55 0.04 35 / 18%)",
            background:
              tone === "yi" ? "var(--nayin-glow)" : "oklch(0.96 0.01 35 / 70%)",
            color:
              tone === "yi"
                ? "var(--nayin-accent-dim)"
                : "var(--muted-foreground)",
          }}
        >
          {item}
        </span>
      ))}
      {extra > 0 && (
        <span className="rounded-full border px-2 py-1 text-[11px] leading-none text-muted-foreground">
          +{extra}
        </span>
      )}
    </div>
  );
}

function SummaryPill({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-none text-muted-foreground"
      style={{
        borderColor: "var(--nayin-border)",
        background: "var(--nayin-glow)",
      }}
    >
      <span className="shrink-0 text-nayin">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

function GuidanceBlock({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-md bg-foreground/[0.025] p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <span className="text-nayin">{icon}</span>
        <span>{title}</span>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export default function DailyAtmospherePanel({
  today,
  almanac,
  loading = false,
}: DailyAtmospherePanelProps) {
  const [open, setOpen] = useState(false);
  const line = loading
    ? "今日气息正在路上，先从纳音和饮品开场。"
    : dailyAtmosphereLine(almanac);
  const hasDetails = hasAuthorityBackedDetails(almanac);
  const lunarLabel = formatLunarDate(today);
  const clothingAdvice = getDailyClothingAdvice(today);
  const activityAdvice = getDailyActivityAdvice(today, almanac);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="w-full max-w-3xl"
    >
      <div className="monitor-panel overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[0.03]"
            aria-label={open ? "收起今日气息" : "展开今日气息"}
          >
            <div
              className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center"
              style={{
                background: "var(--nayin-glow)",
                color: "var(--nayin-accent)",
              }}
            >
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  今日气息
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  {loading
                    ? "loading"
                    : statusLabel(almanac?.status ?? "unavailable")}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {line}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <SummaryPill icon={<CalendarDays className="h-3 w-3" />}>
                  {lunarLabel}
                </SummaryPill>
                <SummaryPill icon={<Shirt className="h-3 w-3" />}>
                  {clothingAdvice.short}
                </SummaryPill>
                <SummaryPill icon={<ListChecks className="h-3 w-3" />}>
                  {activityAdvice.short}
                </SummaryPill>
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div
            className="border-t px-4 py-4"
            style={{ borderColor: "var(--nayin-border)" }}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <GuidanceBlock
                icon={<CalendarCheck className="h-3.5 w-3.5" />}
                title="今日农历"
              >
                <div className="font-medium text-foreground">{lunarLabel}</div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px]">
                  <span>日柱 {today.ganzhi}</span>
                  <span>纳音 {today.nayinName}</span>
                  <span>五行 {today.theme.elementCn}</span>
                </div>
              </GuidanceBlock>

              <GuidanceBlock
                icon={<Shirt className="h-3.5 w-3.5" />}
                title="今天穿什么"
              >
                <div className="font-medium text-foreground">
                  {clothingAdvice.title}
                </div>
                <p className="mt-1">{clothingAdvice.detail}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {clothingAdvice.tags.map(tag => (
                    <span
                      key={tag}
                      className="rounded-full border px-2 py-1 text-[10px] leading-none"
                      style={{
                        borderColor: "var(--nayin-border)",
                        color: "var(--nayin-accent-dim)",
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </GuidanceBlock>

              <GuidanceBlock
                icon={<ListChecks className="h-3.5 w-3.5" />}
                title="适合做什么"
              >
                <div className="font-medium text-foreground">
                  {activityAdvice.title}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {activityAdvice.items.map(item => (
                    <span
                      key={item}
                      className="rounded-full border px-2 py-1 text-[10px] leading-none"
                      style={{
                        borderColor: "var(--nayin-border)",
                        background: "var(--nayin-glow)",
                        color: "var(--nayin-accent-dim)",
                      }}
                    >
                      {item}
                    </span>
                  ))}
                </div>
                <p className="mt-2">{activityAdvice.note}</p>
                <div className="mt-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/80">
                  {activityAdvice.sourceLabel}
                </div>
              </GuidanceBlock>
            </div>

            <div className="grid gap-4 md:grid-cols-[1.15fr_0.85fr]">
              <section className="mt-4">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <CalendarDays className="h-3.5 w-3.5 text-nayin" />
                  <span>黄历宜忌</span>
                </div>
                {hasDetails ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        宜
                      </div>
                      <ChipList items={almanac?.yi ?? []} tone="yi" />
                    </div>
                    <div>
                      <div className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        忌
                      </div>
                      <ChipList items={almanac?.ji ?? []} tone="ji" />
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    真实老黄历信息暂时不可用；本地纳音与农历仍可正常显示。
                  </p>
                )}
              </section>

              <section className="mt-4 space-y-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <Compass className="h-3.5 w-3.5 text-nayin" />
                    <span>方位</span>
                  </div>
                  {almanac?.directions.length ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {almanac.directions.map(item => (
                        <div
                          key={`${item.name}-${item.value}`}
                          className="rounded-md border px-2 py-2"
                          style={{ borderColor: "var(--nayin-border)" }}
                        >
                          <div className="text-[10px] text-muted-foreground">
                            {item.name}
                          </div>
                          <div className="mt-0.5 text-xs font-medium text-foreground">
                            {item.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      接口未返回方位字段。
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <Clock3 className="h-3.5 w-3.5 text-nayin" />
                    <span>吉时</span>
                  </div>
                  {almanac?.luckyHours.length ? (
                    <div className="mt-2 space-y-1.5">
                      {almanac.luckyHours.slice(0, 3).map(hour => (
                        <div
                          key={`${hour.label}-${hour.value}`}
                          className="text-xs text-muted-foreground"
                        >
                          <span className="font-medium text-foreground">
                            {hour.label}
                          </span>
                          <span className="mx-1 opacity-40">·</span>
                          {hour.value}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      接口未返回吉时字段。
                    </p>
                  )}
                </div>
              </section>
            </div>

            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>{lunarLabel}</span>
              <span>日柱 {today.ganzhi}</span>
              <span>纳音 {today.nayinName}</span>
              {almanac?.sourceLabel && <span>来源 {almanac.sourceLabel}</span>}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
