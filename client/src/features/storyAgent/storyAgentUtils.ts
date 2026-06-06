/**
 * storyAgentUtils — 故事 Agent 的纯函数工具箱
 *
 * 从 StoryAgentContext「大脑」里拆出来的一块：一律是无状态纯函数
 * （生成 ID、压缩标题、清洗画布项、文件转 base64），不依赖任何 React 状态，
 * 所以单独成文件，方便复用与单测。
 */
import type { StoryCard, VisualCanvasItem } from './types';

// 生成一个带前缀的弱唯一 ID：前缀-时间戳-随机串。够本地用，不追求全局唯一。
export function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// 给一张卡推导一个简短标题：优先取原话/正文，压成单行并截到 14 字。
export function cardTitle(card: Partial<StoryCard>): string {
  const source = card.sourceQuote || card.content || card.rawText || '故事素材';
  const compact = source.replace(/\s+/g, ' ').trim();
  return compact.length > 14 ? `${compact.slice(0, 14)}…` : compact || '故事素材';
}

// 把 unknown 安全地收成 string[]：非数组返回空，数组里只保留字符串项。
// 仅本模块内 normalizeVisualCanvasItem 使用，故不导出。
function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

// 把从 localStorage 读回来的「未知形状」数据，清洗成一个合法的 VisualCanvasItem。
// 缺图（imageUrl）直接判废返回 null；其余字段缺省时给安全默认值。
export function normalizeVisualCanvasItem(raw: unknown): VisualCanvasItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const analysis = obj.analysis && typeof obj.analysis === 'object'
    ? (obj.analysis as Record<string, unknown>)
    : {};
  const imageUrl = typeof obj.imageUrl === 'string' ? obj.imageUrl : '';
  if (!imageUrl) return null;

  return {
    id: typeof obj.id === 'string' ? obj.id : newId('visual'),
    title: typeof obj.title === 'string' ? obj.title : '视觉锚',
    imageUrl,
    originalImageUrl: typeof obj.originalImageUrl === 'string' ? obj.originalImageUrl : undefined,
    source: obj.source === 'reference' ? 'reference' : 'riff',
    parentId: typeof obj.parentId === 'string' ? obj.parentId : undefined,
    cardId: typeof obj.cardId === 'string' ? obj.cardId : undefined,
    x: typeof obj.x === 'number' ? obj.x : 24,
    y: typeof obj.y === 'number' ? obj.y : 24,
    width: typeof obj.width === 'number' ? obj.width : 168,
    height: typeof obj.height === 'number' ? obj.height : 210,
    prompt: typeof obj.prompt === 'string' ? obj.prompt : '',
    userInstruction: typeof obj.userInstruction === 'string' ? obj.userInstruction : undefined,
    analysis: {
      objective: typeof analysis.objective === 'string' ? analysis.objective : '',
      aesthetic: typeof analysis.aesthetic === 'string' ? analysis.aesthetic : '',
      visualStyle: stringList(analysis.visualStyle),
      mood: stringList(analysis.mood),
      colorPalette: stringList(analysis.colorPalette),
      composition: typeof analysis.composition === 'string' ? analysis.composition : '',
      lighting: typeof analysis.lighting === 'string' ? analysis.lighting : '',
      promptDraft: typeof analysis.promptDraft === 'string' ? analysis.promptDraft : '',
      negativePrompt: typeof analysis.negativePrompt === 'string' ? analysis.negativePrompt : '',
      confidence: typeof analysis.confidence === 'number' ? analysis.confidence : 0,
    },
    createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
  };
}

// 把用户选的图片文件读成纯 base64（去掉 data:image/...;base64, 前缀），用于上传。
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}
