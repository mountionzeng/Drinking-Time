/** Decode local raster uploads without fetch: production connect-src permits only same-origin requests. */
export async function readImagePackBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  if (url.startsWith("data:")) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
    if (!match) throw new Error("本机图片格式无效，请重新选择 PNG、JPEG 或 WebP 图片");
    let binary: string;
    try { binary = atob(match[2]); }
    catch { throw new Error("本机图片数据不完整，请重新选择图片"); }
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new Blob([bytes], { type: match[1].toLowerCase() });
  }
  const response = await fetch(url, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
  return response.blob();
}
