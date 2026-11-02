import { useUiText as useDesktopUiText } from "@/features/uiLanguage/UiLanguage";
import { useEffect, useState } from "react";
import { readBookImage } from "@shared/bookImageBlock";

export function BookInlineImage({ text }: { text: string }) {
  const _ui = useDesktopUiText();
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
  if (image.videoUrl) return <video aria-label={_ui("文章短视频")} controls playsInline preload="metadata" poster={image.url} src={image.videoUrl} className="h-full w-full object-contain" />;
  return (
    <svg
      role="img"
      aria-label={_ui("文章插图")}
      className="h-full w-full"
      preserveAspectRatio={image.frame ? "none" : "xMinYMid meet"}
      viewBox={`${c.x * size.width} ${c.y * size.height} ${c.width * size.width} ${c.height * size.height}`}
    >
      <image href={image.url} width={size.width} height={size.height} />
    </svg>
  );
}
