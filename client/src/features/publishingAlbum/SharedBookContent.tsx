import type { BookShareReading } from "@shared/bookShare";
import { BookFormattedText } from "./BookMathText";

export function SharedBookContent({ reading, images }: {
  reading: BookShareReading;
  images: Array<{ dataUrl: string; width: number; height: number }>;
}) {
  return <div className="space-y-4" aria-label="分享的图文正文">
    {reading.blocks.map((block, index) => {
      if (block.kind === "text") return <div key={index} className="whitespace-pre-wrap break-words text-base leading-7"><BookFormattedText text={block.text} /></div>;
      const image = images[block.image];
      if (!image) return <p key={index} role="alert">图片暂时无法读取</p>;
      const c = block.crop;
      return <svg key={index} role="img" aria-label={`文章插图 ${block.image + 1}`} className="block w-full" style={{ aspectRatio: `${image.width * c.width} / ${image.height * c.height}` }}
        viewBox={`${c.x * image.width} ${c.y * image.height} ${c.width * image.width} ${c.height * image.height}`}>
        <image href={image.dataUrl} width={image.width} height={image.height} />
      </svg>;
    })}
  </div>;
}
