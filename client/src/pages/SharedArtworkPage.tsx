import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { artworkShareTokenSchema } from "@shared/artworkShare";
import { ArtworkAuthor } from "@/features/publishingAlbum/ArtworkAuthor";
import { ImageCandidatePreview } from "@/features/publishingAlbum/ImageCandidatePreview";

export default function SharedArtworkPage({ token }: { token: string }) {
  const valid = artworkShareTokenSchema.safeParse(token).success;
  const query = trpc.artworkShare.read.useQuery(
    { token },
    { enabled: valid, retry: false, refetchOnWindowFocus: true, gcTime: 0 }
  );
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.append(meta);
    return () => meta.remove();
  }, []);
  return (
    <main className="min-h-dvh bg-[#f6f3eb] px-4 py-8 text-[#332d26]">
      <div className="mx-auto max-w-xl">
        {!valid || query.isError ? (
          <p role="alert" className="py-20 text-center">
            作品不存在或分享已停止。
          </p>
        ) : query.isLoading ? (
          <p role="status" className="py-20 text-center">
            正在打开作品…
          </p>
        ) : query.data ? (
          <>
            <header className="mb-7">
              <p className="mb-3 text-xs tracking-widest text-[#706b60]">
                拾光 · 图文作品
              </p>
              <h1 className="font-serif text-2xl leading-relaxed">
                {query.data.title}
              </h1>
              {query.data.author ? (
                <div className="mt-5">
                  <ArtworkAuthor name={query.data.author.name} />
                </div>
              ) : null}
              <p className="mt-3 text-sm text-[#706b60]">
                共 {query.data.pages.length} 张 · 长按图片可保存
              </p>
            </header>
            <div className="space-y-6">
              {query.data.pages.map((page, index) => (
                <figure key={index}>
                  <ImageCandidatePreview
                    touchOnly
                    label={`${query.data.title} · 第 ${index + 1} 张`}
                    preview={
                      <img src={page.dataUrl} alt={`第 ${index + 1} 张作品`} />
                    }
                  >
                    <button
                      type="button"
                      className="block w-full cursor-zoom-in"
                      aria-label={`放大第 ${index + 1} 张作品`}
                    >
                      <img
                        src={page.dataUrl}
                        width={page.width}
                        height={page.height}
                        alt={`${query.data.title} · 第 ${index + 1} 张`}
                        loading={index ? "lazy" : "eager"}
                        className="w-full rounded-sm shadow-sm"
                      />
                    </button>
                  </ImageCandidatePreview>
                  <figcaption className="mt-2 text-center text-xs text-[#706b60]">
                    {index + 1} / {query.data.pages.length}
                  </figcaption>
                </figure>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
