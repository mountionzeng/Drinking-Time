import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/** One quiet line for concurrent activity and context, without repeated live announcements. */
export function ChatCompanionStatus({ messages }: { messages: string[] }) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const items = [...new Set(messages.filter(Boolean))];
  const signature = JSON.stringify(items);
  useEffect(() => {
    setIndex(0);
  }, [signature]);
  useEffect(() => {
    if (items.length < 2 || paused || reducedMotion) return;
    const timer = window.setInterval(() => setIndex(value => (value + 1) % items.length), 4200);
    return () => window.clearInterval(timer);
  }, [signature, items.length, paused, reducedMotion]);
  const text = items[index % items.length] ?? "";
  return (
    <div
      data-book-composition-target
      className="desktop-companion-status min-w-0 flex-1 text-[11px] text-muted-foreground"
      title={items.join("\n")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="sr-only" role="status" aria-live="polite">{items.join("。")}</span>
      <div className="relative h-5 overflow-hidden" aria-hidden="true">
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={text}
            className="absolute inset-0 block truncate leading-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.22 }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
