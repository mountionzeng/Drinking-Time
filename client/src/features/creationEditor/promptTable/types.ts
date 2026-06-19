export type PromptCategory = 'content' | 'narrative' | 'style';

export type PromptSourceSystem =
  | 'chat'
  | 'intent'
  | 'director'
  | 'art-repo'
  | 'inheritance'
  | 'manual';

export type InheritanceState = 'own' | 'inherited' | 'overridden';

export type PromptSource = {
  system: PromptSourceSystem;
  label: string;
  sourceCardContent?: string;
  inheritedFromShotNo?: number;
};

export type PromptRow = {
  id: string;
  dimension: string;
  label: string;
  value: string;
  weight: number;
  source: PromptSource;
  category: PromptCategory;
  inheritance: InheritanceState;
  contentLength: number;
};

export type PromptRunReference = {
  kind: 'baseImage' | 'characterRef' | 'styleRef';
  label: string;
  url?: string;
};

export type PromptRunRecord = {
  finalPrompt: string;
  generatedAt: number;
  imageId?: number;
  imageUrl?: string;
  source: 'draw-this-moment' | 'prompt-table-rerender' | 'creation-agent';
  usedDimensions: string[];
  references?: PromptRunReference[];
};

export type ArtDimension = {
  dimension: string;
  label: string;
  value: string;
  weight: number;
};

export type PromptOverride = {
  value?: string;
  weight?: number;
};

export type PromptOverrides = Record<string, PromptOverride>;
