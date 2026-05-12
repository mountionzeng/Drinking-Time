import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ProfileRailDrawerProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  shotsCount: number;
  projectsCount: number;
  onTimeRate: number;
}

export default function ProfileRailDrawer({
  open,
  onOpen,
  onClose,
  shotsCount,
  projectsCount,
  onTimeRate,
}: ProfileRailDrawerProps) {
  return (
    <>
      <button type="button" className="workshop-profile-rail" onClick={onOpen} title="Profile">
        <span className="workshop-profile-rail-ava">林</span>
        PROFILE
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-foreground/18 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <motion.aside
              className="workshop-profile-drawer z-50"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="workshop-profile-head">
                <div className="workshop-profile-ava-lg">林</div>
                <div className="min-w-0 flex-1">
                  <div className="workshop-profile-name">林知遥</div>
                  <div className="workshop-profile-handle">@LIN.ZHIYAO · CREW·07</div>
                  <div className="workshop-profile-role">DIRECTOR · 主理人</div>
                </div>
                <button type="button" className="workshop-profile-close" onClick={onClose} aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <section className="workshop-profile-section">
                <h5>QUARTER · 本季产出</h5>
                <div className="workshop-profile-stats">
                  <div className="workshop-profile-stat">
                    <div className="v">{shotsCount}</div>
                    <div className="l">SHOTS</div>
                  </div>
                  <div className="workshop-profile-stat">
                    <div className="v">{projectsCount}</div>
                    <div className="l">PROJECTS</div>
                  </div>
                  <div className="workshop-profile-stat">
                    <div className="v">{onTimeRate}%</div>
                    <div className="l">ON·TIME</div>
                  </div>
                </div>
              </section>

              <section className="workshop-profile-section">
                <h5>PROFILE · 档案</h5>
                <div className="workshop-profile-list">
                  <div className="workshop-profile-row"><span className="pf-k">STUDIO</span><span className="pf-v">Drinking Time Studio</span></div>
                  <div className="workshop-profile-row"><span className="pf-k">BASE</span><span className="pf-v">上海 · SHANGHAI</span></div>
                  <div className="workshop-profile-row"><span className="pf-k">JOINED</span><span className="pf-v">2024 · 春</span></div>
                  <div className="workshop-profile-row"><span className="pf-k">PLAN</span><span className="pf-v acc">STUDIO · PRO</span></div>
                  <div className="workshop-profile-row"><span className="pf-k">CREDITS</span><span className="pf-v">428 / 1000</span></div>
                </div>
              </section>

              <section className="workshop-profile-section">
                <h5>PREFERENCES · 偏好</h5>
                <div className="workshop-profile-list">
                  <div className="workshop-profile-row"><span className="pf-k">LANG</span><span className="pf-v">中文 / EN</span></div>
                  <div className="workshop-profile-row"><span className="pf-k">UNITS</span><span className="pf-v">METRIC · MM</span></div>
                  <div className="workshop-profile-row"><span className="pf-k">PAPER</span><span className="pf-v">RICE · 米色</span></div>
                  <div className="workshop-profile-row"><span className="pf-k">NOTIFY</span><span className="pf-v">每日 · 19:00</span></div>
                </div>
              </section>

              <div className="workshop-profile-actions">
                <button type="button" className="workshop-profile-btn">⌘ ACCOUNT SETTINGS</button>
                <button type="button" className="workshop-profile-btn">↗ BILLING · 发票</button>
                <button type="button" className="workshop-profile-btn">☼ THEME · 主题</button>
                <button type="button" className="workshop-profile-btn signout">⤴ SIGN OUT</button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
