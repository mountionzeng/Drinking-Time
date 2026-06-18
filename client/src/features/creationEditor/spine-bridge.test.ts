import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('creation editor spine boundary', () => {
  it('keeps dynamic storyboard ownership in CreationEditorProvider react-query reads', () => {
    const context = source('client/src/features/creationEditor/CreationEditorContext.tsx');

    expect(context).toContain('trpc.storyAgent.storyGet.useQuery');
    expect(context).toContain('trpc.storyAgent.storyImages.useQuery');
    expect(context).toContain('normalizeStoryShots(body)');
    expect(context).not.toContain('useStoryAgent(');
    expect(context).not.toContain('useStorySpine(');
  });

  it('keeps AnimaticPanel and PromptTablePanel behind useCreationEditor', () => {
    const animatic = source('client/src/features/creationEditor/views/AnimaticPanel.tsx');
    const promptTable = source('client/src/features/creationEditor/views/PromptTablePanel.tsx');

    for (const panel of [animatic, promptTable]) {
      expect(panel).toContain('useCreationEditor()');
      expect(panel).not.toContain('useStoryAgent(');
      expect(panel).not.toContain('useStorySpine(');
      expect(panel).not.toContain('storyGet.useQuery');
      expect(panel).not.toContain('storyImages.useQuery');
    }
  });

  it('bridges only the active story id from the spine into CreationEditorProvider', () => {
    const workspace = source('client/src/features/analysis/views/WorkspaceLayout.tsx');

    expect(workspace).toContain('useActiveStoryId()');
    expect(workspace).toContain('useStoryAgentActions()');
    expect(workspace).toContain('<CreationEditorProvider activeStoryId={activeStoryId}>');
    expect(workspace).not.toContain('useStoryAgent()');
  });
});
