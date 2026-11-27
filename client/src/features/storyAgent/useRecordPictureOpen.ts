import { trpc } from "@/lib/trpc";

/** Do not turn thumbnail loads, pointer hover, focus or React re-renders into evidence. */
export function useRecordPictureOpen() {
  const utils = trpc.useUtils();
  return (event: { nativeEvent: { isTrusted: boolean } }, imageId?: number) => {
    if (imageId && event?.nativeEvent?.isTrusted) {
      void utils.client.memorySpace.imageOpened
        .mutate({ imageId })
        .catch(() => {});
    }
  };
}
