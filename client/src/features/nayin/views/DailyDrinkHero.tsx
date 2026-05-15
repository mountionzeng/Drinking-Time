import { motion } from 'framer-motion';
import type { TodayNayin } from '@/features/nayin/nayin';
import {
  formatTodayIdentity,
  getDailyDrinkPresentation,
} from '@/features/nayin/dailyPresentation';
import WuxingDrinkIcon from './WuxingDrinkIcon';

interface DailyDrinkHeroProps {
  today: TodayNayin;
}

const easing = [0.22, 1, 0.36, 1] as const;
const brandTitleFont = "'Honglei Zhuoshu', 'Noto Serif SC', 'Songti SC', serif";

export default function DailyDrinkHero({ today }: DailyDrinkHeroProps) {
  const presentation = getDailyDrinkPresentation(today.element);
  const [titleCn, titleEn] = presentation.title.split(' · ');

  return (
    <motion.section
      className="w-full max-w-3xl text-center flex flex-col items-center"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: easing }}
      aria-labelledby="daily-drink-title"
    >
      <div className="relative h-36 w-36 sm:h-44 sm:w-44 flex items-center justify-center">
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
          <WuxingDrinkIcon element={today.element} size={132} />
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
          className="font-normal leading-none text-[4rem] sm:text-[5rem]"
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
      <p className="mt-2 max-w-lg whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
        {presentation.subtitle}
      </p>
      <p className="mt-3 text-[11px] font-mono text-muted-foreground/80">
        {formatTodayIdentity(today)}
      </p>
    </motion.section>
  );
}
