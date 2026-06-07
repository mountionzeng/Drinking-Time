/**
 * 「卡片 / 剧本继承对话照片」的纯逻辑。
 *
 * 从 StoryAgentContext / ScriptViewer 里抽出来单独成文件，有两个好处：
 *   1. 可单测 —— 不用渲染 React、不用 mock tRPC，直接喂数据断言输出；
 *   2. 给那个越来越重的 god-object 减负。
 *
 * 这里只放「纯数据变换」：不碰 React state、不发请求、不读时间/随机数
 * （非确定性输入都由调用方传进来）。
 */
import type {
  ChatMessage,
  ScriptScene,
  StoryCard,
  VisualCanvasAnalysis,
  VisualCanvasItem,
} from './types';

/**
 * 一份「空壳」视觉分析。
 * 用户从对话框直接发来的原图还没经过美术 Agent 分析，先给全空占位；
 * CardVisualDock 能容忍空分析（会显示「还没有客观分析」之类的占位文案）。
 */
export function emptyVisualAnalysis(): VisualCanvasAnalysis {
  return {
    objective: '',
    aesthetic: '',
    visualStyle: [],
    mood: [],
    colorPalette: [],
    composition: '',
    lighting: '',
    promptDraft: '',
    negativePrompt: '',
    confidence: 0,
  };
}

/**
 * 构造「卡片继承对话照片」的 reference 视觉锚。
 *
 * 触发条件：这一轮既带了照片（photoUrlForStore），又真的生成了卡片（spawnedCardId）。
 * 任一缺失都返回 null —— 没照片不挂图；没出卡也没有可挂靠的卡片。
 *
 * source 固定为 'reference'：这是用户原图，区别于美术 Agent 加工出来的 'riff'。
 * id / createdAt 这类非确定性输入由调用方传入，保持本函数纯净、可测。
 */
export function buildInheritedPhotoReference(params: {
  /** 落库 / 渲染用的照片 URL（优先 storage 托管 URL，回退 data URL）。 */
  photoUrlForStore?: string;
  /** 这一轮新生成卡片的 id；没出卡时为 undefined。 */
  spawnedCardId?: string;
  /** 画布上已有多少 item，用来错开摆放，避免新图完全叠在旧图上。 */
  existingCount: number;
  /** 视觉锚 id，通常来自 newId('visual')。 */
  id: string;
  /** 创建时间戳，通常来自 Date.now()。 */
  createdAt: number;
}): VisualCanvasItem | null {
  const { photoUrlForStore, spawnedCardId, existingCount, id, createdAt } =
    params;
  if (!photoUrlForStore || !spawnedCardId) return null;

  const offset = existingCount * 18; // 多张图错开摆放
  return {
    id,
    title: '对话照片',
    imageUrl: photoUrlForStore,
    source: 'reference',
    cardId: spawnedCardId,
    x: 18 + offset,
    y: 18 + offset,
    width: 170,
    height: 218,
    prompt: '',
    analysis: emptyVisualAnalysis(),
    createdAt,
  };
}

/**
 * 剧本「派生式」取图：为每个场景算出它从来源卡片继承来的对话原图 URL。
 *
 * 纯渲染期推导，不新增字段、不落库：
 *   scene.fromCardId → 该卡片上 source==='reference' 的视觉锚 → imageUrl。
 *
 * 返回 Map<sceneNo, imageUrl>；场景没有 fromCardId、或该卡片没有继承图，就不进 Map。
 * 调用方（ScriptViewer）用它作为「还没有生成图时」的回退缩略图。
 */
export function buildSceneInheritedImageMap(
  scenes: ReadonlyArray<Pick<ScriptScene, 'sceneNo' | 'fromCardId'>>,
  visualCanvasItems: ReadonlyArray<VisualCanvasItem>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const scene of scenes) {
    if (!scene.fromCardId) continue; // fromCardId 是内容匹配出来的，匹配不到就是空串
    const ref = visualCanvasItems.find(
      item => item.source === 'reference' && item.cardId === scene.fromCardId,
    );
    if (ref) map.set(scene.sceneNo, ref.imageUrl);
  }
  return map;
}

