import * as React from 'react';

export type ShotStage =
  | 'idea_pool'
  | 'requirement_pool'
  | 'structured'
  | 'production_ready'
  | 'queued'
  | 'rendered'
  | 'blocked';

export interface ShotStageIllustrationProps {
  stage: ShotStage;
  size?: number;
  accentColor?: string;
  animated?: boolean;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}

export const STAGE_ACCENT: Record<ShotStage, string> = {
  idea_pool: 'oklch(0.62 0.090 68)',
  requirement_pool: 'oklch(0.58 0.080 150)',
  structured: 'oklch(0.48 0.090 255)',
  production_ready: 'oklch(0.58 0.110 35)',
  queued: 'oklch(0.68 0.095 85)',
  rendered: 'oklch(0.60 0.070 195)',
  blocked: 'oklch(0.50 0.015 30)',
};

export const STAGE_LABEL: Record<ShotStage, string> = {
  idea_pool: 'Idea Pool',
  requirement_pool: 'Requirement Pool',
  structured: 'Structured',
  production_ready: 'Production Ready',
  queued: 'Queued',
  rendered: 'Rendered',
  blocked: 'Blocked',
};

export const ShotStageIllustration: React.FC<ShotStageIllustrationProps> = ({
  stage,
  size = 180,
  accentColor,
  animated = true,
  className,
  title,
  style,
}) => {
  const accent = accentColor ?? STAGE_ACCENT[stage];
  const label = title ?? STAGE_LABEL[stage];

  const cssVars: React.CSSProperties = {
    ['--ink' as any]: 'var(--ink, oklch(0.26 0.012 45))',
    ['--ink-soft' as any]: 'var(--ink-soft, oklch(0.42 0.014 50))',
    ['--paper' as any]: 'var(--paper, oklch(0.965 0.012 78))',
    ['--accent' as any]: accent,
    width: size,
    height: size,
    overflow: 'visible',
    ...style,
  };

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 220 220"
      className={`shot-stage-illus shot-stage--${stage}${animated ? '' : ' is-static'} ${className ?? ''}`}
      style={cssVars}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{label}</title>
      {renderStage(stage, animated)}
    </svg>
  );
};

function renderStage(stage: ShotStage, animated: boolean): React.ReactNode {
  switch (stage) {
    case 'idea_pool':
      return <IdeaPool animated={animated} />;
    case 'requirement_pool':
      return <RequirementPool animated={animated} />;
    case 'structured':
      return <Structured animated={animated} />;
    case 'production_ready':
      return <ProductionReady animated={animated} />;
    case 'queued':
      return <Queued animated={animated} />;
    case 'rendered':
      return <Rendered animated={animated} />;
    case 'blocked':
      return <Blocked animated={animated} />;
  }
}

const Ink: React.FC<React.SVGProps<SVGPathElement>> = (p) => (
  <path
    fill="none"
    stroke="var(--ink)"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  />
);

const Hair: React.FC<React.SVGProps<SVGPathElement>> = (p) => (
  <path
    fill="none"
    stroke="var(--ink-soft)"
    strokeWidth={0.7}
    strokeLinecap="round"
    {...p}
  />
);

const Accent: React.FC<React.SVGProps<SVGPathElement>> = (p) => (
  <path
    fill="none"
    stroke="var(--accent)"
    strokeWidth={1.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...p}
  />
);

const Wash: React.FC<React.SVGProps<SVGPathElement>> = (p) => (
  <path fill="var(--accent)" fillOpacity={0.18} stroke="none" {...p} />
);

const drawOn = (len: number, delay = 0): React.CSSProperties => ({
  strokeDasharray: len,
  strokeDashoffset: len,
  animation: `shotStagePenDraw 1.6s cubic-bezier(.7,0,.2,1) ${delay}s forwards`,
});

