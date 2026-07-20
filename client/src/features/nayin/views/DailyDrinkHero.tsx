import { motion } from 'framer-motion';
import type { TodayNayin } from '@/features/nayin/nayin';
import {
  formatTodayIdentity,
  getDailyDrinkPresentation,
} from '@/features/nayin/dailyPresentation';
import WuxingDrinkIcon from './WuxingDrinkIcon';

interface DailyDrinkHeroProps {
  today: TodayNayin;
  compact?: boolean;
}

const easing = [0.22, 1, 0.36, 1] as const;
const brandTitleFont = "'Honglei Zhuoshu', 'Noto Serif SC', 'Songti SC', serif";

export default function DailyDrinkHero({
  today,
  compact = false,
}: DailyDrinkHeroProps) {
  const presentation = getDailyDrinkPresentation(today.element);
  const [titleCn, titleEn] = presentation.title.split(' · ');
  const subtitleLines = presentation.subtitle
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <motion.section
      className={`w-full text-center flex flex-col items-center ${
        compact ? 'max-w-xl' : 'max-w-3xl'
      }`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: easing }}
      aria-labelledby="daily-drink-title"
    >
      <div
        className={`relative flex items-center justify-center ${
          compact ? 'h-24 w-24 sm:h-28 sm:w-28' : 'h-36 w-36 sm:h-44 sm:w-44'
        }`}
      >
        <motion.div
          className="absolute inset-2 rounded-full"
          style={{
            background: 'radial-gradient(circle, var(--nayin-glow) 0%, transparent 68%)',
          }}
          animate={{ scale: [1, 1.05, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute inset-0 rounded-full border"
          style={{ borderColor: 'var(--nayin-border)' }}
          animate={{ rotate: [0, 2, -2, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="relative"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 3.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          <WuxingDrinkIcon element={today.element} size={compact ? 88 : 132} />
        </motion.div>
      </div>

      <h1
        id="daily-drink-title"
        className="mt-3 flex flex-col items-center text-foreground"
        aria-label={presentation.title}
        style={{ fontFamily: brandTitleFont, letterSpacing: 0 }}
      >
        <span
          aria-hidden="true"
          className={`font-normal leading-none ${
            compact ? 'text-[3.4rem] sm:text-[4rem]' : 'text-[4rem] sm:text-[5rem]'
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
              initial={{ opacity: 0, y: 8, filter: 'blur(3px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
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
      <p className="mt-3 text-[11px] font-mono text-muted-foreground/80">
        {formatTodayIdentity(today)}
      </p>
    </motion.section>
  );
}
