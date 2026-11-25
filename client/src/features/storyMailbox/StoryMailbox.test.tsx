import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MailboxContents } from "./StoryMailbox";
import {
  UiLanguageContext,
  translateUi,
} from "@/features/uiLanguage/UiLanguage";
import { changeText, inventoryText } from "./mailboxPresentation";
import type { MailboxContact, MailboxEntry } from "@shared/storyMailbox";
const fixtures = vi.hoisted(() => ({
  contacts: [] as MailboxContact[],
  entries: [] as MailboxEntry[],
  mutate: vi.fn(),
}));
vi.stubGlobal("React", React);
vi.mock("@/lib/trpc", () => {
  const mutation = {
    useMutation: () => ({ isPending: false, mutateAsync: fixtures.mutate }),
  };
  return {
    trpc: {
      useUtils: () => ({}),
      storyMailbox: {
        contacts: {
          useQuery: () => ({ data: fixtures.contacts, isPending: false }),
        },
        history: {
          useQuery: () => ({
            data: { entries: fixtures.entries, nextCursor: null },
            isPending: false,
          }),
        },
        threads: { useQuery: () => ({ data: [] }) },
        stories: { useQuery: () => ({ data: [] }) },
        nativeStatus: {
          useQuery: () => ({ data: { enabled: false, bound: false } }),
        },
        nativeCreate: mutation,
        parts: { useQuery: () => ({ data: [] }) },
        preview: { useQuery: () => ({ data: undefined }) },
        send: mutation,
        publishMemory: mutation,
        memoryVersion: { useQuery: () => ({ data: {
          version: 2, markdown: "## Source\nStart with the photo.",
          added: ["Start with the photo."], removed: ["Start with the sound."],
          isLatest: true, recipientStoryId: 1,
        } }) },
        receive: mutation,
        removeContact: mutation,
      },
    },
  };
});
const inventory = {
  chapters: 1,
  images: 0,
  videos: 0,
  audio: 0,
  timelineItems: 0,
  bookVersions: 0,
  chapterVersions: 0,
  videoVersions: 0,
  exports: 0,
};
beforeEach(() => {
  fixtures.contacts = [{ id: "friend", name: "岱", removed: false, unread: 1 }];
  fixtures.entries = [
    {
      id: "entry",
      threadId: "thread",
      kind: "updated",
      authorName: "岱",
      mine: false,
      unread: true,
      createdAt: "2026-11-13T08:00:00Z",
      title: "Paper boat",
      note: "New ending",
      inventory,
      changes: [{ kind: "text", updated: 1, names: ["Chapter 1"] }],
      ownStoryId: null,
      receivedStoryId: null,
    },
  ];
  fixtures.mutate.mockReset();
});
const render = (selection: string | null = "friend") =>
  renderToStaticMarkup(
    <UiLanguageContext.Provider
      value={{ language: "en", setLanguage: () => {} }}
    >
      <MailboxContents
        initialSection={selection}
        currentStoryId={1}
        onOpenStory={() => {}}
        shareBacks={[]}
      />
    </UiLanguageContext.Provider>
  );
describe("mailbox interface", () => {
  it("shows shared note edits and an explicit adoption action apart from story receipt", () => {
    fixtures.entries[0].changes = [{ kind: "storyMemory", updated: 1 }];
    const html = render();
    expect(html).toContain("Share creative notes");
    expect(html).toContain("Open note update");
    expect(html).toContain("Start with the photo.");
    expect(html).toContain("Start with the sound.");
    expect(html).toContain("Use in my story");
    expect(html).not.toContain("Accept this version");
    expect(fixtures.mutate).not.toHaveBeenCalled();
  });
  it("shows the contributor, concrete changes, independent receipt and consent in English", () => {
    const html = render();
    expect(html).toContain("岱");
    expect(html).toContain("Changed");
    expect(html).toContain("Chapter 1");
    expect(html).toContain("Accept this version");
    expect(html).toContain("independent story");
    expect(html).not.toContain("接收这个版本");
    expect(fixtures.mutate).not.toHaveBeenCalled();
  });
  it("retains correspondence but disables sending and receiving after contact removal", () => {
    fixtures.contacts[0].removed = true;
    const html = render();
    expect(html).toContain("Paper boat");
    expect(html).toContain("Contact removed");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Accept this version/);
    expect(html).not.toContain("No correspondence yet");
  });
  it("shows only the story's actual contents and names version changes", () => {
    const t = (
      source: string,
      values?: readonly (string | number | null | undefined)[]
    ) => translateUi("en", source, values);
    const text = inventoryText(inventory, t);
    expect(text).not.toContain("Video");
    expect(text).not.toContain("audio");
    expect(
      changeText(
        { kind: "videoVersions", added: 1, names: ["Rainy ending"] },
        t
      )
    ).toContain("Rainy ending");
    fixtures.contacts = [];
    expect(render(null)).toContain("No connected friends yet");
  });
});