/**
 * 从对话历史里反查「每张卡出卡那一刻所带的对话照片」URL → Map<cardId, photoUrl>。
 *
 * 为什么需要它：buildInheritedPhotoReference 只在「发照片→出卡」的当下挂图，
 * 历史老卡（功能上线前生成的、或云端早存的故事）名下并没有这条 reference 视觉锚。
 * 这个函数把卡片和它的来源照片重新配上对，供 reconcileInheritedPhotos 给老卡补挂。
 *
 * 兼容两种消息落库形态：
 *   1. 归档态：同一条消息上既有 photoUrl 又有 spawnedCardId（normalizeChatMessages 配过对）；
 *   2. 实时态：用户「发图」消息在前、助手「出卡」回复在后，spawnedCardId 落在助手那条。
 * 对实时态，从带 spawnedCardId 的消息往回找本轮最近一条带图的用户消息；
 * 一旦跨过一条「没带图的用户发言」就停手——那已经是上一轮，不能张冠李戴。
 */
export function buildCardPhotoMap(
  messages: ReadonlyArray<
    Pick<ChatMessage, 'role' | 'photoUrl' | 'spawnedCardId'>
  >,
): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg.spawnedCardId) continue;
    let photo = msg.photoUrl; // 归档态：同条消息自带图
    if (!photo) {
      // 实时态：回看本轮最近一条带图的用户消息
      for (let j = i - 1; j >= 0; j--) {
        const prev = messages[j];
        if (prev.photoUrl) {
          photo = prev.photoUrl;
          break;
        }
        if (prev.role === 'user') break; // 跨过一条无图的用户发言＝已到上一轮，停
      }
    }
    if (photo) map.set(msg.spawnedCardId, photo);
  }
  return map;
}

/**
 * 给「有对话照片来源、但还没挂上 reference 视觉锚」的卡补挂继承图（老卡兜底）。
 *
 * 幂等：已经有 source==='reference' 视觉锚的卡一律跳过，避免和实时路径
 * （buildInheritedPhotoReference）重复挂图。所以新卡走实时路径、老卡走这里，互不打架。
 *
 * 返回值约定：有补挂时返回「原数组 + 新增」的新数组；没有任何补挂时**原样返回入参引用**，
 * 方便调用方用引用比较决定要不要 setState（没变就不必触发多余的渲染/落库）。
 *
 * 注意一个已知边角：若用户**手动删掉**某卡的继承图，下次加载这里会再次补挂（"复活"）。
 * 因为来源照片仍在对话历史里、卡上又没了 reference 视觉锚，配对就又成立了。
 * 当前阶段（照片即混合素材，用户极少主动删）可接受；要彻底根治需加一次性墓碑标记，另议。
 */
export function reconcileInheritedPhotos(params: {
  /** 当前画布上的全部视觉锚（含实时路径已挂的 reference 和美术 Agent 的 riff）。 */
  visualCanvasItems: VisualCanvasItem[];
  /** 当前故事的全部卡片。 */
  cards: ReadonlyArray<Pick<StoryCard, 'id'>>;
  /** buildCardPhotoMap 的产物：cardId → 来源照片 URL。 */
  cardPhotoMap: ReadonlyMap<string, string>;
  /** 生成视觉锚 id，通常来自 () => newId('visual')。 */
  makeId: () => string;
  /** 创建时间戳，通常来自 Date.now()。 */
  now: number;
}): VisualCanvasItem[] {
  const { visualCanvasItems, cards, cardPhotoMap, makeId, now } = params;
  // 已经挂过 reference 的卡：跳过，幂等去重。
  const cardsWithReference = new Set(
    visualCanvasItems
      .filter(item => item.source === 'reference' && item.cardId)
      .map(item => item.cardId as string),
  );
  const additions: VisualCanvasItem[] = [];
  for (const card of cards) {
    const photo = cardPhotoMap.get(card.id);
    if (!photo || cardsWithReference.has(card.id)) continue;
    const item = buildInheritedPhotoReference({
      photoUrlForStore: photo,
      spawnedCardId: card.id,
      existingCount: visualCanvasItems.length + additions.length, // 错开摆放
      id: makeId(),
      createdAt: now,
    });
    if (item) additions.push(item);
  }
  return additions.length
    ? [...visualCanvasItems, ...additions]
    : visualCanvasItems; // 没补挂就原样返回，调用方好做引用比较
}
