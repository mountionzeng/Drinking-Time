/**
 * WuxingParticles — Ambient floating particles themed to the current element.
 */
import { useMemo } from 'react';
import { useNayin } from '../NayinContext';

const PARTICLE_COUNT = 18;

export default function WuxingParticles() {
  const { element } = useNayin();

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: `${(Math.random() * 12).toFixed(1)}s`,
        duration: `${(8 + Math.random() * 10).toFixed(1)}s`,
      })),
    [element],
  );

  return (
    <div className="wx-particles" data-element={element}>
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            left: p.left,
            animationDuration: p.duration,
            animationDelay: p.delay,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
