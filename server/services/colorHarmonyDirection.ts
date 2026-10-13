import {
  COLOR_DESIGN_KEYS,
  normalizeColorDesign,
  type ColorDesign,
  type ColorDesignKey,
} from "../../shared/colorHarmony";

const RELATIONS: Array<[RegExp, NonNullable<ColorDesign["harmony"]>]> = [
  [/分裂互补|split complementary/iu, "splitComplementary"],
  [/互补|complementary/iu, "complementary"],
  [/单色相?|同色系|monochrom/iu, "monochromatic"],
  [/邻近色|相邻色|analogous/iu, "analogous"],
  [/三角色|三角配色|triadic/iu, "triadic"],
];
const NEGATIVE = /不要|不用|避免|别|不想|并非|不是|no\b|not\b|without\b/iu;
const UNCERTAIN =
  /如果|假如|也许|可能|或者|还是|是否|他说|她说|他们|别人|朋友说|曾经|以前|过去|if\b|maybe\b|said\b/iu;

/** Quoted/story dialogue is evidence about content, not a command to the renderer. */
function clauses(text: string): string[] {
  return text
    .replace(/“[^”]*”|"[^"]*"|‘[^’]*’|「[^」]*」/gu, "")
    .split(/[，,。；;\n！？!?]|但是|但|改成|改用|改为|改/gu)
    .map(s => s.trim())
    .filter(Boolean);
}

type Explicit = {
  design: ColorDesign;
  blocked: Set<ColorDesignKey>;
  shot?: string;
  keepColors: boolean;
};
function explicitMethods(text: string): Explicit {
  const design: ColorDesign = {},
    blocked = new Set<ColorDesignKey>();
  let shot: string | undefined;
  const keepColors =
    /颜色保留|保留.{0,5}(?:颜色|色板)|不(?:要)?换色|不改.{0,3}颜色/u.test(text);
  for (const clause of clauses(text)) {
    const relations = RELATIONS.filter(([pattern]) => pattern.test(clause));
    const matches = relations.filter(
      ([, value]) =>
        value !== "complementary" ||
        !relations.some(([, v]) => v === "splitComplementary")
    );
    if (matches.length) {
      if (
        NEGATIVE.test(clause) ||
        UNCERTAIN.test(clause) ||
        matches.length !== 1
      ) {
        delete design.harmony;
        blocked.add("harmony");
      } else {
        design.harmony = matches[0][1];
        blocked.delete("harmony");
      }
    }
    for (const [key, pattern, value] of [
      ["saturation", /低饱和|柔和|克制/u, "restrained"],
      ["valueContrast", /柔和|低对比|有限明暗/u, "soft"],
      ["valueContrast", /强对比|强烈明暗/u, "strong"],
      ["areaBalance", /少量点睛|大面积主色/u, "dominantAccent"],
      ["valueMasses", /连贯.{0,4}块面|归并.{0,4}明暗/u, "connected"],
      ["valueMasses", /间断.{0,4}块面|分散.{0,4}明暗/u, "broken"],
    ] as const) {
      if (!pattern.test(clause)) continue;
      if (NEGATIVE.test(clause) || UNCERTAIN.test(clause)) {
        delete design[key];
        blocked.add(key);
      } else {
        Object.assign(design, { [key]: value });
        blocked.delete(key);
      }
    }
    if (
      !NEGATIVE.test(clause) &&
      !UNCERTAIN.test(clause) &&
      /亮面.{0,6}(?:移|放).{0,5}(?:侧边|一侧)/u.test(clause)
    ) {
      shot =
        "在当前既有形体内将亮面重心移向一侧；不新增光源、物件或人物，不改变可见身份颜色。";
    }
  }
  return { design, blocked, shot, keepColors };
}

