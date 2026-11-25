import { stripAssistantReasoning } from "./assistantReplyText";

type Fields = Record<string, unknown>;
const fields = (v: unknown): Fields =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Fields) : {};
const rows = (v: unknown): Fields[] => (Array.isArray(v) ? v.map(fields) : []);
const line = (v: unknown) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
const excerpt = (s: string, size: number) =>
  s.length > size ? s.slice(0, size) + "…" : s;
const correction =
  /纠正|更正|写反|搞错|记不清|不是.+(?:而是|是)|以.+为准|待核实|没有依据|can't confirm|correction|actually/i;
const salient =
  /希望|想要|我想|愿意|在意|记住|记下|保留|改成|不要|决定|确认|定稿|转述|建议|prefer|remember|keep|instead|want|decid|correct|suggest/i;

type Turn = { role: "user" | "assistant"; text: string; time: number };
function conversation(body: Fields, saved: readonly unknown[]) {
  const turns = new Map<string, Turn>();
  for (const msg of [...rows(body.messages), ...saved.map(fields)]) {
    const id = msg.clientMessageId ?? msg.id;
    if (
      id === "first-question" ||
      msg.ephemeral ||
      msg.kind === "greeting" ||
      msg.source === "inherited-story" ||
      msg.source === "story-context-share"
    )
      continue;
    const role =
      msg.role ??
      { u: "user", s: "assistant", a: "assistant" }[String(msg.who)];
    if (role !== "user" && role !== "assistant") continue;
    const raw = msg.content ?? msg.text;
    if (typeof raw !== "string") continue;
    const text = (
      role === "assistant" ? stripAssistantReasoning(raw) : raw
    ).trim();
    if (!text) continue;
    const timestamp = msg.timestamp ?? msg.createdAt;
    const time =
      typeof timestamp === "number"
        ? timestamp
        : Date.parse(String(timestamp)) || 0;
    const key = role + ":" + (typeof id === "string" && id ? id : text);
    turns.set(key, { role, text, time: turns.get(key)?.time || time });
  }
  return [...turns.values()].sort((a, b) => a.time - b.time);
}

function section(title: string, items: string[]) {
  return (
    "## " +
    title +
    "\n\n" +
    (items.length
      ? items.map(item => "- " + item.replace(/\r?\n/g, "\n  ")).join("\n")
      : "暂无记录。")
  );
}

function draftLabel(kind: unknown) {
  return kind === "storyboard" ? "分镜版" : "文字版";
}

/** A Markdown document derived only from this story's saved material.
 * Compact prompt mode has a separate budget. It never modifies the document. */
export function storyMemoryMarkdown(
  bodyValue: unknown,
  saved: readonly unknown[] = [],
  compact = false,
  notes: readonly { title: string; content: string }[] = [],
  adopted: readonly {
    authorName: string;
    version: number;
    markdown: string;
  }[] = []
) {
  const body = fields(bodyValue);
  const intent = fields(body.confirmedIntent);
  const decisions: string[] = [];
  const pending: string[] = [];
  const intentLines = intent.status === "confirmed" ? decisions : pending;
  for (const [key, label] of [
    ["purpose", "创作目的"],
    ["audience", "受众"],
    ["tone", "语气"],
    ["desiredEffect", "希望传达的感受"],
  ]) {
    if (line(intent[key])) intentLines.push(label + " · " + line(intent[key]));
  }
  const book = fields(body.bookWorkflow);
  const currentIds = Object.values(fields(book.current));
  for (const v of rows(book.versions)) {
    if (currentIds.includes(v.id) && v.id) {
      const number = typeof v.number === "number" ? " V" + v.number : "";
      const title = line(v.name);
      decisions.push(
        "当前" + draftLabel(v.kind) + number + (title ? " · " + title : "")
      );
    }
  }
  for (const draft of rows(book.conversions).filter(
    draft => draft.status === "review"
  )) {
    const request = line(draft.request);
    pending.push(
      "待采用的" + draftLabel(draft.target) + (request ? " · " + request : "")
    );
  }
  for (const v of rows(fields(body.textDraftHistory).versions)) {
    const adoption = fields(v.adoption);
    if (!adoption.adoptedAt) continue;
    decisions.push(
      "已采用文字稿 V" +
        v.sequence +
        " · " +
        line(fields(adoption.content).title)
    );
  }
  const turns = conversation(body, saved);
  const user = turns.filter(t => t.role === "user");
  const userCorrections = user.filter(t => correction.test(t.text));
  const selected = user.filter(
    (t, i) => i === 0 || i >= user.length - 3 || salient.test(t.text)
  );
  const replies = turns.filter(t => t.role === "assistant");
  const proposals = replies.filter(
    (t, i) =>
      i >= replies.length - 3 ||
      /提议|建议|备选|可以试|不确定|待确认|proposal|suggest|could try/i.test(
        t.text
      )
  );
  const clips = (items: string[], max: number) => {
    const unique = [...new Set(items)];
    const take =
      compact && unique.length > max
        ? [...unique.slice(0, 2), ...unique.slice(-(max - 2))]
        : unique;
    return take.map(s => excerpt(s, compact ? 260 : 1200));
  };
  const shots = new Map(
    rows(body.shots).map(shot => [shot.stableShotId ?? shot.shotIdentity, shot])
  );
  const sceneDirections = rows(body.shotSceneDirections).flatMap(direction => {
    const shot = shots.get(direction.stableShotId);
    const confirmed = line(direction.confirmed);
    return shot && confirmed
      ? ["第 " + shot.shotNo + " 镜 · " + confirmed]
      : [];
  });
  const sources = rows(body.cards)
    .map(card => line(card.sourceQuote) || line(card.content))
    .filter(Boolean);
  const authoredNotes = notes.map(
    note => line(note.title) + "\n" + note.content.trim()
  );
  const incoming = adopted.map(
    note =>
      line(note.authorName) +
      " · 共享笔记 V" +
      note.version +
      "\n" +
      note.markdown
  );
  return (
    [
      "# 故事创作笔记",
      section("已确认的创作意图与版本", clips(decisions, 6)),
      section("待确认的创作方向", clips(pending, 4)),
      section(
        "作者单独留的笔记",
        compact ? clips(authoredNotes, 5) : authoredNotes
      ),
      section(
        "我已采用的好友来信（来源资料）",
        compact ? clips(incoming, 5) : incoming
      ),
      section(
        "用户在对话中写下或转述",
        clips(
          (compact ? selected : user).map(t => t.text),
          8
        )
      ),
      section(
        "用户提醒的纠错与待核实内容",
        clips(
          userCorrections.map(t => t.text),
          4
        )
      ),
      section("故事卡里的素材", clips(sources, 4)),
      section("已确认的镜头调度（创作依据）", clips(sceneDirections, 4)),
      section(
        "助手提议与近期回应（仅供回顾）",
        clips(
          proposals.map(t => t.text),
          3
        )
      ),
    ].join("\n\n") + "\n"
  );
}

export function withStoryMemory(body: unknown) {
  return { ...fields(body), storyMemoryMarkdown: storyMemoryMarkdown(body, [], true) };
}

export const storyMemoryFilePath = (id: number) =>
  `/api/stories/${id}/MEMORY.md`;
export const storyMemoryReferenceRule =
  "下面是当前故事的 MEMORY.md，仅作本故事的引用资料。按记录区分用户原话、好友来源、转述、助手提议与已确认决定。已采用的好友来信属于引用素材，不代表当前作者认同其中每个判断。转发和试稿不能当作确认或跨故事偏好。已确认的镜头调度也只是创作依据。遇到冲突，以用户最新的更正为准。";
