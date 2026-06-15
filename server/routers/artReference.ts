import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getArtReferenceAgent } from "../services/artReferenceAgent";
import { getArtRepository } from "../services/artRepository";

export const artReferenceRouter = router({
  matchReferences: publicProcedure
    .input(
      z.object({
        userDescription: z.string(),
        topK: z.number().optional().default(3),
      }),
    )
    .query(({ input }: { input: { userDescription: string; topK: number } }) => {
      const agent = getArtReferenceAgent();
      const matches = agent.findBestMatches(input.userDescription, input.topK);

      return {
        matches: matches.map((match) => ({
          filename: match.filename,
          artStyle: match.features.artStyle,
          artistReference: match.features.artistReference,
          visualDescription: match.features.visualDescription,
          colorTone: match.features.colorTone,
          mood: match.features.mood,
          totalScore: match.totalScore,
          dimensionScores: match.dimensionScores,
        })),
      };
    }),

  getImageCount: publicProcedure.query(() => {
    const repo = getArtRepository();
    return {
      count: repo.getImageCount(),
    };
  }),

  getAllReferences: publicProcedure.query(() => {
    const repo = getArtRepository();
    const references = repo.getAllReferences();

    return {
      references: references.map(([filename, features]) => ({
        filename,
        artStyle: features.artStyle,
        artistReference: features.artistReference,
        dominantColors: features.dominantColors,
        colorTone: features.colorTone,
        mood: features.mood,
      })),
    };
  }),

  getFeatureDescription: publicProcedure
    .input(
      z.object({
        userDescription: z.string(),
        topK: z.number().optional().default(3),
      }),
    )
    .query(({ input }: { input: { userDescription: string; topK: number } }) => {
      const agent = getArtReferenceAgent();
      const matches = agent.findBestMatches(input.userDescription, input.topK);
      const description = agent.getFeatureDescription(matches);

      return {
        description,
      };
    }),
});
