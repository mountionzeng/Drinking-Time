import { z } from "zod";
export const storyTagsSchema = z.array(z.string().trim().min(1).max(24)).max(12).transform(tags => [...new Set(tags)]);
export function readStoryTags(body: unknown): string[] {
  const value = body && typeof body === "object" ? (body as {storyTags?:unknown}).storyTags : undefined;
  const parsed = storyTagsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
export function matchesStorySearch(story: {title:string; tags?:string[]}, query:string) {
  const needle = query.trim().replace(/^#/, "").toLocaleLowerCase();
  return !needle || [story.title,...(story.tags || [])].some(text => text.toLocaleLowerCase().includes(needle));
}
