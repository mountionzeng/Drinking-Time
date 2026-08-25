export function StoryboardEditFilmstrip({
  frameUrls,
  posterUrl,
  testId,
}: {
  frameUrls: readonly string[];
  posterUrl?: string | null;
  testId: string;
}) {
  if (frameUrls.length === 0 && !posterUrl) return null;
  return (
    <span
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
      data-testid={testId}
    >
      {posterUrl ? (
        <img
          src={posterUrl}
          alt=""
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
      ) : null}
      {frameUrls.length > 0 ? (
        <span className="absolute inset-0 flex">
          {frameUrls.map((src, index) => (
            <img
              key={`${src}-${index}`}
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full min-w-0 flex-1 select-none border-r border-black/15 object-cover last:border-r-0"
              onError={event => {
                // 抽帧暂时失败时露出底下的主图/色块，避免出现破图图标。
                event.currentTarget.style.visibility = "hidden";
              }}
            />
          ))}
        </span>
      ) : null}
      <span className="absolute inset-0 bg-black/10" />
    </span>
  );
}
