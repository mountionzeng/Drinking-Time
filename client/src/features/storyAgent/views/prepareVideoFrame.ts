export type PreparedVideoFrame = { imageId: number; imageUrl: string };
/** One confirmation, one image task, then the video. Late results never start another purchase. */
export async function prepareVideoFrame(input: {
  current: () => boolean;
  confirm: () => Promise<boolean>;
  generate: () => Promise<{ status: string; imageId?: number; imageUrl?: string }>;
  submit: (source: PreparedVideoFrame) => Promise<boolean>;
}): Promise<boolean> {
  if (!input.current() || !await input.confirm() || !input.current()) return false;
  const generated = await input.generate();
  if (!input.current() || generated.status !== "success" || !generated.imageId || !generated.imageUrl) return false;
  // Providers have already split their candidates; a candidate must remain intact.
  return input.submit({ imageId: generated.imageId, imageUrl: generated.imageUrl });
}