const IdeaPool: React.FC<{ animated: boolean }> = ({ animated }) => (
  <g>
    <Wash d="M74,108 Q110,102 146,108 L140,170 Q110,175 80,170 Z" />
    <Accent style={drawOn(100)} d="M74,108 Q90,104 110,108 T146,108" />
    <Ink style={drawOn(260)} d="M70,48 L70,60 Q70,65 74,70 L74,170 Q74,180 84,182 L136,182 Q146,180 146,170 L146,70 Q150,65 150,60 L150,48" />
    <Hair d="M74,90 L82,90 M74,110 L82,110 M74,130 L82,130 M74,150 L82,150" />
    <Ink d="M66,48 L154,48" />

    {animated && (
      <>
        <Bubble cx={96} r={3} dur={3.2} delay={0} />
        <Bubble cx={118} r={2} dur={2.4} delay={0.5} />
        <Bubble cx={108} r={2.4} dur={3.8} delay={1} />
        <Bubble cx={128} r={1.6} dur={2.9} delay={1.3} />
      </>
    )}

    <g transform="translate(144,60) rotate(8)">
      <Hair d="M0,0 L36,0 L36,16 L0,16 Z" />
      <Hair d="M0,0 L-4,-4" />
      <text x="18" y="11" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="7.5" fill="var(--ink-soft)">LOT · 001</text>
    </g>

    <g opacity={0.55}>
      <Hair d="M82,176 L94,182" />
      <Hair d="M92,176 L104,182" />
      <Hair d="M102,176 L114,182" />
      <Hair d="M112,176 L124,182" />
      <Hair d="M122,176 L134,182" />
    </g>
  </g>
);

const Bubble: React.FC<{ cx: number; r: number; dur: number; delay: number }> = ({ cx, r, dur, delay }) => (
  <circle cx={cx} cy={150} r={r} fill="none" stroke="var(--accent)" strokeWidth={1.2}>
    <animate attributeName="cy" from={165} to={95} dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
    <animate attributeName="opacity" values="0;1;1;0" dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
  </circle>
);

const RequirementPool: React.FC<{ animated: boolean }> = ({ animated }) => (
  <g>
    <Ink style={drawOn(320)} d="M46,90 Q110,104 174,90 Q168,156 138,180 Q110,188 82,180 Q52,156 46,90 Z" />
    <Accent style={drawOn(160)} d="M52,92 Q110,104 168,92" />
    <Wash d="M50,94 Q110,106 170,94 Q166,150 140,174 Q110,180 80,174 Q54,150 50,94 Z" />

    {animated && (
      <>
        <SinkLeaf d="M90,110 Q96,104 104,108 Q102,118 94,118 Z" dur={4.5} delay={0} />
        <SinkLeaf d="M124,100 Q130,94 138,98 Q136,108 128,108 Z" dur={5.2} delay={1.2} />
        <SinkLeaf d="M106,118 Q112,112 120,116 Q118,126 110,126 Z" dur={6} delay={0.6} />
      </>
    )}

    <Hair d="M82,164 Q110,170 138,164" />
    <Hair d="M86,168 Q110,174 134,168" />
    {animated && <Steam xs={[94, 116]} />}

    <g transform="translate(38,188) rotate(-4)">
      <Hair d="M0,0 L62,0 L62,12 L0,12 Z" />
      <text x="4" y="8.4" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--ink-soft)">REQ · 02 ENTRIES</text>
    </g>
  </g>
);

const SinkLeaf: React.FC<{ d: string; dur: number; delay: number }> = ({ d, dur, delay }) => (
  <g>
    <path d={d} fill="none" stroke="var(--ink-soft)" strokeWidth={1.1} />
    <animateTransform attributeName="transform" type="translate" values="0,-10; 0,30" dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
    <animate attributeName="opacity" values="0;1;1;0" dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" />
  </g>
);

const Steam: React.FC<{ xs: number[] }> = ({ xs }) => (
  <g stroke="var(--accent)" strokeWidth={1.1} fill="none" strokeLinecap="round" opacity={0.85}>
    {xs.map((x, i) => (
      <path key={i} d={`M${x},80 q-3,-8 2,-14 q4,-6 -1,-14`}>
        <animateTransform attributeName="transform" type="translate" values="0,0; 0,-8; 0,0" dur="3.8s" begin={`${i * 0.7}s`} repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;.9;0" dur="3.8s" begin={`${i * 0.7}s`} repeatCount="indefinite" />
      </path>
    ))}
  </g>
);

