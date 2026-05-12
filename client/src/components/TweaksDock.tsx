import { useEffect } from 'react';

interface TweaksDockProps {
  autoCycle: boolean;
  onAutoCycleChange: (next: boolean) => void;
  illustrationSize: number;
  onIllustrationSizeChange: (next: number) => void;
  jitter: number;
  onJitterChange: (next: number) => void;
  grain: number;
  onGrainChange: (next: number) => void;
}

export default function TweaksDock({
  autoCycle,
  onAutoCycleChange,
  illustrationSize,
  onIllustrationSizeChange,
  jitter,
  onJitterChange,
  grain,
  onGrainChange,
}: TweaksDockProps) {
  useEffect(() => {
    document.documentElement.style.setProperty('--workshop-grain-opacity', String(grain));
  }, [grain]);

  useEffect(() => {
    document.documentElement.style.setProperty('--workshop-jitter-rotate', `${jitter}deg`);
  }, [jitter]);

  return (
    <aside className="workshop-tweaks hidden xl:block">
      <h4>TWEAKS</h4>
      <div className="row">
        <label>Auto-cycle stages</label>
        <input
          type="checkbox"
          checked={autoCycle}
          onChange={(e) => onAutoCycleChange(e.target.checked)}
        />
      </div>
      <div className="row">
        <label>Jitter amount</label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={jitter}
          onChange={(e) => onJitterChange(Number(e.target.value))}
        />
      </div>
      <div className="row">
        <label>Illustration size</label>
        <input
          type="range"
          min="70"
          max="110"
          step="2"
          value={illustrationSize}
          onChange={(e) => onIllustrationSizeChange(Number(e.target.value))}
        />
      </div>
      <div className="row">
        <label>Paper grain</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={grain}
          onChange={(e) => onGrainChange(Number(e.target.value))}
        />
      </div>
    </aside>
  );
}
