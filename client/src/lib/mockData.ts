/**
 * Mock data for Analysis Engine prototype
 * Design: The Grading Desk — professional film production tool
 */

export type SourceType = 'image' | 'video' | 'script' | 'storyboard' | 'brief' | 'note';

export interface ReferenceFragment {
  id: string;
  title: string;
  sourceType: SourceType;
  dateBucket?: string;
  importance: 1 | 2 | 3 | 4 | 5;
  finalWeight?: number;
  excluded?: boolean;
  pinned?: boolean;
}

export type ShotStatus =
  | 'idea_pool'
  | 'requirement_pool'
  | 'structured'
  | 'production_ready'
  | 'queued'
  | 'rendered'
  | 'blocked';

export type IntentType = 'idea' | 'client_requirement' | 'director_note';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface ShotProductionRow {
  id: string;
  sceneNo: string;
  shotNo: string;
  sourceSummary: string;
  intentType: IntentType;
  status: ShotStatus;
  readinessScore: number;
  deadline?: string;
  priority: Priority;
  autoRender: boolean;
  blockingIssues?: string[];
  nextAction?: string;
  linkedTemplateId?: string;
  linkedShotBlueprintId?: string;
}

// ===== Reference Fragments =====

export const MOCK_FRAGMENTS: ReferenceFragment[] = [
  {
    id: 'ref-001',
    title: 'Industrial district night reference',
    sourceType: 'image',
    dateBucket: '2026-03-24',
    importance: 5,
    finalWeight: 0.92,
    pinned: true,
  },
  {
    id: 'ref-002',
    title: 'Sodium vapor lighting study',
    sourceType: 'image',
    dateBucket: '2026-03-24',
    importance: 4,
    finalWeight: 0.78,
  },
  {
    id: 'ref-003',
    title: 'Scene 3 script excerpt — warehouse approach',
    sourceType: 'script',
    dateBucket: '2026-03-25',
    importance: 4,
    finalWeight: 0.81,
  },
  {
    id: 'ref-004',
    title: 'Client brief — mood board requirements',
    sourceType: 'brief',
    dateBucket: '2026-03-25',
    importance: 3,
    finalWeight: 0.65,
  },
  {
    id: 'ref-005',
    title: 'Storyboard panel A — wide establishing',
    sourceType: 'storyboard',
    dateBucket: '2026-03-25',
    importance: 5,
    finalWeight: 0.88,
    pinned: true,
  },
  {
    id: 'ref-006',
    title: 'Fog density reference video',
    sourceType: 'video',
    dateBucket: '2026-03-26',
    importance: 3,
    finalWeight: 0.55,
  },
  {
    id: 'ref-007',
    title: 'Color palette notes — warm vs cool tension',
    sourceType: 'note',
    dateBucket: '2026-03-26',
    importance: 2,
    finalWeight: 0.42,
  },
  {
    id: 'ref-008',
    title: 'Aerial drone reference — rooftop angle',
    sourceType: 'video',
    dateBucket: undefined,
    importance: 2,
    finalWeight: 0.38,
  },
  {
    id: 'ref-009',
    title: 'Material texture — rusted metal close-up',
    sourceType: 'image',
    dateBucket: '2026-03-24',
    importance: 3,
    finalWeight: 0.60,
  },
  {
    id: 'ref-010',
    title: 'Director notes — pacing and rhythm',
    sourceType: 'note',
    dateBucket: undefined,
    importance: 3,
    finalWeight: 0.50,
  },
];

// ===== Shot Production Table =====

