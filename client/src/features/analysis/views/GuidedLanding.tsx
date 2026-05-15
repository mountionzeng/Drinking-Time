/**
 * GuidedLanding — Entry page for new/empty projects.
 * Two cards: "upload materials" and "start a story chat".
 */
import { motion } from 'framer-motion';
import { Upload, MessageCircle } from 'lucide-react';
import { useNayin } from '@/features/nayin/NayinContext';
import { useDailyAlmanac } from '@/features/nayin/hooks/useDailyAlmanac';
import DailyDrinkHero from '@/features/nayin/views/DailyDrinkHero';
import DailyAtmospherePanel from '@/features/nayin/views/DailyAtmospherePanel';
import type { NayinElement } from '@/features/nayin/nayin';

const MATERIAL_COPY: Record<NayinElement, string> = {
  metal: '开一瓶冰啤，把参考图倒进来',
  wood: '泡一壶龙井，把素材摊开看看',
  water: '来杯椰汁，上传你的参考图和素材',
  fire: '大红袍泡好了，把素材丢进来',
  earth: '咖啡续上，素材准备好了就上传',
};

const STORY_COPY: Record<NayinElement, string> = {
  metal: '举杯碰一个，跟小酌聊聊灵感',
  wood: '端起茶杯，跟小酌说说你的故事',
  water: '椰汁配故事，跟小酌聊一段回忆',
  fire: '茶香里慢慢说，让小酌帮你找到那个画面',
  earth: '咖啡伴灵感，跟小酌讲讲你的想法',
};

interface GuidedLandingProps {
  onSelectMaterial: () => void;
  onSelectStory: () => void;
}

const easing = [0.22, 1, 0.36, 1] as const;

export default function GuidedLanding({
  onSelectMaterial,
  onSelectStory,
}: GuidedLandingProps) {
  const { element, today } = useNayin();
  const almanacQuery = useDailyAlmanac(today.cstDateStr);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col items-center justify-center gap-5">
        <DailyDrinkHero today={today} />

      <motion.div
        className="flex w-full max-w-2xl flex-col gap-4 sm:flex-row"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: easing }}
      >
        {/* Upload materials card */}
        <motion.button
          type="button"
          onClick={onSelectMaterial}
          className="flex-1 monitor-panel group relative overflow-hidden"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease: easing }}
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex min-h-44 flex-col items-center justify-center gap-4 p-7 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{
                background: 'var(--nayin-glow)',
                boxShadow: '0 4px 20px -6px var(--nayin-glow)',
              }}
            >
              <Upload className="w-6 h-6" style={{ color: 'var(--nayin-accent)' }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">
                上传素材开始
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {MATERIAL_COPY[element]}
              </p>
            </div>
          </div>
        </motion.button>

        {/* Story chat card */}
        <motion.button
          type="button"
          onClick={onSelectStory}
          className="flex-1 monitor-panel group relative overflow-hidden"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5, ease: easing }}
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex min-h-44 flex-col items-center justify-center gap-4 p-7 text-center">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{
                background: 'var(--nayin-glow)',
                boxShadow: '0 4px 20px -6px var(--nayin-glow)',
              }}
            >
              <MessageCircle className="w-6 h-6" style={{ color: 'var(--nayin-accent)' }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">
                聊一个故事开始
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {STORY_COPY[element]}
              </p>
            </div>
          </div>
        </motion.button>
      </motion.div>

        <motion.div
          className="w-full flex justify-center"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5, ease: easing }}
        >
          <DailyAtmospherePanel
            today={today}
            almanac={almanacQuery.data ?? null}
            loading={almanacQuery.isLoading}
          />
        </motion.div>

      <motion.p
        className="text-xs text-muted-foreground/70 mt-6 text-center max-w-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        两条路径最终都会汇聚到镜头表，你也可以两个都用
      </motion.p>
      </div>
    </div>
  );
}
