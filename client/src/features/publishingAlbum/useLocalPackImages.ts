import { useRef, useState } from "react";
import { optimizeImageForUpload } from "@/lib/imageUpload";
import type { PackAsset } from "./imagePackComposition";

export async function prepareLocalPackImage(file: File): Promise<PackAsset> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new Error("请选择 PNG、JPG 或 WebP 图片。");
  if (file.size > 15 * 1024 * 1024)
    throw new Error("图片太大，请选择 15 MB 以内的图片。");
  const optimized = await optimizeImageForUpload(file, {
    maxDimension: 2400,
    quality: 0.88,
  });
  if (optimized.optimizedBytes > 2 * 1024 * 1024)
    throw new Error("图片仍然太大，请压缩到 2 MB 以内再添加。");
  return {
    id: -(Date.now() * 1000 + Math.floor(Math.random() * 1000)),
    label: file.name,
    imageUrl: optimized.dataUrl,
  };
}

/** Uploaded layout images stay in this browser and never become the story's official cover. */
export function useLocalPackImages(scope: string) {
  const key = `publishing-layout-images:${scope}`;
  const [images, setImages] = useState<PackAsset[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "[]");
      return Array.isArray(value)
        ? value.filter(
            item =>
              item &&
              typeof item.id === "number" &&
              typeof item.label === "string" &&
              typeof item.imageUrl === "string" &&
              /^data:image\/(png|jpeg|webp);base64,/.test(item.imageUrl)
          )
        : [];
    } catch {
      return [];
    }
  });
  const imagesRef = useRef(images);
  const [warning, setWarning] = useState("");
  async function upload(file: File): Promise<PackAsset> {
    const asset = await prepareLocalPackImage(file);
    const next = [...imagesRef.current, asset];
    imagesRef.current = next;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setWarning("");
    } catch {
      setWarning(
        "本机存储空间不足，新上传图片仅在本次打开期间保留，请及时下载成品。"
      );
    }
    setImages(next);
    return asset;
  }
  return { images, upload, warning };
}
