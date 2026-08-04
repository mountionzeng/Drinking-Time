import { motion } from "framer-motion";
import type { TodayNayin } from "@/features/nayin/nayin";
import {
  formatTodayIdentity,
  getDailyDrinkPresentation,
} from "@/features/nayin/dailyPresentation";
import WuxingDrinkIcon from "./WuxingDrinkIcon";
import { WuxingPourTrigger, WUXING_POUR_VERB } from "./WuxingPourReveal";

interface DailyDrinkHeroProps {
  today: TodayNayin;
  compact?: boolean;
  /** 登录页：杯子本身是「倒出来看看」的开关，此时图标放大且可点。 */
  pour?: {
    open: boolean;
    onToggle: () => void;
    contentId: string;
  };
}

const easing = [0.22, 1, 0.36, 1] as const;
const brandTitleFont = "'Honglei Zhuoshu', 'Noto Serif SC', 'Songti SC', serif";

export default function DailyDrinkHero({
  today,
  compact = false,
  pour,
}: DailyDrinkHeroProps) {
  const presentation = getDailyDrinkPresentation(today.element);
  const [titleCn, titleEn] = presentation.title.split(" · ");
  const subtitleLines = presentation.subtitle
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  return (
    <motion.section
      className={`w-full text-center flex flex-col items-center ${
        compact ? "max-w-xl" : "max-w-3xl"
      }`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: easing }}
      aria-labelledby="daily-drink-title"
    >
      <div
        className={`relative flex items-center justify-center ${
          pour
            ? "h-96 w-96 -mb-14"
            : compact
              ? "h-24 w-24 sm:h-28 sm:w-28"
              : "h-36 w-36 sm:h-44 sm:w-44"
        }`}
      >
        {/* 品牌字沿圆环外侧走弧线：聊会儿在左上，Drinking Time 在右上。
            锚在圆的几何上，所以换任何一个饮品 logo，字都停在同一个位置。 */}
        {pour ? (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 384 384"
            aria-hidden="true"
          >
            <defs>
              {/* 半径远大于 logo 圆，只取顶上很浅的一段：
                  字跟着圆的走势弯，但不会被切线带成立起来。 */}
              <path
                id="brand-arc"
                d="M 30,96 a 340,340 0 0 1 324,0"
                fill="none"
              />
              {/* 环底那道缺口，动词就嵌在这里；沿圆走但朝上，字不会倒过来 */}
              <path
                id="verb-arc"
                d="M 137.5,294.4 A 116,116 0 0 0 246.5,294.4"
                fill="none"
              />
            </defs>

            {/* 圆环本身：底部断开一段留给动词 */}
            <motion.path
              d="M 137.5,294.4 A 116,116 0 1 1 246.5,294.4"
              fill="none"
              stroke="var(--nayin-border)"
              strokeWidth="1.4"
              strokeLinecap="round"
              style={{ transformOrigin: "192px 192px" }}
              animate={pour.open ? { rotate: 0 } : { rotate: [0, 2, -2, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* 动词：嵌在环口里，颜色跟着五行走 */}
            <text
              fill="var(--nayin-accent)"
              style={{ letterSpacing: "0.08em" }}
              fontSize="18"
              fontWeight="500"
            >
              <textPath href="#verb-arc" startOffset="50%" textAnchor="middle">
                {pour.open ? "收起来" : WUXING_POUR_VERB[today.element]}
              </textPath>
            </text>
            {/* 点开时品牌字跟着弹一下：像被杯子的动作带了一把 */}
            <motion.g
              style={{
                transformOrigin: "192px 170px",
                willChange: "transform",
              }}
              animate={{
                y: pour.open ? -9 : 0,
                rotate: pour.open ? -2.5 : 0,
                scale: pour.open ? 1.04 : 1,
              }}
              transition={{ type: "spring", stiffness: 260, damping: 13 }}
            >
              <text
                fill="currentColor"
                className="text-foreground"
                style={{ fontFamily: brandTitleFont, letterSpacing: 0 }}
                fontSize="46"
              >
                <textPath
                  href="#brand-arc"
                  startOffset="28%"
                  textAnchor="middle"
                >
                  聊会儿
                </textPath>
              </text>
              <text
                fill="currentColor"
                className="text-muted-foreground"
                style={{ fontFamily: brandTitleFont }}
                fontSize="16"
              >
                <textPath
                  href="#brand-arc"
                  startOffset="73%"
                  textAnchor="middle"
                >
                  Drinking Time
                </textPath>
              </text>
            </motion.g>
          </svg>
        ) : null}
        <motion.div
          className={`absolute rounded-full ${pour ? "inset-[76px]" : "inset-2"}`}
          style={{
            background:
              "radial-gradient(circle, var(--nayin-glow) 0%, transparent 68%)",
          }}
          animate={
            pour?.open
              ? { scale: 1, opacity: 0.9 }
              : { scale: [1, 1.05, 1], opacity: [0.7, 1, 0.7] }
          }
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
        />
        {pour ? null : (
          <motion.div
            className="absolute inset-0 rounded-full border"
            style={{ borderColor: "var(--nayin-border)" }}
            animate={{ rotate: [0, 2, -2, 0] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <motion.div
          className="relative"
          style={{ willChange: "transform" }}
          animate={{ y: pour?.open ? 0 : [0, -4, 0] }}
          transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}
        >
          {pour ? (
            <WuxingPourTrigger
              element={today.element}
              open={pour.open}
              onToggle={pour.onToggle}
              contentId={pour.contentId}
              size={156}
            />
          ) : (
            <WuxingDrinkIcon
              element={today.element}
              size={compact ? 88 : 132}
            />
          )}
        </motion.div>
      </div>

      {pour ? (
        // 品牌字已经画在上面的弧线里，这里只留一份给读屏和搜索引擎。
        <h1 id="daily-drink-title" className="sr-only">
          {presentation.title}
        </h1>
      ) : (
        <h1
          id="daily-drink-title"
          className="mt-3 flex flex-col items-center text-foreground"
          aria-label={presentation.title}
          style={{ fontFamily: brandTitleFont, letterSpacing: 0 }}
        >
          <span
            aria-hidden="true"
            className={`font-normal leading-none ${
              compact
                ? "text-[3.4rem] sm:text-[4rem]"
                : "text-[4rem] sm:text-[5rem]"
            }`}
          >
            {titleCn}
          </span>
          {titleEn ? (
            <span
              aria-hidden="true"
              className="-mt-1 text-sm font-normal leading-none text-muted-foreground sm:text-base"
            >
              {titleEn}
            </span>
          ) : null}
        </h1>
      )}
      {subtitleLines.length > 0 ? (
        <div
          className="mt-2 flex max-w-xl flex-col items-center gap-1 text-sm leading-relaxed text-muted-foreground sm:text-[15px]"
          aria-label={presentation.subtitle}
        >
          {subtitleLines.map((line, index) => (
            <motion.p
              key={`${line}-${index}`}
              aria-hidden="true"
              className="text-balance"
              initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{
                delay: 0.28 + index * 0.38,
                duration: 0.48,
                ease: easing,
              }}
            >
              {line}
            </motion.p>
          ))}
        </div>
      ) : null}
      {/* pour 模式下这行挪到了下方那条横线里（见 GuidedLanding 的今日横线） */}
      {pour ? null : (
        <p className="mt-3 text-[11px] font-mono text-muted-foreground/80">
          {formatTodayIdentity(today)}
        </p>
      )}
    </motion.section>
  );
}
