import { z } from "zod";

const id = z.string().uuid();
export const memoryShelfViewSchema = z.enum([
  "horizontal",
  "vertical",
  "album",
]);
export type MemoryShelfView = z.infer<typeof memoryShelfViewSchema>;
const activitySchema = z.object({
  totalMs: z.number().nonnegative(),
  lastCreditedAt: z.number(),
  sessions: z
    .array(
      z.object({
        id: z.string().uuid(),
        elapsedMs: z.number().nonnegative(),
        at: z.number(),
      })
    )
    .max(8),
});
const name = z.string().trim().min(1).max(80);
export const memorySpaceStateSchema = z.object({
  schemaVersion: z.literal(1),
  initialized: z.boolean(),
  shelfView: memoryShelfViewSchema.default("vertical"),
  bookViews: z.record(z.string(), memoryShelfViewSchema).default({}),
  activity: z.record(z.string(), activitySchema).default({}),
  shelves: z
    .array(
      z.object({
        id,
        name,
        storyIds: z.array(z.number().int().positive()).max(10000),
      })
    )
    .max(100),
  seenStories: z.record(z.string(), z.string().max(64)),
  people: z
    .array(
      z.object({
        id,
        name,
        note: z.string().max(500),
        accountId: z.number().int().positive().optional(),
      })
    )
    .max(2000),
  relationships: z
    .array(z.object({ id, from: z.string(), to: z.string(), label: name }))
    .max(5000),
});
export type MemorySpaceState = z.infer<typeof memorySpaceStateSchema>;
export const emptyMemorySpace = (): MemorySpaceState => ({
  schemaVersion: 1,
  initialized: false,
  shelfView: "vertical",
  bookViews: {},
  activity: {},
  shelves: [],
  seenStories: {},
  people: [],
  relationships: [],
});
export const memorySpaceOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("setBookView"),
    storyId: z.number().int().positive(),
    view: memoryShelfViewSchema.nullable(),
  }),
  z.object({ kind: z.literal("setShelfView"), view: memoryShelfViewSchema }),
  z.object({ kind: z.literal("removePerson"), id }),
  z.object({ kind: z.literal("addShelf"), id, name }),
  z.object({ kind: z.literal("renameShelf"), id, name }),
  z.object({ kind: z.literal("removeShelf"), id }),
  z.object({
    kind: z.literal("moveShelf"),
    id,
    direction: z.enum(["up", "down"]),
  }),
  z.object({
    kind: z.literal("moveBook"),
    storyId: z.number().int().positive(),
    shelfId: id.nullable(),
    beforeStoryId: z.number().int().positive().nullable(),
  }),
  z.object({
    kind: z.literal("savePerson"),
    id,
    name,
    note: z.string().trim().max(500),
  }),
  z.object({
    kind: z.literal("saveRelation"),
    id,
    from: z.union([id, z.literal("self")]),
    to: z.union([id, z.literal("self")]),
    label: name,
  }),
  z.object({ kind: z.literal("removeRelation"), id }),
]);
export type MemorySpaceOperation = z.infer<typeof memorySpaceOperationSchema>;
export type MemoryBook = {
  view?: MemoryShelfView;
  id: number;
  title: string;
  coverUrl: string | null;
  hasText: boolean;
  updatedAt: number | null;
  fingerprint: string;
  unread: boolean;
  isNew: boolean;
  pending: number;
  wordCount: number;
  wordCountLabel: string;
  activeEditingMs: number | null;
  editors: {
    name: string;
    wordCount: number | null;
    activeEditingMs: number | null;
  }[];
};
export type MemoryPerson = {
  id: string;
  name: string;
  note: string;
  connected: boolean;
  stories: {
    id: number;
    title: string;
    role: "accepted" | "invitedMe" | "contributed";
  }[];
};
export type MemorySpace = {
  revision: number;
  shelfView: MemoryShelfView;
  shelves: MemorySpaceState["shelves"];
  books: MemoryBook[];
  people: MemoryPerson[];
  relationships: MemorySpaceState["relationships"];
};
export type MemoryReading = {
  storyId: number;
  title: string;
  fingerprint: string;
  versions: {
    id: string;
    title: string;
    body: string;
    label: string;
    updatedAt: number | null;
    author: string | null;
  }[];
  participants: {
    name: string;
    kind: "text" | "layout";
    at: number;
    status: string;
  }[];
};

/** An unassigned shelf is a view, never a second copy of a story. */
export function booksOnShelf(
  space: Pick<MemorySpace, "books" | "shelves">,
  shelfId: string | null
) {
  const byId = new Map(space.books.map(book => [book.id, book]));
  if (shelfId)
    return (
      space.shelves.find(shelf => shelf.id === shelfId)?.storyIds ?? []
    ).flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  const assigned = new Set(space.shelves.flatMap(shelf => shelf.storyIds));
  return space.books.filter(book => !assigned.has(book.id));
}
