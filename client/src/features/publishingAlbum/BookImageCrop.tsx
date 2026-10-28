import { useEffect, useState } from "react";
import { readBookImage } from "./bookImageBlock";

export function BookInlineImage({ text }: { text: string }) {
  const image = readBookImage(text)!;
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (active)
        setSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = image.url;
    return () => {
      active = false;
    };
  }, [image.url]);
  const c = image.crop;
  return (
    <svg
      role="img"
      aria-label="文章插图"
      className="h-full w-full"
      preserveAspectRatio={image.frame ? "none" : "xMinYMid meet"}
      viewBox={`${c.x * size.width} ${c.y * size.height} ${c.width * size.width} ${c.height * size.height}`}
    >
      <image href={image.url} width={size.width} height={size.height} />
    </svg>
  );
}
