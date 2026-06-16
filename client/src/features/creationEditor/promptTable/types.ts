export type PromptCategory = 'content' | 'style';

export type PromptSourceSystem =
  | 'chat'
  | 'intent'
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

export type ArtDimension = {
  dimension: string;
  label: string;
  value: string;
  weight: number;
};
