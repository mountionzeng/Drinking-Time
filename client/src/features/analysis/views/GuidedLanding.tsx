/**
 * GuidedLanding — Entry page for new/empty projects.
 * Two cards: "upload materials" and "start a story chat".
 */
import { motion } from "framer-motion";
import { Upload, MessageCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNayin } from "@/features/nayin/NayinContext";
import { useDailyAlmanac } from "@/features/nayin/hooks/useDailyAlmanac";
import { hasAuthorityBackedDetails } from "@/features/nayin/almanac";
import DailyDrinkHero from "@/features/nayin/views/DailyDrinkHero";
import DailyAtmospherePanel from "@/features/nayin/views/DailyAtmospherePanel";
import EmotionAnalysisInvitePanel from "@/features/analysis/views/EmotionAnalysisInvitePanel";
import type { NayinElement } from "@/features/nayin/nayin";
import type {
  EmotionAnalysisProfile,
  SaveEmotionAnalysisProfileInput,
} from "@/features/analysis/emotionAnalysis";

const MATERIAL_COPY: Record<NayinElement, string> = {
  metal: "开一瓶冰啤，把参考图倒进来",
  wood: "泡一壶龙井，把素材摊开看看",
  water: "来杯椰汁，上传你的参考图和素材",
  fire: "大红袍泡好了，把素材丢进来",
  earth: "咖啡续上，素材准备好了就上传",
};

const STORY_COPY: Record<NayinElement, string> = {
  metal: "举杯碰一个，跟小酌聊聊灵感",
  wood: "端起茶杯，跟小酌说说你的故事",
  water: "椰汁配故事，跟小酌聊一段回忆",
  fire: "茶香里慢慢说，让小酌帮你找到那个画面",
  earth: "咖啡伴灵感，跟小酌讲讲你的想法",
};

interface GuidedLandingProps {
  onSelectMaterial: () => void;
  onSelectStory: () => void;
  /** 手机端：只显示「聊一个故事」入口，隐藏素材上传卡 */
  storyOnly?: boolean;
  emotionProfile?: EmotionAnalysisProfile | null;
  emotionProfileLoading?: boolean;
  onSaveEmotionProfile?: (
    input: SaveEmotionAnalysisProfileInput
  ) => Promise<EmotionAnalysisProfile | void>;
  authPanel?: ReactNode;
  authPanelFirst?: boolean;
  hideEntryCards?: boolean;
  accessLayout?: boolean;
}

const easing = [0.22, 1, 0.36, 1] as const;

export default function GuidedLanding({
  onSelectMaterial,
  onSelectStory,
  storyOnly = false,
  emotionProfile,
  emotionProfileLoading,
  onSaveEmotionProfile,
  authPanel,
  authPanelFirst = false,
  hideEntryCards = false,
  accessLayout = false,
}: GuidedLandingProps) {
  const { element, today } = useNayin();
  const almanacQuery = useDailyAlmanac(today.cstDateStr);
  const almanac = almanacQuery.data ?? null;
  const hasAlmanacDetails = hasAuthorityBackedDetails(almanac);
  const [emotionPreview, setEmotionPreview] =
    useState<EmotionAnalysisProfile | null>(null);
  const personalizedReference = emotionPreview?.dailyReference;

  if (accessLayout && authPanel) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col items-center gap-7 lg:gap-10">
          <motion.div
            className="flex w-full flex-col items-center justify-center"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: easing }}
            aria-label="今日标识"
          >
            <DailyDrinkHero today={today} compact />
          </motion.div>

          <div className="flex w-full max-w-5xl flex-col items-center gap-7">
            <motion.aside
              className="w-full min-w-0 overflow-hidden border-y"
              style={{ borderColor: "var(--nayin-border)" }}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.55, ease: easing }}
              aria-label="今日农历与登录说明"
            >
              {hasAlmanacDetails ? (
                <>
                  <DailyAtmospherePanel
                    today={today}
                    almanac={almanac}
                    loading={almanacQuery.isLoading}
                    embedded
                    compact
                    personalizedYi={personalizedReference?.personalizedYi}
                    personalizedJi={personalizedReference?.personalizedJi}
                  />
                  <div
                    className="border-t"
                    style={{ borderColor: "var(--nayin-border)" }}
                  />
                </>
              ) : null}
              <EmotionAnalysisInvitePanel
                today={today}
                almanac={almanac}
                profile={
                  emotionProfile?.source === "local" ? emotionProfile : null
                }
                profileLoading={
                  emotionProfileLoading || almanacQuery.isLoading
                }
                onSaveProfile={onSaveEmotionProfile}
                onPreviewChange={setEmotionPreview}
                embedded
                compactEntry
                persistLocalProfile
                guestMode
              />
            </motion.aside>

            <motion.section
              className="flex w-full justify-center pb-6"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, duration: 0.55, ease: easing }}
              aria-label="登录"
            >
              <div className="flex w-full max-w-[336px] justify-center">
                {authPanel}
              </div>
            </motion.section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10">
      <div
        className={`mx-auto flex min-h-full w-full max-w-4xl flex-col items-center gap-5 ${hideEntryCards ? "justify-start" : "justify-center"}`}
      >
        <DailyDrinkHero today={today} />

        {authPanel && authPanelFirst ? (
          <motion.div
            className="w-full flex justify-center"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.5, ease: easing }}
          >
            {authPanel}
          </motion.div>
        ) : null}

        {!hideEntryCards ? (
          <motion.div
            className={`flex w-full flex-col gap-4 ${storyOnly ? "max-w-md" : "max-w-2xl sm:flex-row"}`}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: easing }}
          >
            {/* Upload materials card */}
            {!storyOnly && (
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
                      background: "var(--nayin-glow)",
                      boxShadow: "0 4px 20px -6px var(--nayin-glow)",
                    }}
                  >
                    <Upload
                      className="w-6 h-6"
                      style={{ color: "var(--nayin-accent)" }}
                    />
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
            )}

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
                    background: "var(--nayin-glow)",
                    boxShadow: "0 4px 20px -6px var(--nayin-glow)",
                  }}
                >
                  <MessageCircle
                    className="w-6 h-6"
                    style={{ color: "var(--nayin-accent)" }}
                  />
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
        ) : null}

        {authPanel && !authPanelFirst ? (
          <motion.div
            className="w-full flex justify-center"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.26, duration: 0.5, ease: easing }}
          >
            {authPanel}
          </motion.div>
        ) : null}

        <motion.section
          className="w-full max-w-3xl monitor-panel overflow-hidden"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5, ease: easing }}
          aria-label="今日参考"
        >
          <DailyAtmospherePanel
            today={today}
            almanac={almanac}
            loading={almanacQuery.isLoading}
            embedded
            personalizedYi={personalizedReference?.personalizedYi}
            personalizedJi={personalizedReference?.personalizedJi}
          />
          <div
            className="border-t"
            style={{ borderColor: "var(--nayin-border)" }}
          />
          <EmotionAnalysisInvitePanel
            today={today}
            almanac={almanac}
            profile={emotionProfile}
            profileLoading={emotionProfileLoading}
            onSaveProfile={onSaveEmotionProfile}
            embedded
            onPreviewChange={setEmotionPreview}
          />
        </motion.section>

        {!hideEntryCards ? (
          <motion.p
            className="text-xs text-muted-foreground/70 mt-6 text-center max-w-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          >
            {storyOnly
              ? "跟小酌聊一段，画面会慢慢长出来"
              : "两条路径最终都会汇聚到镜头表，你也可以两个都用"}
          </motion.p>
        ) : null}
      </div>
    </div>
  );
}
