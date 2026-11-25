import type { SceneLayout } from "./shotSceneDirection";
import { stillVisualDescription } from "./stillVisualDescription";

type Beat = { subject: string; evidence: string };
type Question = { kind: "gaze" | "position" | "actor" | "visual" | "model"; focus: string };
export type TextSceneIntent = { beats: Beat[]; question?: Question };

// Keep the original clause intact. Only highlight a subject when it precedes a
// recognizable action; an object after a verb is not a second actor.
const action = /骑着|骑马|骑车|挥手|招手|摆手|举手|抬手|点头|抬头|回头|低头|看着|望向|看向|望着|注视|走向|走进|走到|走出|站在|坐在|蹲在|位于|在(?=[^，。]{1,16}(?:旁|上|下|边|里|前|后|侧))|递给|交给|接过|推开|牵着|搬运|指向|把|正在|\b(?:rides?|waves?|looks?|stands?|sits?|hands?|gives?|points?|walks?)\b/i;
const placePrefix = /^(?:[城墙楼桥门窗桌台树岸]{1,4}(?:头|边|旁|上|下|前|后)|(?:画面)?[左右](?:边|侧|方|上角|下角)|前景|背景|后景)(?:的)?/u;
const placed = /前景|后景|背景中|[左右](?:边|侧|方|上角|下角)|城头|[桥门窗桌台墙楼树岸](?:边|旁|下|上|后|前|头)|站在|坐在|蹲在|位于|走向|走到|奔向|\b(?:beside|behind|under|above|on the|at the|towards?)\b/i;
const gaze = /视线|目光|看向|望向|注视|凝视|看着|望着|对视|仰望|抬头看|\b(?:looks? (?:at|up|down|toward)|gaze[sd]?)\b/i;
const gesture = /挥手|招手|摆手|示意|\b(?:waves?|beckons?)\b/i;
const pronoun = /^(?:他|她|它|他们|她们|对方|其中一人|有人|he|she|they|someone)$/i;

function readBeat(evidence: string): Beat {
  const match = action.exec(evidence);
  const unassigned = { subject: "", evidence };
  if (!match?.index) return unassigned;
  const before = evidence.slice(0, match.index).trim();
  if (/[「“"『]|被|想起|梦见|提到|镜头|画面切|不要|并未|没有|不曾|未曾|不让|让|要求|并非|画外|不入画|不出场|^从|[不没未别]$|\b(?:by|remembers?|not|never)\b/i.test(before)) return unassigned;
  let subject = before.replace(placePrefix, "")
    .replace(/^(?:[一二两三四五六七八九十\d]+[名位个]|the |a |an )/i, "")
    .replace(/\s+(?:on|in|by|beside|under|behind|at)\s+.+$/i, "").trim();
  // Without a reliable boundary “向” could just be part of a name.
  // For a directed gesture retain the full clause without guessing its agent.
  if (gesture.test(match[0]) && /.[向朝对](?!方)./u.test(subject)) {
    const first = subject.split(/[向朝对]/u)[0];
    if (!pronoun.test(first)) return unassigned;
    subject = first;
  }
  return subject && subject.length <= 32 && !/[：:，,、。！？]/u.test(subject) ? { subject, evidence } : unassigned;
}

function clauses(source: string) {
  return source.split(/[\n，,。；;！？!?]|\.\s+(?=[A-Z])/u).map(v => v.trim()).filter(Boolean);
}

/** This unmetered reading quotes written evidence. Use a richer layout only if the user requested it. */
export function textSceneIntent(source: string, established = "", layout?: SceneLayout): TextSceneIntent {
  if (layout && (layout.people.length || layout.objects.length)) {
    const beats = [...layout.people.map(p => ({ subject: p.role, evidence: [p.role, p.count, p.clothing, p.position,
      p.action, p.target, p.gaze].filter(Boolean).join(" · ") })), ...layout.objects.map(o => ({
        subject: o.name, evidence: [o.name, o.position].filter(Boolean).join(" · ") }))];
    const focus = layout.uncertain.find(v => v.trim());
    return { beats, question: focus ? { kind: "model", focus } : undefined };
  }
  const visual = source.split("\n").map(stillVisualDescription).filter(Boolean).join("\n");
  const beats: Beat[] = [];
  const bySubject = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const sentence of visual.split(/[。；;！？!?\n]|\.\s+(?=[A-Z])/u)) {
    let previous = "";
    for (const clause of clauses(sentence)) {
      const beat = readBeat(clause);
      if (!seen.has(clause)) { beats.push(beat); seen.add(clause); }
      // A comma can continue an already named subject's action (“小满坐下，看向窗外”).
      const subject = beat.subject || (action.exec(clause)?.index === 0 ? previous : "");
      if (subject && !pronoun.test(subject)) {
        if (!bySubject.has(subject)) bySubject.set(subject, []);
        bySubject.get(subject)!.push(clause);
      }
      previous = subject;
    }
  }
  if (!beats.length) return { beats, question: { kind: "visual", focus: "" } };
  const subjects = [...bySubject.keys()];
  const existing = clauses(established);
  const evidenceFor = (subject: string) => [...bySubject.get(subject)!, ...existing.filter(line => line.includes(subject))];
  const unclearActor = beats.find(b => pronoun.test(b.subject));
  if (unclearActor && !established.includes(unclearActor.evidence) &&
    (subjects.length !== 1 || /递给|交给|叫住|和|与|跟|\b(?:with|and|to)\b/i.test(visual))) {
    return { beats, question: { kind: "actor", focus: unclearActor.evidence.length <= 100 ? unclearActor.evidence : unclearActor.subject } };
  }
  const gesturing = subjects.filter(name => evidenceFor(name).some(e => gesture.test(e)));
  const observer = subjects.find(name => !gesturing.includes(name));
  const observerActs = observer && evidenceFor(observer).some(e => /骑|走|站|坐|蹲|递给|接过|抬头|\b(?:rides?|walks?|stands?|sits?|hands?)\b/i.test(e));
  if (gesturing.length === 1 && subjects.length === 2 && observer && observerActs && !evidenceFor(observer).some(e => gaze.test(e))) {
    return { beats, question: { kind: "gaze", focus: observer } };
  }
  const missing = subjects.filter(name => !evidenceFor(name).some(e => placed.test(e)));
  if (subjects.length > 1 && missing.length) return { beats, question: { kind: "position", focus: missing.slice(0, 3).join("、") } };
  return { beats };
}

export function intentAnswer(question: Question | undefined, answer: string) {
  const text = answer.trim();
  if (!text) return "";
  switch (question?.kind) {
    case "gaze": return question.focus + "的视线：" + text;
    case "actor": return "关于「" + question.focus + "」的动作归属：" + text;
    case "position": return question.focus + "的位置：" + text;
    case "model": return "关于「" + question.focus + "」的画面要求：" + text;
    default: return "画面要求：" + text;
  }
}
