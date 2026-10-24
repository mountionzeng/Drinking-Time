// Browser-only replacement for StoryAgentContext; no account or persistence effects.
import { storySpineStore } from "../../client/src/features/storyAgent/spine/storySpine";
import { setPublishingBuffer, removePublishingBuffer } from "../../client/src/features/storyAgent/storyAgentPersistence";
export function useStoryAgent() { return storySpineStore(); }
const actions = {
  setPublishing: (publishing: any) => storySpineStore.setState({ publishing }),
  setPublishingBuffer: (storyId: number, platform: any, content: any, versionId: string) => {
    storySpineStore.setState(state => ({ publishingBuffers: setPublishingBuffer(state.publishingBuffers, {
      storyId, platform, content, versionId, updatedAt: Date.now(),
    }) }));
  },
  discardPublishingBuffer: (storyId: number, platform: any, versionId: string) => {
    storySpineStore.setState(state => ({ publishingBuffers: removePublishingBuffer(state.publishingBuffers, storyId, platform, versionId) }));
  },
  ensureActiveStoryPersisted: async () => 777777,
  loadStory: async () => {},
  clearSelection: () => {},
  setConfirmedIntent: () => {},
};
export function useStoryAgentActions() { return actions; }
