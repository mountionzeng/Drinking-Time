/**
 * 生成图文件名校验（/api/images 与 /local-images 共用）。
 * 兼容：旧格式「时间戳-6位base36」、新格式「时间戳-UUID」、mask-<hex>-edit 等历史名。
 * 只允许单层文件名 + 图片扩展名，杜绝路径穿越。
 */
const SAFE_IMAGE_FILE = /^[a-zA-Z0-9_-]{1,200}\.(png|jpe?g|webp)$/;

export function isSafeImageFileName(file: string): boolean {
  return SAFE_IMAGE_FILE.test(file) && !file.startsWith("-");
}
