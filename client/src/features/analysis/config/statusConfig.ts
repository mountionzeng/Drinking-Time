import type { ShotStatus, Priority, SourceType } from '@/features/analysis/types';

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
