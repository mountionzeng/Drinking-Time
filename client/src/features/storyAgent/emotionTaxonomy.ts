/**
 * 情绪分类参考表 — Plutchik 8 基本情绪骨架 + 中文生活化皮肤
 *
 * 三层结构：
 *   第一层：大类（8 基本情绪）— 用户界面展示
 *   第二层：子类（每大类 5-8 个）— 用户界面展示
 *   第三层：细粒度变体（口语化表达）— Agent 内部匹配用
 *
 * 每个子类携带：
 *   - 中文名 / 英文键
 *   - 心理学成因线索（Agent 用来做理性分析）
 *   - 影视转化提示（怎么拍出这种情绪）
 *   - 叙事弧光位置（这种情绪常出现在故事的哪个阶段）
 *   - 强度范围描述
 *
 * 额外维度：
 *   - 对立情绪映射（Plutchik 对称轴）
 *   - 混合情绪组合（两种基本情绪叠加产生的复合情绪）
 */

// ─── 类型定义 ───────────────────────────────────────────

/** 第三层：细粒度变体 — Agent 内部用，贴近真实对话的口语表达 */
export interface EmotionVariant {
  /** 口语化表达，如「说不上来的空」 */
  label: string;
  /** 对应的情绪强度：1=微弱 2=中等 3=强烈 4=压倒性 */
  intensity: 1 | 2 | 3 | 4;
}

/** 第二层：子类 — 用户界面可见 */
export interface EmotionSubcategory {
  /** 英文键，用于代码引用和 StoryCard.emotion 字段存储 */
  key: string;
  /** 中文名，用户界面展示 */
  label: string;
  /** 一句话释义 */
  description: string;
  /** 心理学成因线索 — Agent 做「科学分析式共情」的弹药 */
  causalThread: string;
  /** 常见触发场景 — 帮助 Agent 识别对话中的情绪信号 */
  triggerScenes: string[];
  /** 影视转化提示 — 怎么把这种情绪拍出来 */
  cinematicHint: string;
  /** 叙事弧光位置 — 这种情绪常出现在故事的哪个节拍 */
  narrativeArc: '开场' | '起势' | '转折' | '高潮' | '收束' | '余韵';
  /** 第三层：口语化变体，按强度排列 */
  variants: EmotionVariant[];
}

/** 第一层：大类 — Plutchik 8 基本情绪 */
export interface EmotionCategory {
  /** 英文键 */
  key: string;
  /** 中文名 */
  label: string;
  /** 对立情绪的英文键（Plutchik 对称轴） */
  opposite: string;
  /** 该大类下的所有子类 */
  subcategories: EmotionSubcategory[];
}

/** 混合情绪 — 两种基本情绪叠加产生的复合情绪 */
export interface MixedEmotion {
  /** 英文键 */
  key: string;
  /** 中文名 */
  label: string;
  /** 组成成分：两个基本情绪的英文键 */
  components: [string, string];
  /** 一句话释义 */
  description: string;
  /** 影视转化提示 */
  cinematicHint: string;
  /** 口语化变体 */
  variants: EmotionVariant[];
}

// ─── 8 大基本情绪 ───────────────────────────────────────

