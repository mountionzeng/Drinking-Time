import { feedbackEditTargets, feedbackTrackNames } from "./feedbackEditTargets";

type Turn = { role: string; content: string };

// Optional intent recognition only. The main conversation model hears every medium.
const medium = "短视频|视频|短片|影片|片子|纪录片|音乐|歌曲|歌|曲子|配乐|音频|播客|文字|文章|书稿|故事|散文|诗|书信|信|绘本|插画|图片|海报|漫画|舞蹈|作品|东西";
const verbs = "制作|创作|整理成|生成|录制|做|拍|剪|写|画|作|谱|编|录";
const wish = "(?:(?:我|我们|咱们)?(?:想要|想|要|希望|准备|打算|决定)|(?:请)?帮我|请你|给我|麻烦你|咱们来|请)";
const request = new RegExp("^(?:" + wish + ")?\\s*(?:(?:用|把)[^，。！？；\\n]{1,60}?)?(?:" + verbs + ")[^。！？；\\n]{0,36}?(?:" + medium + ")", "u");
const bare = new RegExp("^(?:" + wish + ")?(?:" + verbs + ")(?:一?(?:个|条|段|支|首|篇|幅|张|部|些|点))?(?:小|短)?(" + medium + ")(?:试试|吧)?[。.！!\\s]*$","u");
const englishWork = /^(?:i(?:['’]d like| want| plan| decided) to|let['’]s|please|help me)\s+(?:make|create|write|film|compose|draw|produce)\b.*\b(?:video|film|music|song|track|podcast|story|book|piece|poem|poster|illustration|something)\b/iu;
const quoted = /[“「『"][^”」』"]*[”」』"]/gu;
const purposeQuestion = /(?:想让谁|想给谁|希望谁|留给谁|给谁(?:看|听|读)|希望.{0,15}(?:看完|听完|读完|记住)|用来做什么|为什么想做|想用.{0,10}做什么|用在什么场合|what.*(?:use|for|remember)|que voudriez-vous que les spectateurs retiennent|who.*(?:for|hear|see|read))/iu;

export function requestsCreativeWork(message: string) {
  const text = message.trim().replace(quoted, "…");
  if (englishWork.test(text)) return true;
  return text.split(/[。！？!?；;\n]/u).some(sentence => {
    if (/^(?:如果|假如|假设|要是|万一|听说|据说)/u.test(sentence.trim())) return false;
    const clauses = sentence.split(/[，,]/u);
    return clauses.some((clause, index) => {
      if (index && /(?:他|她|长辈|朋友|委托人|甲方)(?:当时)?(?:说|问|表示)[：:\s]*$/u.test(clauses[index - 1])) return false;
      const words = clause.trim().replace(/^(?:这次|现在|那就|其实|所以|接下来)/u, "").trim();
      if (/^(?:做|拍|写|画|剪|录|制作)(?:了|过|完了)|(?:的人|的经历|的过程)(?:是|里|中|让)/u.test(words)) return false;
      if (/^(?:帮我|请你|我想)(?:把.{1,36})?写(?:出来|下来|成一段)/u.test(words)) return true;
      if (!request.test(words)) return false;
      return !/(?:的时候|时我|时他|那天|让我想起|需要什么|怎么做|怎么办|意味着什么)|(?:过|过了|完了)[。！\s]*$/u.test(words);
    });
  });
}

/** A new-work aspiration belongs to conversation even in an editing workspace.
 * Requests about an existing target keep their normal review / generation path. */
export function discussesNewWork(message: string) {
  if (!/^(?:我(?:们)?|咱们)(?:想|希望|准备|打算)/u.test(message.trim()) || !requestsCreativeWork(message)) return false;
  return !/第\s*[\d零一二三四五六七八九十]+\s*镜|这(?:张图|一?帧|个镜头|段视频)|选中|整本书|全片|剪辑线|时间线|素材\s*#|图\s*#|直接生成|立即生成|现在就/u.test(message);
}

export function startsCreativeConversation(message: string, hasSource: boolean) {
  if (hasSource && /生成|渲染|render|generate/iu.test(message)) return false;
  return discussesNewWork(message) || (!hasSource && Boolean(initialPurposeQuestion(message)));
}

export function isPurposeReply(message: string, history: readonly Turn[]) {
  const recent = history.filter(turn => turn.content.trim()).slice(-2);
  if (recent.length !== 2 || recent[0].role !== "user" || !(requestsCreativeWork(recent[0].content) || requestsStoryFilm(recent[0].content)) ||
      recent[1].role !== "assistant" || !purposeQuestion.test(recent[1].content)) return false;
  return Boolean(message.trim()) && !/^(?:先不|不想|暂时不|还没想好|不知道|只想聊|换个话题|取消|好的?[。！!]*$|嗯[。！!]*$)|[?？]/u.test(message.trim());
}

export function initialPurposeQuestion(message: string): string | undefined {
  const form = bare.exec(message.trim())?.[1];
  if (!form) return needsFilmSubject(message) ? "你希望看完这条片子的人记住什么？" : undefined;
  if (/音乐|歌曲|歌|曲子|配乐|音频|播客/u.test(form)) return "你希望这段声音用在什么场合？";
  if (/片|视频/u.test(form) && form !== "图片") return "你希望看完这条片子的人记住什么？";
  if (/文章|书稿|文字|散文|故事|诗/u.test(form)) return "你希望这段文字写出来以后，可以用来做什么？";
  return "你想用这份作品做什么？";
}

const filmNoun = "(?:短视频|视频|纪录片|短片|影片|电影|片子)";
const filmAction = "(?:制作|生成|创作|改编|整理|剪辑|做|拍|剪|变)(?:成|出)?";
const filmPrefix = "(?:(?:我(?:们)?(?:想要|想|要|希望|准备|打算)(?:让?你)?|咱们(?:来)?|请你?|麻烦你?)?(?:帮我|给我)?)";
const filmQuantity = "(?:一?(?:个|部|支|条|段))?";
const filmObject = filmQuantity+"(?:关于[^，。！？\\n]{1,40}的|[0-9一二三四五六七八九十]+(?:分钟|秒)的?)?(?:纪念|动画|宣传|小)?"+filmNoun;
const filmRequest = new RegExp("^"+filmPrefix+"(?:直接|先)?(?:(?:把|将|用|根据|为)[^，。！？\\n]{1,80}?)?"+filmAction+filmObject,"u");
const filmWish = new RegExp("^(?:我想要|我需要|我想|我要|给我)"+filmObject,"u");
const englishStart = "(?:(?:please|help me|i (?:want|would like) to|let['’]s)\\s+)?";
const englishFilm = "(?:(?:a|an|one)\\s+)?(?:(?:short|animated|documentary)\\s+)?(?:video|film|movie)\\b";
const englishRequest = new RegExp("^"+englishStart+"(?:(?:make|create|generate|produce)\\s+"+englishFilm+"|turn\\s+.+?\\s+into\\s+"+englishFilm+")","iu");
const bareFilm = new RegExp("^(?:"+filmPrefix+"(?:"+filmAction+")?"+filmQuantity+"(?:小)?"+filmNoun+"|"+englishStart+"(?:make|create|generate|produce)\\s+"+englishFilm+")(?:吧|试试)?[。.!！\\s]*$","iu");

function filmRequestText(message: string): string {
  return message.trim().replace(quoted, "…")
    .replace(/^(?:能不能|可不可以|可以|能)(?:请)?(?:你)?(.+?)(?:吗|嘛)?[？?]?$/u, "$1")
    .replace(/^(?:can|could|would) you (.+?)\??$/iu, "$1");
}

export function needsFilmSubject(message: string): boolean {
  const words = filmRequestText(message).replace(/(?:把|将|用)(?:这|那|当前)(?:个|段|篇|本|部)?(?:故事|书稿|文章|作品)/u, "");
  return bareFilm.test(words);
}

/** Match a request for a film, including a story to adapt. A film mentioned as context is not the requested output. */
export function requestsStoryFilm(message: string): boolean {
  const text = filmRequestText(message);
  if (/^(?:如果|假如|要是|听说|据说)|[?？]|第\s*[\d零一二三四五六七八九十]+\s*镜|这(?:张图|一?帧|个镜头)|首尾帧|图生视频|\b(?:frame|shot|clip|thumbnail|subtitles?)\b/iu.test(text)) return false;
  if (englishRequest.test(text)) return !/\b(?:video|film|movie)\s+(?:tutorial|music|script|poster|captions?|subtitles?|cover|soundtrack)\b/iu.test(text);
  const clauses = text.split(/[，,。！!；;\n]/u);
  return clauses.some((clause, index) => {
    if (index && /(?:说|问|提到|表示)[：:\s]*$/u.test(clauses[index-1])) return false;
    const words = clause.trim().replace(/^(?:这次|现在|那就|接下来)/u, "").trim();
    const matched = filmRequest.exec(words) ?? filmWish.exec(words);
    if (!matched) return false;
    return !/^(?:的)?(?:截图|封面|字幕|配乐|音乐|音轨|教程|脚本|软件|功能|格式|时候|过程|方法|工具)|^(?:需要什么|怎么|的人)/u.test(words.slice(matched[0].length));
  });
}

export function creativeChatDirection(message: string) {
  const rules = [
    "【聊天中的创作意图】从第一句话开始，留意这是谁讲的、他身在什么处境、做了什么决定、原话中有哪些感受。回应一个具体细节，推测用试探语气。用户只分享或纠正时就陪他聊，不问作品用途，不推销生成。",
    "只有用户明确想做作品时，才从本轮、先前原话、当前作品已确认意图中找用途。区分用户的动机与委托人期待。用途仍缺时只问一个贴近材料的问题；用途已经说过就直接沿用。用户还没想好时允许继续聊；明确要先看试样时直接给试样。",
    "用途明确后，拿用户描述的一处行动或选择，给一个可调整的具体表达办法，说清为什么合适。单一媒介只谈所需的表达；多媒介则说明在同一刻谁承载信息、谁退让，文字落在哪个细节、画面何时停、声音何时进入或留白。已有参考与明确的保留项优先。建议属于本作品，不把它写成用户已认可的偏好。",
  ];
  if (/(随着|伴随|跟着|配合|参照|参考|说完|结束时)/u.test(message)) {
    const targets = feedbackEditTargets(message);
    if (targets.length) rules.push("沿用剪辑反馈中目标与参照的区分。语句中可能要调整的是" +
      targets.map(track => feedbackTrackNames[track]).join("、") + "。结合原话核对，保留作为参照的内容。");
  }
  return rules.join("\n");
}
