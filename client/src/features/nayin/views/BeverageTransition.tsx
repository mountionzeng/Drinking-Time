/**
 * BeverageTransition — Full-screen beverage pour transition overlay
 *
 * When the user switches Nayin themes, a dramatic full-screen animation plays:
 * 1. A liquid "pour" fills the screen from top with the new beverage color
 * 2. The beverage emoji + name appear centered with a splash effect
 * 3. The liquid drains/fades revealing the new theme underneath
 *
 * Each beverage has a unique pour style:
 *   Beer: golden cascade with foam bubbles
 *   Longjing: gentle green waterfall with steam
 *   Coconut: creamy white splash
 *   Dahongpao: warm amber pour with ripples
 *   Coffee: dark espresso drip with crema swirl
 */
import { motion, AnimatePresence } from 'framer-motion';
import type { BeverageTheme, NayinElement } from '../nayin';
import WuxingDrinkIcon from './WuxingDrinkIcon';

interface BeverageTransitionProps {
  isActive: boolean;
  theme: BeverageTheme;
  onComplete: () => void;
}

// Unique pour descriptions for each beverage
const POUR_TEXT: Record<NayinElement, string> = {
  metal: '倒一杯金色灵感',
  wood: '沏一壶明前龙井',
  water: '开一颗新鲜椰子',
  fire: '冲一泡武夷岩茶',
  earth: '萃一杯浓缩咖啡',
};

// Number of splash particles per beverage
const SPLASH_COUNTS: Record<NayinElement, number> = {
  metal: 24,  // lots of bubbles
  wood: 10,   // gentle wisps
  water: 16,  // coconut splash
  fire: 12,   // warm ripples
  earth: 14,  // coffee drops
};

function SplashParticles({ theme }: { theme: BeverageTheme }) {
  const count = SPLASH_COUNTS[theme.element];
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const angle = (Math.PI * 2 * i) / count;
        const distance = 80 + Math.random() * 160;
        const size = theme.element === 'metal' ? 6 + Math.random() * 12 : 4 + Math.random() * 8;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;

        return (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: size,
              height: size,
              left: '50%',
              top: '50%',
              background: `${theme.hex}${theme.element === 'metal' ? 'cc' : 'aa'}`,
              boxShadow: `0 0 ${size}px ${theme.hex}60`,
            }}
            initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
            animate={{
              x: dx,
              y: dy,
              scale: [0, 1.5, 0.5],
              opacity: [0, 0.9, 0],
            }}
            transition={{
              duration: 0.8 + Math.random() * 0.4,
              delay: 0.6 + Math.random() * 0.2,
              ease: 'easeOut',
            }}
          />
        );
      })}
    </>
  );
}

function PourWave({ theme, index }: { theme: BeverageTheme; index: number }) {
  const isFirst = index === 0;
  return (
    <motion.div
      className="absolute inset-x-0"
      style={{
        height: '120%',
        background: isFirst
          ? `linear-gradient(180deg, ${theme.hex}00 0%, ${theme.hex}40 10%, ${theme.hex}cc 30%, ${theme.hex} 50%, ${theme.hexDim} 100%)`
          : `linear-gradient(180deg, ${theme.hex}00 0%, ${theme.hexDim}60 20%, ${theme.hexDim}90 50%, ${theme.hexDim} 100%)`,
        borderRadius: '0 0 50% 50%/0 0 40px 40px',
      }}
      initial={{ top: '-120%' }}
      animate={{ top: ['- 120%', '0%', '0%', '120%'] }}
      transition={{
        duration: 2.4,
        times: [0, 0.35, 0.65, 1],
        delay: index * 0.15,
        ease: [0.22, 1, 0.36, 1],
      }}
    />
  );
}