export const EMOTION_CATEGORIES: EmotionCategory[] = [

  // ━━━ 1. 喜 (Joy) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'joy',
    label: '喜',
    opposite: 'sadness',
    subcategories: [
      {
        key: 'ecstasy',
        label: '狂喜',
        description: '强烈到无法自持的快乐',
        causalThread: '多巴胺大量释放——通常由长期压抑后的突然解放、或超出预期的好消息触发',
        triggerScenes: ['中奖', '录取通知', '久别重逢', '绝处逢生'],
        cinematicHint: '手持摇晃镜头 + 过曝光 + 快速剪辑，或慢动作捕捉笑到失控的瞬间',
        narrativeArc: '高潮',
        variants: [
          { label: '高兴疯了', intensity: 4 },
          { label: '乐得找不着北', intensity: 4 },
          { label: '整个人都在发光', intensity: 3 },
        ],
      },
      {
        key: 'contentment',
        label: '满足',
        description: '平静的、不需要更多的快乐',
        causalThread: '需求被充分满足后的内啡肽平衡——安全感和掌控感的叠加',
        triggerScenes: ['吃饱后靠着椅背', '完成一件事', '热水澡后', '和猫待着'],
        cinematicHint: '固定机位长镜头 + 暖色调 + 环境音放大（风声、虫鸣）',
        narrativeArc: '收束',
        variants: [
          { label: '挺好的', intensity: 1 },
          { label: '刚刚好', intensity: 2 },
          { label: '什么都不缺', intensity: 3 },
        ],
      },
      {
        key: 'delight',
        label: '惊喜',
        description: '意料之外的小确幸',
        causalThread: '预期违背的正向版本——大脑奖赏回路对"比预期好"的反应',
        triggerScenes: ['收到意外礼物', '发现藏起来的零食', '偶遇老朋友', '彩虹'],
        cinematicHint: '推镜头到面部特写 + 瞳孔放大 + 配乐突然变明亮',
        narrativeArc: '起势',
        variants: [
          { label: '哎？还不错', intensity: 1 },
          { label: '没想到啊', intensity: 2 },
          { label: '天呐这也太好了', intensity: 3 },
        ],
      },
      {
        key: 'pride',
        label: '自豪',
        description: '对自身成就或身份的认同感',
        causalThread: '自我效能感确认——「我能做到」的信念被现实验证',
        triggerScenes: ['作品被认可', '孩子表现好', '帮到了别人', '克服了恐惧'],
        cinematicHint: '仰拍 + 逆光剪影 + 昂头动作 + 舒缓配乐渐强',
        narrativeArc: '高潮',
        variants: [
          { label: '还行吧（嘴角压不住）', intensity: 1 },
          { label: '这事儿我做到了', intensity: 2 },
          { label: '值了', intensity: 3 },
        ],
      },
      {
        key: 'playfulness',
        label: '俏皮',
        description: '轻松戏谑的快乐',
        causalThread: '安全感充裕时的探索本能——没有威胁时大脑允许"浪费"能量去玩',
        triggerScenes: ['和朋友互怼', '恶作剧', '模仿别人', '说冷笑话'],
        cinematicHint: '跳切 + 倾斜构图 + 轻快节奏 + 画外笑声',
        narrativeArc: '开场',
        variants: [
          { label: '皮一下', intensity: 1 },
          { label: '嘿嘿嘿', intensity: 2 },
          { label: '不闹不行', intensity: 3 },
        ],
      },
      {
        key: 'gratitude',
        label: '感恩',
        description: '意识到被善待时的温暖',
        causalThread: '社会交换感知——识别到自己获得了超出应得的善意，触发回馈冲动',
        triggerScenes: ['有人默默帮忙', '回忆父母付出', '陌生人的善意', '大病初愈'],
        cinematicHint: '柔焦 + 暖光 + 缓慢推近面部 + 眼眶泛红但在笑',
        narrativeArc: '收束',
        variants: [
          { label: '谢了啊', intensity: 1 },
          { label: '真的谢谢你', intensity: 2 },
          { label: '这辈子都记着', intensity: 4 },
        ],
      },
    ],
  },

  // ━━━ 2. 信 (Trust) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'trust',
    label: '信',
    opposite: 'disgust',
    subcategories: [
      {
        key: 'admiration',
        label: '仰慕',
        description: '对他人能力或品格的由衷敬佩',
        causalThread: '社会学习本能——大脑标记"值得模仿的对象"以提升自身生存策略',
        triggerScenes: ['看到高手操作', '听到某人的经历', '被老师的话点醒', '读到好文章'],
        cinematicHint: '低机位仰拍 + 浅景深虚化背景 + 人物发光感 + 舒缓弦乐',
        narrativeArc: '起势',
        variants: [
          { label: '厉害啊', intensity: 1 },
          { label: '真的服了', intensity: 2 },
          { label: '这种人怎么会存在', intensity: 3 },
        ],
      },
      {
        key: 'acceptance',
        label: '接纳',
        description: '不评判地包容现状',
        causalThread: '认知失调消解——放弃"应该如何"的执念，减少内耗',
        triggerScenes: ['承认自己的缺点', '接受分手', '不再和父母较劲', '和不完美和解'],
        cinematicHint: '固定宽镜头 + 人物坐下或放松肩膀的动作 + 长呼一口气的音效',
        narrativeArc: '收束',
        variants: [
          { label: '算了吧', intensity: 1 },
          { label: '这样也挺好', intensity: 2 },
          { label: '就这样吧，我接受', intensity: 3 },
        ],
      },
      {
        key: 'safety',
        label: '安心',
        description: '确认自己处于安全中的踏实感',
        causalThread: '依附系统激活——当"安全基地"（人/地/关系）被确认可靠时，皮质醇下降',
        triggerScenes: ['到家了', '有人接住了你', '确认对方没生气', '体检结果正常'],
        cinematicHint: '缓慢拉远镜头 + 暖色灯光 + 门关上的声音 + 肩膀松下来',
        narrativeArc: '余韵',
        variants: [
          { label: '还好', intensity: 1 },
          { label: '放心了', intensity: 2 },
          { label: '终于踏实了', intensity: 3 },
        ],
      },
      {
        key: 'loyalty',
        label: '忠诚',
        description: '对关系或信念的坚守',
        causalThread: '群体归属本能——长期合作博弈中"不背叛"策略的情感编码',
        triggerScenes: ['朋友遇到麻烦站出来', '坚持自己的选择', '不跟风', '守承诺'],
        cinematicHint: '对切镜头 + 眼神交流特写 + 握手/站在一起的构图',
        narrativeArc: '转折',
        variants: [
          { label: '我站你这边', intensity: 2 },
          { label: '说好的事不会变', intensity: 3 },
          { label: '你去哪我去哪', intensity: 4 },
        ],
      },
      {
        key: 'vulnerability',
        label: '信赖',
        description: '愿意在对方面前展露脆弱',
        causalThread: '催产素驱动的亲密连接——大脑判断"暴露弱点的收益大于风险"',
        triggerScenes: ['第一次说出秘密', '在对方面前哭', '承认不知道', '请求帮助'],
        cinematicHint: '特写 + 浅焦 + 声音变小 + 背景虚化到只剩两个人',
        narrativeArc: '转折',
        variants: [
          { label: '跟你说个事', intensity: 1 },
          { label: '我其实…', intensity: 2 },
          { label: '只有你知道', intensity: 3 },
        ],
      },
    ],
  },

  // ━━━ 3. 惧 (Fear) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'fear',
    label: '惧',
    opposite: 'anger',
    subcategories: [
      {
        key: 'terror',
        label: '恐惧',
        description: '面对直接威胁的极度害怕',
        causalThread: '杏仁核劫持——绕过理性直接触发战逃反应，身体先于思维做出反应',
        triggerScenes: ['差点出车祸', '深夜异响', '被人跟踪', '高空往下看'],
        cinematicHint: '荷兰角 + 快速推近 + 心跳音效 + 画面抖动 + 呼吸声放大',
        narrativeArc: '高潮',
        variants: [
          { label: '腿软了', intensity: 3 },
          { label: '魂都没了', intensity: 4 },
          { label: '脑子一片空白', intensity: 4 },
        ],
      },
      {
        key: 'anxiety',
        label: '焦虑',
        description: '对不确定未来的持续担忧',
        causalThread: '前额叶过度模拟——大脑不停演练"可能出错的场景"却无法得出结论',
        triggerScenes: ['等体检结果', '面试前夜', '交完作业开始怀疑', '贷款还不上'],
        cinematicHint: '浅焦来回切换 + 时钟声 + 手指反复摩擦的特写 + 画面微微不稳',
        narrativeArc: '起势',
        variants: [
          { label: '心里没底', intensity: 1 },
          { label: '老想着这事', intensity: 2 },
          { label: '睡不着一直转', intensity: 3 },
          { label: '喘不上气', intensity: 4 },
        ],
      },
      {
        key: 'insecurity',
        label: '不安',
        description: '对自身位置或关系的不确定感',
        causalThread: '社会比较机制过载——持续监测自己在群体中的排位，发现可能下滑',
        triggerScenes: ['新环境不认识人', '对方没回消息', '同事升职自己没有', '被排除在外'],
        cinematicHint: '人物在画面边缘 + 大量留白 + 环境声压过人声 + 目光游移',
        narrativeArc: '起势',
        variants: [
          { label: '好像哪里不对', intensity: 1 },
          { label: '我是不是多余的', intensity: 2 },
          { label: '他们是不是不要我了', intensity: 3 },
        ],
      },
      {
        key: 'dread',
        label: '预感不祥',
        description: '知道坏事要来但无法阻止的沉重感',
        causalThread: '模式识别系统报警——潜意识整合了多个微弱信号，得出"要出事"的判断',
        triggerScenes: ['老板说"来一下"', '体检报告写着复查', '对方语气不对', '暴风雨前的安静'],
        cinematicHint: '缓慢推轨 + 低频嗡鸣 + 色调逐渐变冷 + 人物背影',
        narrativeArc: '转折',
        variants: [
          { label: '总觉得要出事', intensity: 2 },
          { label: '心悬着放不下来', intensity: 3 },
          { label: '来了，果然来了', intensity: 3 },
        ],
      },
      {
        key: 'helplessness',
        label: '无力',
        description: '知道该做什么但完全做不到',
        causalThread: '习得性无助——反复经历"努力无效"后，行动系统关闭',
        triggerScenes: ['看着亲人生病', '改不了的制度', '说了没人听', '眼睁睁看着错过'],
        cinematicHint: '俯拍 + 人物缩成一团 + 环境巨大 + 静音或极低频',
        narrativeArc: '转折',
        variants: [
          { label: '没办法', intensity: 2 },
          { label: '什么都做不了', intensity: 3 },
          { label: '手伸出去够不到', intensity: 4 },
        ],
      },
      {
        key: 'shame',
        label: '羞耻',
        description: '觉得自己整个人有问题，想消失',
        causalThread: '社会排斥预警——不是"我做错了事"而是"我就是错的"，触发隐藏本能',
        triggerScenes: ['当众出丑', '秘密被揭穿', '被嘲笑', '达不到期望'],
        cinematicHint: '俯拍 + 人物低头 + 周围人的目光线条汇聚 + 声音逐渐消失',
        narrativeArc: '转折',
        variants: [
          { label: '找个地缝钻进去', intensity: 3 },
          { label: '别看我', intensity: 2 },
          { label: '我怎么这样', intensity: 3 },
          { label: '想消失', intensity: 4 },
        ],
      },
    ],
  },

  // ━━━ 4. 惊 (Surprise) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'surprise',
    label: '惊',
    opposite: 'anticipation',
    subcategories: [
      {
        key: 'amazement',
        label: '震撼',
        description: '被完全超出认知框架的事物击中',
        causalThread: '图式崩塌——现有认知模型无法容纳眼前信息，大脑进入"重写"模式',
        triggerScenes: ['第一次看到极光', '得知一个颠覆性真相', '目睹奇迹', '看到宇宙照片'],
        cinematicHint: '超广角 + 缓慢推近面部 + 瞳孔放大特写 + 配乐突然停止后渐强',
        narrativeArc: '高潮',
        variants: [
          { label: '我靠', intensity: 3 },
          { label: '不可能吧', intensity: 3 },
          { label: '世界观碎了', intensity: 4 },
        ],
      },
      {
        key: 'confusion',
        label: '困惑',
        description: '信息不完整时的迷茫感',
        causalThread: '模式匹配失败——大脑在已知模板中找不到对应项，不确定性令人不适',
        triggerScenes: ['听不懂对方的话', '规则突然变了', '明明做对了却错了', '不知道自己怎么了'],
        cinematicHint: '失焦 + 360度环绕 + 环境音混杂 + 人物原地不动',
        narrativeArc: '起势',
        variants: [
          { label: '啊？', intensity: 1 },
          { label: '等等，什么意思', intensity: 2 },
          { label: '完全搞不懂', intensity: 3 },
        ],
      },
      {
        key: 'disbelief',
        label: '难以置信',
        description: '理智告诉你是真的但情感拒绝接受',
        causalThread: '认知-情感断裂——前额叶确认了信息但边缘系统拒绝更新，出现短暂的现实感丧失',
        triggerScenes: ['亲人去世的消息', '中大奖', '对方突然提分手', '诊断结果'],
        cinematicHint: '定格 + 环境声消失 + 只有心跳 + 面部极近特写 + 瞳孔微颤',
        narrativeArc: '转折',
        variants: [
          { label: '你说什么？', intensity: 2 },
          { label: '不是吧', intensity: 3 },
          { label: '这不是真的', intensity: 4 },
        ],
      },
      {
        key: 'realization',
        label: '顿悟',
        description: '碎片突然连成线的豁然开朗',
        causalThread: '潜意识后台处理完毕——分散的信息碎片被整合，答案突然浮出水面',
        triggerScenes: ['忽然想通了', '看到关联', '理解了对方为什么那样', '多年后理解父母'],
        cinematicHint: '画面从模糊到清晰 + 光线突然变亮 + 人物抬头动作 + 单音钢琴',
        narrativeArc: '转折',
        variants: [
          { label: '哦——', intensity: 1 },
          { label: '原来如此', intensity: 2 },
          { label: '我终于懂了', intensity: 3 },
        ],
      },
      {
        key: 'startle',
        label: '吓一跳',
        description: '突发刺激的瞬间反射',
        causalThread: '惊吓反射——脑干直接处理的 50 毫秒自动反应，比恐惧更快更短暂',
        triggerScenes: ['背后拍肩', '突然的巨响', '看到虫子', '消息弹窗跳出来'],
        cinematicHint: '突然切入 + 画面抖动 + 尖锐音效 + 快速拉远',
        narrativeArc: '开场',
        variants: [
          { label: '哎呀', intensity: 1 },
          { label: '吓死我了', intensity: 2 },
          { label: '心脏都要跳出来了', intensity: 3 },
        ],
      },
    ],
  },

  // ━━━ 5. 哀 (Sadness) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'sadness',
    label: '哀',
    opposite: 'joy',
    subcategories: [
      {
        key: 'grief',
        label: '悲恸',
        description: '失去重要事物后的深度悲伤',
        causalThread: '依附断裂——大脑的社交连接图谱中一个节点永久消失，系统反复搜索无果',
        triggerScenes: ['亲人离世', '宠物死亡', '友谊终结', '青春结束'],
        cinematicHint: '长镜头 + 雨/灰色调 + 人物独坐 + 环境空旷 + 沉默',
        narrativeArc: '高潮',
        variants: [
          { label: '心被掏空了', intensity: 4 },
          { label: '世界塌了一角', intensity: 4 },
          { label: '再也不会有了', intensity: 3 },
        ],
      },
      {
        key: 'loss',
        label: '失落',
        description: '期望落空后的空洞感',
        causalThread: '预期违背的负向版本——大脑已经预演了美好结果，现实回撤时产生"奖赏预测误差"',
        triggerScenes: ['没被选上', '计划泡汤', '朋友爽约', '考砸了'],
        cinematicHint: '人物在窗前 + 外面热闹里面安静 + 手里握着什么又放下',
        narrativeArc: '转折',
        variants: [
          { label: '好像少了点什么', intensity: 1 },
          { label: '白期待了', intensity: 2 },
          { label: '说不上来的空', intensity: 3 },
        ],
      },
      {
        key: 'heartache',
        label: '心疼',
        description: '看到他人痛苦时自己的共鸣痛',
        causalThread: '镜像神经元激活——他人的痛苦在观察者脑中产生"模拟体验"',
        triggerScenes: ['孩子哭了', '看到流浪动物', '朋友被欺负', '老人独自吃饭'],
        cinematicHint: '过肩镜头看向对方 + 手伸出又缩回 + 眼眶红但忍住',
        narrativeArc: '起势',
        variants: [
          { label: '看着就难受', intensity: 2 },
          { label: '心揪着', intensity: 3 },
          { label: '比自己疼还疼', intensity: 4 },
        ],
      },
      {
        key: 'nostalgia',
        label: '怀念',
        description: '对过去美好时光的温柔追忆',
        causalThread: '情景记忆被感官线索触发——气味/声音/画面激活海马体中的完整场景回放',
        triggerScenes: ['听到老歌', '闻到某种味道', '翻到旧照片', '回到老地方'],
        cinematicHint: '柔焦 + 暖色偏黄 + 画面渐隐叠化 + 旧物特写 + 钢琴',
        narrativeArc: '余韵',
        variants: [
          { label: '想起以前了', intensity: 1 },
          { label: '那时候真好', intensity: 2 },
          { label: '回不去了', intensity: 3 },
        ],
      },
      {
        key: 'loneliness',
        label: '孤独',
        description: '身处人群中仍然觉得没有连接',
        causalThread: '社交需求缺口——人类作为群居物种，社交隔离触发与身体疼痛相同的脑区',
        triggerScenes: ['一个人过节', '聚会中插不上话', '搬到新城市', '朋友都结婚了'],
        cinematicHint: '远景 + 人物渺小 + 空旷空间 + 单一光源 + 低频环境音',
        narrativeArc: '起势',
        variants: [
          { label: '没人说话', intensity: 1 },
          { label: '好像被世界忘了', intensity: 2 },
          { label: '一个人太久了', intensity: 3 },
        ],
      },
      {
        key: 'regret',
        label: '遗憾',
        description: '对已发生之事的"要是当初"',
        causalThread: '反事实思维——大脑模拟另一条时间线，对比产生"本可以"的痛感',
        triggerScenes: ['没有告别', '错过的机会', '说了不该说的话', '来不及了'],
        cinematicHint: '闪回 + 慢动作 + 画面裂纹/碎片化 + 人物站在分岔路口',
        narrativeArc: '收束',
        variants: [
          { label: '要是当时…', intensity: 2 },
          { label: '早知道', intensity: 2 },
          { label: '这辈子最后悔的事', intensity: 4 },
        ],
      },
    ],
  },

  // ━━━ 6. 厌 (Disgust) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'disgust',
    label: '厌',
    opposite: 'trust',
    subcategories: [
      {
        key: 'loathing',
        label: '厌恶',
        description: '对道德败坏行为的强烈排斥',
        causalThread: '道德免疫系统——和生理厌恶共用脑区（岛叶），对社会"污染"的排斥反应',
        triggerScenes: ['看到欺凌', '背叛', '虚伪的人', '不公正'],
        cinematicHint: '广角变形 + 色调偏绿/黄 + 人物后退或转头的动作 + 不和谐音效',
        narrativeArc: '转折',
        variants: [
          { label: '恶心', intensity: 3 },
          { label: '这种人怎么活着', intensity: 4 },
          { label: '不想再看到', intensity: 3 },
        ],
      },
      {
        key: 'contempt',
        label: '鄙夷',
        description: '居高临下的不屑',
        causalThread: '层级感知——判定对方在能力或道德维度上"不如自己"，维护自我优越感',
        triggerScenes: ['看到抄袭', '有人不守规矩', '自以为是的人', '明知故犯'],
        cinematicHint: '俯拍对方 + 仰拍自己 + 嘴角单侧上扬特写 + 冷色调',
        narrativeArc: '起势',
        variants: [
          { label: '切', intensity: 1 },
          { label: '就这？', intensity: 2 },
          { label: '不值一提', intensity: 3 },
        ],
      },
      {
        key: 'boredom',
        label: '无聊',
        description: '找不到意义或刺激的空转状态',
        causalThread: '注意力系统饥饿——大脑需要适度刺激来维持唤醒水平，刺激不足时产生不适',
        triggerScenes: ['无聊的会议', '等待', '重复劳动', '周末不知道干嘛'],
        cinematicHint: '固定机位 + 时间流逝 + 时钟/滴水 + 人物反复看手机/叹气',
        narrativeArc: '开场',
        variants: [
          { label: '好无聊啊', intensity: 1 },
          { label: '干点啥好', intensity: 2 },
          { label: '活着没意思', intensity: 3 },
        ],
      },
      {
        key: 'aversion',
        label: '抵触',
        description: '本能地想躲开某件事',
        causalThread: '回避动机激活——过去的负面经验形成条件反射，自动触发远离行为',
        triggerScenes: ['不想接某人电话', '看到体检单', '想到周一', '被催婚'],
        cinematicHint: '人物在门口犹豫 + 手放在门把上不推 + 画面色温变冷',
        narrativeArc: '起势',
        variants: [
          { label: '别提了', intensity: 1 },
          { label: '不想碰这事', intensity: 2 },
          { label: '一想到就烦', intensity: 3 },
        ],
      },
      {
        key: 'disappointment',
        label: '失望',
        description: '对某人行为的期望被辜负',
        causalThread: '信任折价——对方的行为低于你给予的信用额度，导致关系估值下调',
        triggerScenes: ['说好的没做到', '发现对方说谎', '偶像塌房', '被敷衍'],
        cinematicHint: '两人画面 + 距离逐渐拉远 + 对方虚化 + 轻微摇头',
        narrativeArc: '转折',
        variants: [
          { label: '算了', intensity: 1 },
          { label: '原来你是这种人', intensity: 2 },
          { label: '不想再信了', intensity: 3 },
        ],
      },
    ],
  },

  // ━━━ 7. 怒 (Anger) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'anger',
    label: '怒',
    opposite: 'fear',
    subcategories: [
      {
        key: 'rage',
        label: '暴怒',
        description: '完全失控的愤怒',
        causalThread: '前额叶抑制功能被压倒——愤怒积累超过皮层控制阈值，边缘系统全面接管',
        triggerScenes: ['被冤枉还不能解释', '反复被侵犯底线', '看到孩子被欺负', '忍无可忍'],
        cinematicHint: '手持剧烈晃动 + 红色滤镜 + 快速推近 + 打碎东西的音效 + 失焦',
        narrativeArc: '高潮',
        variants: [
          { label: '气炸了', intensity: 4 },
          { label: '手都在抖', intensity: 4 },
          { label: '忍不住了', intensity: 3 },
        ],
      },
      {
        key: 'frustration',
        label: '挫败',
        description: '努力了但被阻挡的恼火',
        causalThread: '目标受阻理论——行动趋向目标的路径被堵死，能量无处释放转化为攻击性',
        triggerScenes: ['改了十遍还不过', '电脑卡死', '说了没人听', '怎么都学不会'],
        cinematicHint: '重复动作蒙太奇 + 逐渐加速 + 最后停下来喘气 + 拍桌子',
        narrativeArc: '起势',
        variants: [
          { label: '烦死了', intensity: 2 },
          { label: '到底要怎样', intensity: 3 },
          { label: '不干了', intensity: 3 },
        ],
      },
      {
        key: 'indignation',
        label: '义愤',
        description: '对不公正的正义怒火',
        causalThread: '公平感系统被触发——人类天生有"公平探测器"，不公正激活与疼痛相同的脑区',
        triggerScenes: ['看到弱者被欺负', '不合理的规则', '同工不同酬', '明明错的人不受罚'],
        cinematicHint: '正面特写 + 握拳 + 站起来的动作 + 正义配乐渐强',
        narrativeArc: '转折',
        variants: [
          { label: '这不公平', intensity: 2 },
          { label: '凭什么', intensity: 3 },
          { label: '不能就这么算了', intensity: 3 },
        ],
      },
      {
        key: 'resentment',
        label: '怨恨',
        description: '压抑的、发酵的怒意',
        causalThread: '未表达的愤怒被反刍系统循环加工——每次回想都强化"不公正感"的神经通路',
        triggerScenes: ['一直付出没被看到', '被偏心对待', '旧账翻出来', '表面和气心里记着'],
        cinematicHint: '正反打 + 表面微笑但眼神不动 + 暗部打光 + 低频持续嗡鸣',
        narrativeArc: '起势',
        variants: [
          { label: '嘴上没说心里记着', intensity: 2 },
          { label: '这笔账迟早算', intensity: 3 },
          { label: '凭什么我要忍', intensity: 3 },
        ],
      },
      {
        key: 'irritation',
        label: '烦躁',
        description: '持续的低度恼火',
        causalThread: '感官过载或认知资源耗竭——刺激超过当前处理容量，阈值降低导致一点小事就炸',
        triggerScenes: ['噪音不停', '被连续打断', '天热挤公交', '又出bug了'],
        cinematicHint: '频繁跳切 + 声音刺耳 + 抓头发/揉太阳穴的动作 + 快节奏',
        narrativeArc: '开场',
        variants: [
          { label: '有点烦', intensity: 1 },
          { label: '别烦我', intensity: 2 },
          { label: '再说一句我就爆了', intensity: 3 },
        ],
      },
      {
        key: 'jealousy',
        label: '嫉妒',
        description: '看到别人有而自己没有的刺痛',
        causalThread: '社会比较引发的资源焦虑——不是真的想要对方的东西，是"我不如别人"的痛在作祟',
        triggerScenes: ['朋友圈晒幸福', '同龄人比自己成功', '喜欢的人对别人好', '别人天生就有的'],
        cinematicHint: '分屏对比 + 一边鲜亮一边暗淡 + 人物独自刷手机 + 画面扭曲',
        narrativeArc: '起势',
        variants: [
          { label: '酸了', intensity: 1 },
          { label: '凭什么是他不是我', intensity: 2 },
          { label: '不敢看又忍不住看', intensity: 3 },
        ],
      },
    ],
  },

  // ━━━ 8. 期 (Anticipation) ━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    key: 'anticipation',
    label: '期',
    opposite: 'surprise',
    subcategories: [
      {
        key: 'eagerness',
        label: '期待',
        description: '对即将到来的好事的兴奋等待',
        causalThread: '多巴胺预释放——大脑对"即将获得奖赏"的预期本身就是奖赏，有时比真正得到更强',
        triggerScenes: ['倒计时', '快递在路上', '明天就见面了', '马上就轮到我了'],
        cinematicHint: '时间蒙太奇 + 看表/看窗外 + 画面逐渐变亮 + 节奏加速',
        narrativeArc: '开场',
        variants: [
          { label: '快了快了', intensity: 2 },
          { label: '等不及了', intensity: 3 },
          { label: '心都要飞出去了', intensity: 4 },
        ],
      },
      {
        key: 'hope',
        label: '希望',
        description: '在困境中相信会好起来的信念',
        causalThread: '认知重评的正向版本——前额叶选择性关注积极可能性，维持行动动力',
        triggerScenes: ['治疗有起色', '低谷中看到机会', '有人伸出手', '春天来了'],
        cinematicHint: '从暗到亮的光线变化 + 人物抬头看天 + 种子/嫩芽意象 + 缓慢推近',
        narrativeArc: '转折',
        variants: [
          { label: '说不定呢', intensity: 1 },
          { label: '还有机会', intensity: 2 },
          { label: '一定会好的', intensity: 3 },
        ],
      },
      {
        key: 'curiosity',
        label: '好奇',
        description: '想知道、想探索的冲动',
        causalThread: '信息缺口理论——大脑检测到"知道一点但不够"的状态，驱动信息搜寻行为',
        triggerScenes: ['听到一半的故事', '没去过的地方', '奇怪的现象', '对方欲言又止'],
        cinematicHint: '跟随镜头 + 人物靠近/翻看 + 画面逐渐清晰 + 轻快弦乐',
        narrativeArc: '开场',
        variants: [
          { label: '然后呢？', intensity: 1 },
          { label: '这是怎么回事', intensity: 2 },
          { label: '非知道不可', intensity: 3 },
        ],
      },
      {
        key: 'determination',
        label: '决心',
        description: '下定决心要做到的坚定感',
        causalThread: '目标承诺效应——公开或内心的承诺激活一致性驱力，放弃的心理代价变高',
        triggerScenes: ['受够了要改变', '立下承诺', '最后一次机会', '为了某个人'],
        cinematicHint: '正面中景 + 光线从侧面打 + 人物站直 + 拳头握紧 + 沉稳低音',
        narrativeArc: '转折',
        variants: [
          { label: '这次一定', intensity: 2 },
          { label: '我说到做到', intensity: 3 },
          { label: '就算死也要', intensity: 4 },
        ],
      },
      {
        key: 'yearning',
        label: '渴望',
        description: '对缺失之物的深度想要',
        causalThread: '匮乏驱动——大脑对长期未满足需求的持续信号，和成瘾共享部分神经回路',
        triggerScenes: ['想念一个人', '想要被理解', '想改变现状', '想回到某个时刻'],
        cinematicHint: '远景 + 人物朝远方/光源方向 + 手伸出但够不到 + 悠长弦乐',
        narrativeArc: '起势',
        variants: [
          { label: '好想', intensity: 2 },
          { label: '做梦都在想', intensity: 3 },
          { label: '缺了就不完整', intensity: 4 },
        ],
      },
      {
        key: 'vigilance',
        label: '警觉',
        description: '高度注意环境变化的紧绷状态',
        causalThread: '去甲肾上腺素上调——大脑切换到"扫描模式"，对微弱信号的检测灵敏度提高',
        triggerScenes: ['独自走夜路', '谈判桌上', '对方态度变了', '总觉得被盯着'],
        cinematicHint: '环视镜头 + 瞳孔特写 + 环境音被放大 + 心跳声 + 画面锐利',
        narrativeArc: '起势',
        variants: [
          { label: '注意到了', intensity: 1 },
          { label: '不太对劲', intensity: 2 },
          { label: '每根神经都绷着', intensity: 3 },
        ],
      },
    ],
  },
];

