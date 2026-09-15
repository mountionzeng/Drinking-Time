import { useEffect, useState } from "react";

export default function StoryCoverThumbnail({
  src,
  className = "",
}: {
  src?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return null;

  return (
    <span
      className={`story-cover-thumbnail relative shrink-0 overflow-hidden bg-[var(--panel-header)] ${className}`}
    >
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
      />
    </span>
  );
}
