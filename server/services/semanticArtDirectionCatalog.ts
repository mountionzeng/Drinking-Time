import type { NormalizedSemanticArtEvidence, SemanticArtCard, SemanticArtPurpose, SemanticArtSelection } from "../../shared/semanticArtDirection";
import { getSemanticArtCards } from "./styleLibrary";

const MIN_SCORE = 2;
const MIN_MARGIN = 1;

function scoreCard(card: SemanticArtCard, normalized: NormalizedSemanticArtEvidence): number {
  return normalized.evidence.reduce((score, item) => {
    if (item.polarity !== "positive") return score;
    if (card.counterSignals.includes(item.concept)) return score - item.weight;
    return card.concepts.includes(item.concept) ? score + item.weight : score;
  }, 0);
}

function choose(cards: SemanticArtCard[], normalized: NormalizedSemanticArtEvidence) {
  const ranked = cards.map(card => ({ card, score: scoreCard(card, normalized) }))
    .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
  const best = ranked[0];
  if (!best || best.score < MIN_SCORE) return { card: null, reason: best?.score ? "low_confidence" as const : "no_evidence" as const };
  if (ranked[1] && best.score - ranked[1].score < MIN_MARGIN) return { card: null, reason: "ambiguous" as const };
  return { card: best.card, reason: "applied" as const };
}

export function selectSemanticArtDirection(args: {
  normalized: NormalizedSemanticArtEvidence;
  purpose: SemanticArtPurpose;
  cards?: SemanticArtCard[];
  currentMainId?: string;
}): SemanticArtSelection {
  const cards = (args.cards ?? getSemanticArtCards()).filter(card => !card.forbiddenPurposes.includes(args.purpose));
  const scores = Object.fromEntries(cards.map(card => [card.id, scoreCard(card, args.normalized)]));
  const mainChoice = choose(cards.filter(card => card.scope === "main"), args.normalized);
  const auxiliaryCandidates = cards.filter(card => card.scope === "auxiliary");
  const auxChoice = choose(auxiliaryCandidates, args.normalized);
  let auxiliary = auxChoice.card;
  const effectiveMain = mainChoice.card ?? cards.find(card => card.id === args.currentMainId && card.scope === "main") ?? null;
  let reason: SemanticArtSelection["reason"] = mainChoice.reason !== "applied"
    ? (effectiveMain && auxChoice.reason === "applied" ? "applied" as const : mainChoice.reason)
    : auxChoice.reason === "ambiguous"
      ? "ambiguous" as const
      : "applied" as const;
  const dimensionsAllowed = auxiliary && effectiveMain
    ? auxiliary.allowedAuxiliaryDimensions.every(dimension => effectiveMain.allowedAuxiliaryDimensions.includes(dimension))
    : false;
  if (auxiliary && (!effectiveMain || !dimensionsAllowed || (auxiliary.compatibleMainIds.length > 0 && !auxiliary.compatibleMainIds.includes(effectiveMain.id)))) {
    auxiliary = null;
    reason = "incompatible_auxiliary";
  }
  if (cards.length === 0) reason = "purpose_disallowed";
  return { main: mainChoice.card, auxiliary, reason, scores };
}