const Structured: React.FC<{ animated: boolean }> = ({ animated }) => (
  <g>
    <g transform="translate(0,4)">
      <Ink style={drawOn(220)} d="M70,60 L150,60 L130,104 L90,104 Z" />
      <Hair d="M90,104 L100,70 M130,104 L120,70 M110,60 L110,104" />
      <path stroke="var(--accent)" strokeWidth={1.4} fill="none" strokeDasharray="3 4" d="M40,60 L70,60 M150,60 L180,60" />
      <text x="34" y="58" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--ink-soft)" textAnchor="end">V60</text>
    </g>

    <g transform="translate(0,12)">
      <Ink style={drawOn(260)} d="M72,126 L148,126 L156,186 Q110,194 64,186 Z" />
      <path stroke="var(--accent)" strokeWidth={1.4} fill="none" strokeDasharray="3 4" d="M40,126 L72,126 M148,126 L180,126" />
      <text x="186" y="124" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--ink-soft)">Ø 86mm</text>
      <Wash d="M80,150 Q110,156 140,150 L146,184 Q110,190 74,184 Z" />
      <Hair d="M74,170 L146,170" />
    </g>

    {animated && (
      <g stroke="var(--accent)" strokeWidth={1.4} fill="none" strokeLinecap="round">
        <line x1={110} y1={108} x2={110} y2={118}>
          <animate attributeName="y1" values="108;112;108" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="y2" values="116;130;116" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;.4;1" dur="1.2s" repeatCount="indefinite" />
        </line>
      </g>
    )}

    <g>
      <Hair d="M150,100 L170,90" />
      <circle cx={172} cy={89} r={2} fill="var(--accent)" />
      <text x="176" y="92" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--ink-soft)">FILTER</text>
      <Hair d="M70,170 L50,180" />
      <circle cx={48} cy={181} r={2} fill="var(--accent)" />
      <text x="26" y="184" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="var(--ink-soft)">YIELD</text>
    </g>
  </g>
);

const ProductionReady: React.FC<{ animated: boolean }> = ({ animated }) => (
  <g>
    <Ink style={drawOn(360)} d="M96,40 L124,40 L124,68 Q140,78 142,100 L142,178 Q110,190 78,178 L78,100 Q80,78 96,68 Z" />
    <Wash d="M80,110 Q110,118 140,110 L140,176 Q110,186 80,176 Z" />
    <Ink d="M96,54 L124,54" />
    <path d="M92,40 L128,40 L128,32 Q110,28 92,32 Z" fill="var(--accent)" fillOpacity={0.85} stroke="var(--ink)" strokeWidth={1.2} />
    <circle cx={110} cy={36} r={3.2} fill="var(--paper)" stroke="var(--ink)" strokeWidth={0.8} />
    <g transform="translate(146,100) rotate(-3)">
      <Hair d="M0,0 L0,-30" />
      <Ink d="M-2,0 L42,0 L48,14 L42,28 L-2,28 Z" fill="var(--paper)" />
      <text x="22" y="12" fontFamily="JetBrains Mono, monospace" fontSize="7" textAnchor="middle" fill="var(--ink)">READY</text>
      <text x="22" y="22" fontFamily="JetBrains Mono, monospace" fontSize="6.5" textAnchor="middle" fill="var(--ink-soft)">LOT · 04</text>
    </g>
    <Hair d="M86,120 L86,170" />
    {animated && (
      <circle cx={110} cy={36} r={4} fill="none" stroke="var(--accent)" strokeWidth={1.2}>
        <animate attributeName="r" values="4;10;4" dur="2.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values=".9;0;.9" dur="2.4s" repeatCount="indefinite" />
      </circle>
    )}
  </g>
);

const Queued: React.FC<{ animated: boolean }> = ({ animated }) => (
  <g>
    <Ink style={drawOn(300)} d="M36,60 L184,60 L184,160 L36,160 Z" />
    <Hair d="M36,90 L184,90 M36,120 L184,120" />

    <Ticket x={50} y={66} label="#01" />
    <Ticket x={104} y={66} label="#02" />
    <Ticket x={158} y={66} label="▸" accent />
    <Ticket x={50} y={96} label="#03" opacity={0.85} />
    <Ticket x={104} y={96} label="#04" opacity={0.75} />
    <Ticket x={158} y={96} label="#05" opacity={0.55} muted />

    <g>
      <path stroke="var(--accent)" strokeWidth={1.4} fill="none" strokeDasharray="6 6" d="M36,150 L184,150">
        {animated && <animate attributeName="stroke-dashoffset" from="0" to="-24" dur="1.2s" repeatCount="indefinite" />}
      </path>
      <circle cx={40} cy={150} r={3} fill="var(--accent)" />
      <circle cx={180} cy={150} r={3} fill="var(--accent)" />
    </g>

    <g transform="translate(184,60)">
      <circle cx={0} cy={0} r={14} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.2} />
      <g>
        <path stroke="var(--ink)" strokeWidth={1.4} fill="none" strokeLinecap="round" d="M0,0 L0,-9" />
        {animated && <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="8s" repeatCount="indefinite" />}
      </g>
      <Hair d="M0,0 L6,0" />
      <circle cx={0} cy={0} r={1.2} fill="var(--ink)" />
    </g>
  </g>
);