// ─── 混合情绪 ───────────────────────────────────────────
// Plutchik 理论：相邻基本情绪组合产生「初级混合情绪」

export const MIXED_EMOTIONS: MixedEmotion[] = [
  {
    key: 'love',
    label: '爱',
    components: ['joy', 'trust'],
    description: '快乐与信任的叠加——愿意为对方的幸福投入自己的资源',
    cinematicHint: '暖色 + 双人构图 + 浅焦只有彼此清晰 + 缓慢靠近的运动',
    variants: [
      { label: '喜欢', intensity: 1 },
      { label: '离不开', intensity: 2 },
      { label: '心里全是你', intensity: 3 },
      { label: '愿意为你做任何事', intensity: 4 },
    ],
  },
  {
    key: 'submission',
    label: '顺从',
    components: ['trust', 'fear'],
    description: '信任与恐惧并存——服从权威是因为相信服从比反抗安全',
    cinematicHint: '俯拍 + 人物低头 + 权威人物高大的影子覆盖 + 沉重脚步声',
    variants: [
      { label: '听你的', intensity: 1 },
      { label: '不敢说不', intensity: 2 },
      { label: '你说什么就是什么', intensity: 3 },
    ],
  },
  {
    key: 'awe',
    label: '敬畏',
    components: ['fear', 'surprise'],
    description: '恐惧与惊讶的交织——面对远超自己的力量时的震颤',
    cinematicHint: '极端仰拍 + 广角变形 + 人物渺小 + 低频震动 + 宏大配乐',
    variants: [
      { label: '好厉害', intensity: 1 },
      { label: '太壮观了', intensity: 2 },
      { label: '人类在自然面前太小了', intensity: 3 },
    ],
  },
  {
    key: 'disapproval',
    label: '不以为然',
    components: ['surprise', 'sadness'],
    description: '意外与失望的混合——没想到会这样，而且很失望',
    cinematicHint: '定格 + 微微摇头 + 叹气声 + 转身走开',
    variants: [
      { label: '没想到你会这样', intensity: 2 },
      { label: '太让人失望了', intensity: 3 },
      { label: '我看错你了', intensity: 3 },
    ],
  },
  {
    key: 'remorse',
    label: '懊悔',
    components: ['sadness', 'disgust'],
    description: '悲伤与自我厌恶的叠加——对自己做过的事感到深深的后悔和嫌恶',
    cinematicHint: '镜子特写 + 人物不敢看自己 + 手反复搓洗 + 暗调',
    variants: [
      { label: '我怎么会做这种事', intensity: 2 },
      { label: '对不起', intensity: 2 },
      { label: '恨自己', intensity: 3 },
      { label: '如果时间能倒流', intensity: 4 },
    ],
  },
  {
    key: 'contemptMixed',
    label: '蔑视',
    components: ['disgust', 'anger'],
    description: '厌恶与愤怒的混合——不仅排斥还想攻击',
    cinematicHint: '斜侧面拍 + 嘴角下撇 + 眼神如刀 + 冷色硬光',
    variants: [
      { label: '你算什么', intensity: 2 },
      { label: '垃圾', intensity: 3 },
      { label: '不配', intensity: 3 },
    ],
  },
  {
    key: 'aggressiveness',
    label: '攻击性',
    components: ['anger', 'anticipation'],
    description: '愤怒与预期的叠加——不是失控而是有目标的进攻',
    cinematicHint: '低角度推进 + 人物大步走来 + 拳头/武器特写 + 鼓点加速',
    variants: [
      { label: '等着瞧', intensity: 2 },
      { label: '我要让你付出代价', intensity: 3 },
      { label: '来，试试', intensity: 3 },
    ],
  },
  {
    key: 'optimism',
    label: '乐观',
    components: ['anticipation', 'joy'],
    description: '期待与快乐的组合——不仅现在开心，还相信未来会更好',
    cinematicHint: '仰角拍天空 + 明亮色调 + 人物在路上走 + 轻快配乐',
    variants: [
      { label: '会好的', intensity: 1 },
      { label: '我有种预感', intensity: 2 },
      { label: '最好的还没来', intensity: 3 },
    ],
  },
];

