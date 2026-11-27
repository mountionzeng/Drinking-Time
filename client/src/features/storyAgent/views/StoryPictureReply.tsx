import { BookPageExcerpt } from "@/features/publishingAlbum/BookPageExcerpt";
import { trpc } from "@/lib/trpc";
import { ChatPhotoPreview } from "./ChatPhotoPreview";

export function StoryPictureReply({
  accountId,
  storyId,
  query,
}: {
  accountId: number;
  storyId: number;
  query: string;
}) {
  const result = trpc.memorySpace.findPictures.useQuery(
    { accountId, storyId, query },
    { enabled: Boolean(query), staleTime: 0 }
  );
  if (!query) return null;
  if (result.isPending) return <p>正在查找之前的图片…</p>;
  if (result.error)
    return (
      <button type="button" onClick={() => void result.refetch()}>
        图片暂未读到，重新查找
      </button>
    );
  if (!result.data.length)
    return <p>没有找到与这次描述相符、你提供或用过的图片。</p>;
  const stories = [...new Set(result.data.map(p => p.storyId))];
  return (
    <div>
      {stories.map(id => {
        const images = result.data.filter(p => p.storyId === id);
        return (
          <div key={id}>
            <p>{images[0].storyTitle}</p>
            {images.map(p => p.reading ? <BookPageExcerpt key={p.url} url={p.url} reading={p.reading} context={query}/> : (
              <figure
                key={p.imageId ?? p.url}
                className="inline-block max-w-44 align-top mr-2"
              >
                <ChatPhotoPreview
                  src={p.url}
                  name={p.label}
                  imageId={p.imageId}
                  saved
                />
                <figcaption className="text-xs text-muted-foreground">
                  {p.reason} · {p.label.slice(0, 45)}
                </figcaption>
              </figure>
            ))}
          </div>
        );
      })}
    </div>
  );
}
