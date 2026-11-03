import { useState, type AudioHTMLAttributes, type VideoHTMLAttributes } from "react";

type Props =
  | ({ kind: "video"; errorText?: string } & VideoHTMLAttributes<HTMLVideoElement>)
  | ({ kind: "audio"; errorText?: string } & AudioHTMLAttributes<HTMLAudioElement>);

export const MEDIA_PLAY_ERROR_TEXT = "无法播放：文件可能尚未生成完成、已过期或网络中断，请刷新后重试。";

/** <video>/<audio> that tells the user when playback fails instead of showing a dead player. */
export function MediaPlayer(props: Props) {
  const { kind, errorText, onError, ...rest } = props as Props & { onError?: (e: never) => void };
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = typeof rest.src === "string" ? rest.src : "";
  const failed = failedSrc !== null && failedSrc === src;
  const handleError = (event: never) => { setFailedSrc(src); onError?.(event); };
  return (
    <>
      {kind === "video"
        ? <video {...(rest as VideoHTMLAttributes<HTMLVideoElement>)} onError={handleError} />
        : <audio {...(rest as AudioHTMLAttributes<HTMLAudioElement>)} onError={handleError} />}
      {failed && <p role="alert" className="text-xs text-destructive">{errorText ?? MEDIA_PLAY_ERROR_TEXT}</p>}
    </>
  );
}
