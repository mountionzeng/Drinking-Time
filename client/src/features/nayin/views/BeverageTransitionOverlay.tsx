/**
 * BeverageTransitionOverlay — Connects NayinContext transition state
 * to the BeverageTransition animation component.
 * Mounted once in App.tsx at the global level.
 */
import { useNayin } from '../NayinContext';
import BeverageTransition from './BeverageTransition';

export default function BeverageTransitionOverlay() {
  const { isTransitioning, transitionTheme, onTransitionComplete } = useNayin();

  if (!transitionTheme) return null;

  return (
    <BeverageTransition
      isActive={isTransitioning}
      theme={transitionTheme}
      onComplete={onTransitionComplete}
    />
  );
}
