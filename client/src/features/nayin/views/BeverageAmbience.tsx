/**
 * BeverageAmbience — Full-page ambient background layer
 * Renders a beverage-themed background image with CSS particle animations
 * that match the current Nayin Five Element theme.
 *
 * metal/Beer: golden bubbles rising
 * wood/Longjing: drifting tea steam wisps
 * water/Coconut: gentle floating palm shadows
 * fire/Dahongpao: warm ripple glow
 * earth/Coffee: swirling latte art particles
 */
import { useNayin } from '../NayinContext';
import { motion, AnimatePresence } from 'framer-motion';
import type { NayinElement } from '../nayin';

const BG_IMAGES: Record<NayinElement, string> = {
  metal: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663478872384/HmkJEiCufuvwJRb4Xr9WPX/bg-beer-bubbles-dzwAao3vHcYXGbXmzExAYL.webp',
  wood: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663478872384/HmkJEiCufuvwJRb4Xr9WPX/bg-longjing-steam-UL3fVUyu4yPorELChZ3xwm.webp',
  water: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663478872384/HmkJEiCufuvwJRb4Xr9WPX/bg-coconut-tropical-bwnmhcYqq3TFQgLjXLT4Th.webp',
  fire: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663478872384/HmkJEiCufuvwJRb4Xr9WPX/bg-dahongpao-waves-UFkixqk2khtzYULNEKMB2y.webp',
  earth: 'https://d2xsxph8kpxj0f.cloudfront.net/310519663478872384/HmkJEiCufuvwJRb4Xr9WPX/bg-coffee-latte-art-7Pij5RYqvwBBGu3GaXA9ue.webp',
};

// Beverage-themed greeting messages
const GREETINGS: Record<NayinElement, { title: string; subtitle: string }> = {
  metal: {
    title: '',
    subtitle: '',
  },
  wood: {
    title: '茶已泡好，请慢用',
    subtitle: '龙井清香中，灵感自然来',
  },
  water: {
    title: '椰风海韵，轻松创作',
    subtitle: '来杯椰汁，享受热带般的创作时光',
  },
  fire: {
    title: '大红袍暖身，创意升温',
    subtitle: '岩茶醇厚，灵感如火',
  },
  earth: {
    title: '咖啡续命，灵感不断',
    subtitle: '一杯拿铁，开启高效模式',
  },
};

// Floating particle configs per element
function BubbleParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 20 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 4 + Math.random() * 8,
            height: 4 + Math.random() * 8,
            left: `${5 + Math.random() * 90}%`,
            bottom: `-${10 + Math.random() * 20}px`,
            background: `oklch(0.75 0.14 80 / ${0.22 + Math.random() * 0.30})`,
          }}
          animate={{
            y: [0, -(200 + Math.random() * 400)],
            x: [0, (Math.random() - 0.5) * 40],
            opacity: [0.6, 0],
          }}
          transition={{
            duration: 4 + Math.random() * 6,
            repeat: Infinity,
            delay: Math.random() * 8,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
}

function SteamWisps() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 60 + Math.random() * 100,
            height: 2 + Math.random() * 3,
            left: `${10 + Math.random() * 80}%`,
            bottom: `${20 + Math.random() * 40}%`,
            background: `oklch(0.62 0.12 155 / ${0.07 + Math.random() * 0.12})`,
            filter: 'blur(8px)',
          }}
          animate={{
            y: [0, -(30 + Math.random() * 60)],
            x: [0, (Math.random() - 0.5) * 80],
            opacity: [0.5, 0],
            scaleX: [1, 1.5],
          }}
          transition={{
            duration: 6 + Math.random() * 8,
            repeat: Infinity,
            delay: Math.random() * 10,
            ease: 'easeOut',
          }}
        />
      ))}
    </div>
  );
}

function PalmShadows() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 6 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{
            width: 120 + Math.random() * 80,
            height: 3,
            left: `${Math.random() * 100}%`,
            top: `${10 + Math.random() * 80}%`,
            background: `oklch(0.85 0.04 80 / ${0.05 + Math.random() * 0.10})`,
            borderRadius: '50%',
            filter: 'blur(6px)',
            transform: `rotate(${-20 + Math.random() * 40}deg)`,
          }}
          animate={{
            x: [0, (Math.random() - 0.5) * 30],
            opacity: [0.4, 0.7, 0.4],
          }}
          transition={{
            duration: 8 + Math.random() * 6,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

function RippleGlow() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 4 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 200 + Math.random() * 200,
            height: 200 + Math.random() * 200,
            left: `${20 + Math.random() * 60}%`,
            top: `${20 + Math.random() * 60}%`,
            background: `radial-gradient(circle, oklch(0.58 0.16 30 / ${0.06 + Math.random() * 0.10}) 0%, transparent 70%)`,
            transform: 'translate(-50%, -50%)',
          }}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.5, 0.8, 0.5],
          }}
          transition={{
            duration: 5 + Math.random() * 4,
            repeat: Infinity,
            delay: Math.random() * 3,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

function LatteSwirl() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 10 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 6 + Math.random() * 10,
            height: 6 + Math.random() * 10,
            left: `${10 + Math.random() * 80}%`,
            top: `${10 + Math.random() * 80}%`,
            background: `oklch(0.52 0.08 55 / ${0.15 + Math.random() * 0.22})`,
          }}
          animate={{
            rotate: [0, 360],
            x: [0, (Math.random() - 0.5) * 60],
            y: [0, (Math.random() - 0.5) * 60],
            opacity: [0.4, 0.7, 0.4],
          }}
          transition={{
            duration: 10 + Math.random() * 8,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
}

const PARTICLE_MAP: Record<NayinElement, React.FC> = {
  metal: BubbleParticles,
  wood: SteamWisps,
  water: PalmShadows,
  fire: RippleGlow,
  earth: LatteSwirl,
};

export function BeverageAmbience() {
  const { element } = useNayin();
  const Particles = PARTICLE_MAP[element];

  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <AnimatePresence mode="wait">
        <motion.div
          key={element}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
        >
          {/* Background image with light cream overlay */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${BG_IMAGES[element]})`, opacity: 0.28 }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(180deg, var(--nayin-surface, oklch(0.975 0.008 75)) 0%, oklch(from var(--nayin-surface, oklch(0.975 0.008 75)) l c h / 85%) 50%, oklch(from var(--nayin-surface, oklch(0.975 0.008 75)) l c h / 92%) 100%)',
            }}
          />
          {/* Particles */}
          <Particles />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export { GREETINGS };
export default BeverageAmbience;
