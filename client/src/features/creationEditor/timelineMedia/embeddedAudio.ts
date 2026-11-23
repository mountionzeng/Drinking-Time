type Box = { type: string; start: number; end: number };

/** Walk declared ISO media box sizes, never media payload bytes. */
function childBoxes(view: DataView, start: number, end: number): Box[] | null {
  const result: Box[] = [];
  while (start < end) {
    if (end - start < 8) return null;
    let size = view.getUint32(start);
    const type = String.fromCharCode(...new Uint8Array(view.buffer, start + 4, 4));
    let header = 8;
    if (size === 0) size = end - start;
    else if (size === 1) {
      if (end - start < 16 || view.getUint32(start + 8) !== 0) return null;
      size = view.getUint32(start + 12);
      header = 16;
    }
    if (size < header || size > end - start) return null;
    result.push({ type, start: start + header, end: start + size });
    start += size;
  }
  return result;
}

/** Unknown/incomplete formats still go through the browser audio decoder. */
export function isVideoOnlyMp4(bytes: ArrayBuffer): boolean {
  const view = new DataView(bytes);
  const movies = childBoxes(view, 0, bytes.byteLength)?.filter(box => box.type === "moov");
  if (movies?.length !== 1) return false;
  const tracks = childBoxes(view, movies[0].start, movies[0].end)?.filter(box => box.type === "trak");
  if (!tracks?.length) return false;
  let hasVideo = false;
  for (const track of tracks) {
    const media = childBoxes(view, track.start, track.end)?.filter(box => box.type === "mdia");
    if (media?.length !== 1) return false;
    const handler = childBoxes(view, media[0].start, media[0].end)?.filter(box => box.type === "hdlr");
    if (handler?.length !== 1 || handler[0].end - handler[0].start < 24) return false;
    const type = String.fromCharCode(...new Uint8Array(bytes, handler[0].start + 8, 4));
    if (type === "soun") return false;
    if (type === "vide") hasVideo = true;
  }
  return hasVideo;
}