export const MOCK_SHOTS: ShotProductionRow[] = [
  {
    id: 'shot-001',
    sceneNo: 'S01',
    shotNo: 'A001',
    sourceSummary: 'Wide establishing shot — abandoned industrial district at dusk, sodium vapor lights flickering on',
    intentType: 'client_requirement',
    status: 'production_ready',
    readinessScore: 0.88,
    deadline: '2026-03-30',
    priority: 'high',
    autoRender: true,
    nextAction: 'Queue for first-pass render',
    linkedTemplateId: 'tpl-001',
  },
  {
    id: 'shot-002',
    sceneNo: 'S01',
    shotNo: 'A002',
    sourceSummary: 'Medium tracking shot — protagonist walks through fog, camera follows at waist height',
    intentType: 'director_note',
    status: 'structured',
    readinessScore: 0.65,
    deadline: '2026-03-31',
    priority: 'high',
    autoRender: false,
    nextAction: 'Complete camera language parameters',
    linkedTemplateId: 'tpl-001',
  },
  {
    id: 'shot-003',
    sceneNo: 'S01',
    shotNo: 'A003',
    sourceSummary: 'Close-up — hands touching rusted metal surface, shallow DOF',
    intentType: 'idea',
    status: 'idea_pool',
    readinessScore: 0.28,
    priority: 'low',
    autoRender: false,
    nextAction: 'Define subject and lighting setup',
  },
  {
    id: 'shot-004',
    sceneNo: 'S02',
    shotNo: 'B001',
    sourceSummary: 'Interior warehouse — high angle looking down at empty floor, single overhead light',
    intentType: 'client_requirement',
    status: 'production_ready',
    readinessScore: 0.82,
    deadline: '2026-03-29',
    priority: 'urgent',
    autoRender: true,
    nextAction: 'Ready for render queue',
    linkedTemplateId: 'tpl-002',
  },
  {
    id: 'shot-005',
    sceneNo: 'S02',
    shotNo: 'B002',
    sourceSummary: 'Low angle — light streaming through broken windows, dust particles visible',
    intentType: 'director_note',
    status: 'queued',
    readinessScore: 0.91,
    deadline: '2026-03-28',
    priority: 'high',
    autoRender: true,
    nextAction: 'Rendering in progress',
    linkedTemplateId: 'tpl-002',
  },
  {
    id: 'shot-006',
    sceneNo: 'S03',
    shotNo: 'C001',
    sourceSummary: 'Exterior rooftop — city skyline at night, protagonist silhouette against light pollution',
    intentType: 'client_requirement',
    status: 'blocked',
    readinessScore: 0.67,
    deadline: '2026-03-28',
    priority: 'urgent',
    autoRender: true,
    blockingIssues: ['Missing skyline reference', 'Light pollution intensity undefined'],
    nextAction: 'Resolve blocking issues',
  },
  {
    id: 'shot-007',
    sceneNo: 'S03',
    shotNo: 'C002',
    sourceSummary: 'Dolly zoom — protagonist looks over edge, vertigo effect',
    intentType: 'idea',
    status: 'requirement_pool',
    readinessScore: 0.42,
    priority: 'medium',
    autoRender: false,
    nextAction: 'Clarify camera movement parameters',
  },
  {
    id: 'shot-008',
    sceneNo: 'S04',
    shotNo: 'D001',
    sourceSummary: 'Time-lapse — dawn breaking over industrial zone, fog lifting gradually',
    intentType: 'director_note',
    status: 'rendered',
    readinessScore: 0.95,
    deadline: '2026-03-26',
    priority: 'medium',
    autoRender: true,
    nextAction: 'Review render output',
    linkedTemplateId: 'tpl-001',
    linkedShotBlueprintId: 'bp-008',
  },
  {
    id: 'shot-009',
    sceneNo: 'S05',
    shotNo: 'E001',
    sourceSummary: 'Abstract — water reflections on wet concrete, distorted sodium light',
    intentType: 'idea',
    status: 'idea_pool',
    readinessScore: 0.15,
    priority: 'low',
    autoRender: false,
    nextAction: 'Develop concept further',
  },
  {
    id: 'shot-010',
    sceneNo: 'S05',
    shotNo: 'E002',
    sourceSummary: 'Crane shot — rising from ground level to reveal full industrial complex',
    intentType: 'client_requirement',
    status: 'structured',
    readinessScore: 0.72,
    deadline: '2026-04-02',
    priority: 'medium',
    autoRender: false,
    nextAction: 'Finalize camera path and timing',
    linkedTemplateId: 'tpl-001',
  },
];

// ===== Template Draft Summary =====

export const TEMPLATE_DRAFT = {
  mood: ['Oppressive', 'Restrained', 'Cinematic', 'Melancholic'],
  lighting: ['Sodium vapor', 'Practical lights', 'Low-key', 'Warm highlights / cool shadows'],
  spatialStructure: ['Industrial corridors', 'Vertical layering', 'Deep perspective', 'Confined spaces'],
  cameraLanguage: ['Slow push-in', 'Low angle', 'Shallow DOF', 'Tracking shots'],
  referencesCount: 10,
  keyReferencesCount: 3,
  summary: 'Abandoned industrial district — humid night atmosphere with sodium vapor lighting, volumetric fog, and restrained cinematic tone.',
};

// ===== Source type config =====

export const SOURCE_TYPE_CONFIG: Record<SourceType, { label: string; icon: string; color: string }> = {
  image: { label: 'Image', icon: '🖼', color: 'oklch(0.70 0.12 250)' },
  video: { label: 'Video', icon: '🎬', color: 'oklch(0.65 0.15 310)' },
  script: { label: 'Script', icon: '📜', color: 'oklch(0.72 0.10 80)' },
  storyboard: { label: 'Storyboard', icon: '🎞', color: 'oklch(0.68 0.12 155)' },
  brief: { label: 'Brief', icon: '📋', color: 'oklch(0.65 0.10 195)' },
  note: { label: 'Note', icon: '📝', color: 'oklch(0.60 0.05 270)' },
};

export const STATUS_CONFIG: Record<ShotStatus, { label: string; color: string; bgColor: string }> = {
  idea_pool: { label: 'Idea Pool', color: 'var(--status-idea)', bgColor: 'oklch(0.55 0.01 270 / 15%)' },
  requirement_pool: { label: 'Requirement', color: 'var(--status-requirement)', bgColor: 'oklch(0.55 0.08 250 / 15%)' },
  structured: { label: 'Structured', color: 'var(--status-structured)', bgColor: 'oklch(0.60 0.15 250 / 15%)' },
  production_ready: { label: 'Prod Ready', color: 'var(--status-ready)', bgColor: 'oklch(0.65 0.18 150 / 15%)' },
  queued: { label: 'Queued', color: 'var(--status-queued)', bgColor: 'oklch(0.70 0.12 195 / 15%)' },
  rendered: { label: 'Rendered', color: 'var(--status-rendered)', bgColor: 'oklch(0.50 0.14 155 / 15%)' },
  blocked: { label: 'Blocked', color: 'var(--status-blocked)', bgColor: 'oklch(0.60 0.20 25 / 15%)' },
};

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  low: { label: 'Low', color: 'oklch(0.55 0.01 270)' },
  medium: { label: 'Medium', color: 'oklch(0.65 0.10 250)' },
  high: { label: 'High', color: 'oklch(0.70 0.14 80)' },
  urgent: { label: 'Urgent', color: 'oklch(0.60 0.20 25)' },
};
