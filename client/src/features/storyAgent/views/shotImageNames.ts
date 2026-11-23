import { inlineImageToken } from '@shared/inlineChatImages';
import { explicitImageFrameRole } from '../chatFrameRole';
import { createContext, useContext } from 'react';

export const ShotImageNames = createContext<ReadonlyMap<number, string>>(new Map());

export function useShotImageName() {
  const names = useContext(ShotImageNames);
  return (id: number) => names.get(id);
}

/** Resolve an exact version on send. Names shared by two shots must never pick an arbitrary image. */
export function resolveShotImageMentions(text: string, names: ReadonlyMap<number, string>) {
  const pattern = /\[\[ref:[^\]\n]+\]\]|(?<![\w#])(\d{4,})\s*(?:·\s*|\s+)V(\d{2,})(?!\w)/gi;
  const replace = (asCommand: boolean) => text.replace(pattern, (original, code?: string, version?: string) => {
    if (!code) return original;
    const name = code + ' · V' + version;
    const matches = [...names].filter(([, label]) => label === name);
    if (matches.length !== 1) throw new Error('请从仓库点选 ' + name + '，以确认要引用的图片版本。');
    return asCommand ? '#' + matches[0][0] : inlineImageToken(matches[0][0]);
  });
  const command = replace(true);
  if (command === text || explicitImageFrameRole(command)) return command;
  return replace(false);
}

/** Keep original chat tokens, receipts and non-image identifiers intact. */
export function displayImageMentions(text: string, names: ReadonlyMap<number, string>) {
  return text.replace(/(?:Take|视频|文件|用户|任务)\s*#\d+|#(\d+)\b/gi,
    (original, id: string | undefined) => id ? names.get(Number(id)) ?? original : original);
}
