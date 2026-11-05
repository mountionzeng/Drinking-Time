export const BOOK_MODULE_IMAGE_TASKS_KEY = "bookModuleImageTasks";

export type BookModuleImageTarget = { chapterId: number; moduleId: string };
export type BookModuleImageCandidate = { imageId: number; imageUrl: string };
export type BookModuleImageTask = BookModuleImageTarget & {
  composition?: import('./bookImageComposition').BookImageComposition;
  id: string;
  createdAt?: number;
  requestId: string;
  sourceHash: string;
  provider: "midjourney" | "gpt-image";
  status: "preparing" | "accepted" | "unknown" | "failed" | "succeeded";
  providerTaskId?: string;
  error?: string;
  candidates: BookModuleImageCandidate[];
};
export type BookModuleImageTaskView = BookModuleImageTask & {
  inserted: boolean;
  sourceChanged: boolean;
};
