import { z } from "zod";

export const sceneConfidenceSchema = z.union([
  z.literal(0),
  z.literal(25),
  z.literal(50),
  z.literal(75),
  z.literal(100),
]);

export const sceneAnalysisSchema = z.object({
  subjectDescription: z.string().min(1),
  isPerson: z.boolean(),
  recurringCharacter: z
    .object({
      key: z.string().min(1),
      name: z.string().optional(),
    })
    .nullable(),
  action: z.string().min(1),
  emotion: z.string().min(1),
  keyElements: z.array(z.string().min(1)),
  needsCharacterAnchor: z.boolean(),
  confidence: sceneConfidenceSchema,
  intent: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
});

export type SceneAnalysis = z.infer<typeof sceneAnalysisSchema>;