export type ColorDirectionInput = {
  instructions?: string;
  story?: string;
  emotion?: string;
  dominant?: ColorDesign;
  supplements?: ColorDesign[];
  /** Existing, higher-priority style/palette/light/material words, not artist names. */
  language?: string;
  paletteLocked?: boolean;
  referenceLocked?: boolean;
};
export type ColorDirectionResult = {
  colorDesign?: ColorDesign;
  shotDirection?: string;
  reason: "applied" | "no_evidence" | "protected";
};

/** Pure and deterministic: no model, profile, provider, database or second style selection. */
export function selectColorHarmonyDirection(
  input: ColorDirectionInput
): ColorDirectionResult {
  if (input.referenceLocked) return { reason: "protected" };
  const explicit = explicitMethods(input.instructions ?? "");
  const design: ColorDesign = { ...normalizeColorDesign(input.dominant) };
  const language = input.language ?? "";
  const lockedPalette = input.paletteLocked || explicit.keepColors;
  const cleanSupplements = (input.supplements ?? []).map(normalizeColorDesign);
  const legacy = explicitMethods(language);
  for (const key of COLOR_DESIGN_KEYS) {
    if (
      design[key] ||
      explicit.blocked.has(key) ||
      legacy.blocked.has(key) ||
      legacy.design[key]
    )
      continue;
    // Free-form legacy constraints cannot be reliably reinterpreted.
    if (
      language &&
      !input.dominant &&
      !["localHarmony", "localScale", "application"].includes(key)
    )
      continue;
    if (lockedPalette && ["harmony", "localHarmony"].includes(key)) continue;
    const values = new Set(
      cleanSupplements.flatMap(clean => (clean?.[key] ? [clean[key]] : []))
    );
    if (values.size === 1) Object.assign(design, { [key]: [...values][0] });
  }
  if (
    !design.harmony &&
    !language &&
    !lockedPalette &&
    !explicit.blocked.has("harmony")
  ) {
    const evidence = clauses(`${input.emotion ?? ""}。${input.story ?? ""}`)
      .filter(s => !NEGATIVE.test(s) && !UNCERTAIN.test(s))
      .join(" ");
    const contrasting =
      /孤独|寂寞/u.test(evidence) && /期待|希望/u.test(evidence);
    const quiet = /安静|平静/u.test(evidence) && /相处|陪伴/u.test(evidence);
    // Equal evidence is deliberately unresolved, never randomly tie-broken.
    if (contrasting !== quiet)
      Object.assign(
        design,
        contrasting
          ? {
              harmony: "complementary",
              areaBalance: "dominantAccent",
              saturation: "restrained",
              valueContrast: "soft",
            }
          : {
              harmony: "analogous",
              saturation: "restrained",
              valueContrast: "soft",
            }
      );
  }
  for (const key of explicit.blocked) delete design[key];
  for (const key of COLOR_DESIGN_KEYS) {
    if (
      legacy.blocked.has(key) ||
      (legacy.design[key] && design[key] !== legacy.design[key])
    )
      delete design[key];
  }
  Object.assign(design, explicit.design);
  // Only known compatible media may receive automatic material behaviours.
  const applicationMedia = {
    dryLayers: /彩铅|铅笔|colored pencil|pastel/iu,
    transparent: /水彩|透明叠染|watercolou?r|glaze/iu,
    opaque: /油画|丙烯|不透明|oil paint|gouache|acrylic/iu,
    juxtaposed: /点触|点彩|pointillis|stippl/iu,
  };
  if (
    design.application &&
    !applicationMedia[design.application].test(language)
  )
    delete design.application;
  if (
    /彩铅|colored pencil/iu.test(language) &&
    design.application !== "dryLayers"
  )
    delete design.application;
  const colorDesign = normalizeColorDesign(design);
  return {
    ...(colorDesign ? { colorDesign } : {}),
    ...(explicit.shot ? { shotDirection: explicit.shot } : {}),
    reason: colorDesign || explicit.shot ? "applied" : "no_evidence",
  };
}
