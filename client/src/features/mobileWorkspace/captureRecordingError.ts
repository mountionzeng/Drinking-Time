/** Browser/OS denial cannot be bypassed by the page; provide an actionable recovery. */
export function captureRecordingError(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "麦克风未获授权。请在浏览器的网站权限中允许麦克风，并检查系统隐私设置是否允许当前浏览器使用麦克风，然后再点“录一段”。如果在内置浏览器里无法授权，请用 Chrome 或 Safari 打开同一地址；也可以通过“图片／录音文件”上传已有录音。";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "未找到麦克风，请连接或启用麦克风；也可以上传已有录音文件。";
  if (name === "NotReadableError" || name === "TrackStartError") return "麦克风可能被其他应用占用，或被系统禁用。请关闭其他录音应用、检查系统麦克风权限后重试；也可以上传录音文件。";
  return "未能开始录音，请检查麦克风和浏览器权限后重试；也可以通过“图片／录音文件”上传已有录音。";
}
