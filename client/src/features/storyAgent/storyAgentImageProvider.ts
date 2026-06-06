/**
 * storyAgentImageProvider — 出图渠道选择
 *
 * 从 StoryAgentContext「大脑」里拆出来的一小块：用户可以选「默认 / 某个具体出图模型」。
 * 这里只负责这个选择值的类型、从存储里清洗、以及转换成请求参数。纯函数，不碰状态。
 */
import { normalizeImageProvider, type ImageProvider } from '@shared/imageProvider';

// 出图渠道选择：'default' 表示「跟随后端默认」，否则是某个具体的 ImageProvider。
export type ImageProviderSelection = 'default' | ImageProvider;

// 把从 localStorage 读回来的未知值，清洗成合法的渠道选择；非法一律回退 'default'。
export function normalizeImageProviderSelection(value: unknown): ImageProviderSelection {
  if (value === 'default') return 'default';
  if (typeof value !== 'string') return 'default';
  return normalizeImageProvider(value);
}

// 把渠道选择转成「发请求时的参数」：'default' → undefined（让后端自己决定），否则原样传。
export function imageProviderForRequest(value: ImageProviderSelection): ImageProvider | undefined {
  return value === 'default' ? undefined : value;
}
