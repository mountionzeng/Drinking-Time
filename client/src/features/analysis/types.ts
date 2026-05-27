export type SourceType = 'image' | 'video' | 'script' | 'storyboard' | 'brief' | 'note';

export type ShotStatus =
  | 'idea_pool'
  | 'requirement_pool'
  | 'structured'
  | 'production_ready'
  | 'queued'
  | 'rendered'
  | 'blocked';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface AnalysisData {
  id: number;
  projectId: number;
  userId: number;
  mood: string | null;
  lighting: string | null;
  spatialStructure: string | null;
  cameraLanguage: string | null;
  colorPalette: string | null;
  atmosphereKeywords: unknown;
  promptDraft: string | null;
  negativePrompt: string | null;
  parameterSuggestions: unknown;
  summary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackendReference {
  id: number;
  projectId: number;
  userId: number;
  title: string;
  sourceType: string;
  fileUrl: string | null;
  fileKey: string | null;
  mimeType: string | null;
  fileSize: number | null;
  dateBucket: string | null;
  importance: number;
  pinned: boolean;
  excluded: boolean;
  extractedText: string | null;
  extractedTags: unknown;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackendShot {
  id: number;
  /** When derived from StoryAgent storyShots: the source index for edit write-back. */
  sourceIndex?: number;
  projectId: number;
  userId: number;
  sceneNo: string;
  shotNo: string;
  sourceSummary: string | null;
  intentType: 'idea' | 'client_requirement' | 'director_note';
  status: ShotStatus;
  readinessScore: number;
  deadline: string | null;
  priority: Priority;
  autoRender: boolean;
  blockingIssues: unknown;
  nextAction: string | null;
  sceneType: string | null;
  timeOfDay: string | null;
  weather: string | null;
  lighting: string | null;
  cameraFocalLength: string | null;
  cameraMovement: string | null;
  spatialLayers: string | null;
  mood: string | null;
  colorPalette: string | null;
  promptDraft: string | null;
  negativePrompt: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Current image thumbnail URL (set on Creation page) */
  thumbnailUrl?: string;
  /** Current image ID for drag-reassign (set on Creation page) */
  thumbnailImageId?: number;
}