const Ticket: React.FC<{ x: number; y: number; label: string; accent?: boolean; opacity?: number; muted?: boolean }> = ({
  x,
  y,
  label,
  accent,
  opacity = 1,
  muted,
}) => (
  <g opacity={opacity}>
    <path
      d={`M${x},${y} L${x + 46},${y} L${x + 46},${y + 18} L${x},${y + 18} Z`}
      fill="var(--paper)"
      stroke={accent ? 'var(--accent)' : 'var(--ink)'}
      strokeWidth={1.4}
    />
    <text
      x={x + 23}
      y={y + 13}
      textAnchor="middle"
      fontFamily="JetBrains Mono, monospace"
      fontSize="10"
      fill={accent ? 'var(--accent)' : muted ? 'var(--ink-soft)' : 'var(--ink)'}
    >
      {label}
    </text>
  </g>
);

const Rendered: React.FC<{ animated: boolean }> = ({ animated }) => (
  <g>
    <ellipse cx={110} cy={174} rx={70} ry={12} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.4} />
    <ellipse cx={110} cy={172} rx={64} ry={9} fill="none" stroke="var(--ink-soft)" strokeWidth={0.7} />
    <Ink style={drawOn(260)} d="M60,106 L160,106 Q156,158 110,168 Q64,158 60,106 Z" />
    <Ink d="M160,118 Q188,118 188,134 Q188,150 160,150" />
    <ellipse cx={110} cy={106} rx={50} ry={8} fill="none" stroke="var(--ink)" strokeWidth={1.2} />
    <ellipse cx={110} cy={106} rx={40} ry={6} fill="var(--accent)" fillOpacity={0.18} stroke="none" />

    {animated && (
      <ellipse cx={110} cy={106} rx={26} ry={4} fill="none" stroke="var(--accent)" strokeWidth={1.2}>
        <animate attributeName="rx" values="0;50" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="ry" values="0;8" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values=".9;0" dur="2.6s" repeatCount="indefinite" />
      </ellipse>
    )}

    {animated && (
      <g stroke="var(--ink-soft)" strokeWidth={1.1} fill="none" strokeLinecap="round">
        {[0, 0.6, 1.2].map((d, i) => (
          <path key={i} d={`M${94 + i * 12},${90 - i * 2} q-3,-8 2,-14 q4,-6 -1,-14`}>
            <animate attributeName="opacity" values="0;.9;0" dur="3s" begin={`${d}s`} repeatCount="indefinite" />
          </path>
        ))}
      </g>
    )}

    <g transform="translate(150,166) rotate(6)">
      <Hair d="M0,0 L50,0 L50,22 L0,22 Z" fill="var(--paper)" />
      <Hair d="M0,8 L50,8 M0,15 L32,15" />
      <text x="3" y="6" fontFamily="JetBrains Mono, monospace" fontSize="5" fill="var(--ink-soft)">TASTING · 9.4</text>
    </g>

    <Accent style={drawOn(36, 0.6)} d="M70,184 L82,192 L104,174" />
  </g>
);

const Blocked: React.FC<{ animated: boolean }> = ({ animated }) => (
  <g>
    <Ink style={drawOn(320)} d="M54,112 Q54,88 82,80 L138,80 Q166,88 166,112 L166,150 Q110,172 54,150 Z" />
    <Ink d="M86,80 Q110,66 134,80" />
    <circle cx={110} cy={62} r={4} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.4} />
    <Ink d="M166,112 Q184,108 190,124 Q186,132 172,134" />
    <Ink d="M54,114 Q28,122 28,140 Q32,156 54,150" />

    <path stroke="var(--accent)" strokeWidth={1.4} fill="none" strokeLinecap="round" d="M98,96 L102,108 L94,118 L106,128 L98,140 L108,150">
      {animated && <animate attributeName="opacity" values="1;.4;1" dur="1.6s" repeatCount="indefinite" />}
    </path>

    <g transform="translate(150,46) rotate(-10)">
      <Hair d="M0,0 L-4,-4" />
      <Ink d="M0,0 L44,0 L50,10 L44,20 L0,20 Z" fill="var(--paper)" />
      <text x="24" y="13" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="var(--ink)">HOLD</text>
    </g>
  </g>
);

let injected = false;
function inject() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.setAttribute('data-shot-stage-illus', '');
  style.textContent = `
@keyframes shotStagePenDraw {
  from { stroke-dashoffset: var(--len, 300); }
  to   { stroke-dashoffset: 0; }
}
.shot-stage-illus.is-static * {
  animation: none !important;
}
`;
  document.head.appendChild(style);
}
inject();

export default ShotStageIllustration;