// ─── 工具函数 ───────────────────────────────────────────

/** 根据英文 key 查找子类详情（Agent 匹配用） */
export function findSubcategory(key: string): {
  category: EmotionCategory;
  subcategory: EmotionSubcategory;
} | null {
  for (const cat of EMOTION_CATEGORIES) {
    const sub = cat.subcategories.find(s => s.key === key);
    if (sub) return { category: cat, subcategory: sub };
  }
  return null;
}

/** 根据中文标签模糊匹配（用户输入的口语可能不精确） */
export function matchByLabel(text: string): EmotionSubcategory[] {
  const results: EmotionSubcategory[] = [];
  for (const cat of EMOTION_CATEGORIES) {
    for (const sub of cat.subcategories) {
      // 匹配子类名
      if (sub.label.includes(text) || text.includes(sub.label)) {
        results.push(sub);
        continue;
      }
      // 匹配第三层变体的口语表达
      if (sub.variants.some(v => v.label.includes(text) || text.includes(v.label))) {
        results.push(sub);
      }
    }
  }
  return results;
}

/** 获取某情绪的对立情绪（Plutchik 对称轴） */
export function getOpposite(categoryKey: string): EmotionCategory | null {
  const cat = EMOTION_CATEGORIES.find(c => c.key === categoryKey);
  if (!cat) return null;
  return EMOTION_CATEGORIES.find(c => c.key === cat.opposite) ?? null;
}

/** 获取包含某基本情绪的所有混合情绪 */
export function getMixedEmotions(categoryKey: string): MixedEmotion[] {
  return MIXED_EMOTIONS.filter(m => m.components.includes(categoryKey));
}

/** 所有子类的扁平列表（用于下拉选择器等 UI 场景） */
export function getAllSubcategories(): Array<{
  categoryKey: string;
  categoryLabel: string;
} & EmotionSubcategory> {
  return EMOTION_CATEGORIES.flatMap(cat =>
    cat.subcategories.map(sub => ({
      categoryKey: cat.key,
      categoryLabel: cat.label,
      ...sub,
    })),
  );
}

/** 按叙事弧光位置分组（用于故事节拍推荐） */
export function groupByNarrativeArc(): Record<string, EmotionSubcategory[]> {
  const groups: Record<string, EmotionSubcategory[]> = {};
  for (const cat of EMOTION_CATEGORIES) {
    for (const sub of cat.subcategories) {
      if (!groups[sub.narrativeArc]) groups[sub.narrativeArc] = [];
      groups[sub.narrativeArc].push(sub);
    }
  }
  return groups;
}