export default function BeverageTransition({ isActive, theme, onComplete }: BeverageTransitionProps) {
  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          className="fixed inset-0 z-[100] pointer-events-auto overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onAnimationComplete={() => {
            // Give time for the full animation before calling complete
          }}
        >
          {/* Pour waves */}
          <PourWave theme={theme} index={0} />
          <PourWave theme={theme} index={1} />

          {/* Center content: emoji + text */}
          <motion.div
            className="absolute inset-0 flex flex-col items-center justify-center z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 1, 0] }}
            transition={{ duration: 2.4, times: [0, 0.3, 0.7, 1] }}
            onAnimationComplete={onComplete}
          >
            {/* Glow ring behind emoji */}
            <motion.div
              className="absolute rounded-full"
              style={{
                width: 180,
                height: 180,
                background: `radial-gradient(circle, ${theme.hex}30 0%, transparent 70%)`,
              }}
              animate={{ scale: [0.5, 1.2, 1], opacity: [0, 0.8, 0.4] }}
              transition={{ duration: 1.5, delay: 0.3 }}
            />

            {/* Splash particles */}
            <SplashParticles theme={theme} />

            {/* Emoji */}
            <motion.div
              className="relative z-10 drop-shadow-2xl"
              initial={{ scale: 0, rotate: -30 }}
              animate={{
                scale: [0, 1.3, 1],
                rotate: [-30, 10, 0],
              }}
              transition={{
                duration: 0.7,
                delay: 0.4,
                ease: [0.34, 1.56, 0.64, 1],
              }}
            >
              <WuxingDrinkIcon element={theme.element} size={80} />
            </motion.div>

            {/* Beverage name */}
            <motion.div
              className="mt-4 text-center relative z-10"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.5 }}
            >
              <p
                className="text-2xl font-bold tracking-wide"
                style={{
                  color: theme.element === 'water' ? '#3a3530' : '#fff',
                  textShadow: `0 2px 20px ${theme.hexDim}80`,
                }}
              >
                {POUR_TEXT[theme.element]}
              </p>
              <motion.p
                className="text-sm font-mono mt-2 tracking-widest uppercase"
                style={{
                  color: theme.element === 'water' ? '#5a5550' : '#ffffff99',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1 }}
              >
                {theme.beverage} · {theme.elementCn}
              </motion.p>
            </motion.div>
          </motion.div>

          {/* Foam/froth top edge for beer */}
          {theme.element === 'metal' && (
            <motion.div
              className="absolute left-0 right-0 h-12 z-[5]"
              style={{
                background: 'linear-gradient(180deg, #f5e6c8 0%, #f5e6c860 40%, transparent 100%)',
                borderRadius: '0 0 50% 50%',
              }}
              initial={{ top: '-50px' }}
              animate={{ top: ['- 50px', '35%', '35%', '110%'] }}
              transition={{
                duration: 2.4,
                times: [0, 0.35, 0.65, 1],
                ease: [0.22, 1, 0.36, 1],
              }}
            />
          )}

          {/* Steam for tea types */}
          {(theme.element === 'wood' || theme.element === 'fire') && (
            <div className="absolute inset-0 z-[5] pointer-events-none">
              {Array.from({ length: 6 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="absolute"
                  style={{
                    width: 60 + Math.random() * 80,
                    height: 3,
                    left: `${15 + Math.random() * 70}%`,
                    top: '45%',
                    background: `${theme.hex}20`,
                    filter: 'blur(6px)',
                    borderRadius: '50%',
                  }}
                  animate={{
                    y: [0, -(40 + Math.random() * 80)],
                    opacity: [0, 0.6, 0],
                    scaleX: [1, 1.8],
                  }}
                  transition={{
                    duration: 2 + Math.random() * 2,
                    delay: 0.5 + Math.random() * 1,
                    ease: 'easeOut',
                  }}
                />
              ))}
            </div>
          )}

          {/* Coffee crema swirl */}
          {theme.element === 'earth' && (
            <motion.div
              className="absolute z-[5]"
              style={{
                width: 120,
                height: 120,
                left: 'calc(50% - 60px)',
                top: 'calc(50% - 60px)',
                borderRadius: '50%',
                border: `2px solid ${theme.hexBright}40`,
              }}
              animate={{ rotate: [0, 360], scale: [0, 1, 0.8] }}
              transition={{ duration: 2, delay: 0.5, ease: 'easeInOut' }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
