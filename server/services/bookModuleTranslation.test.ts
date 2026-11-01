import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ resolve: vi.fn(), generate: vi.fn() }));
vi.mock('./bookModuleSource', () => ({ resolveBookModuleSource: m.resolve }));
vi.mock('./agentRuntime', () => ({ runJsonAgent: m.generate }));
import { translateBookModule } from './bookModuleTranslation';
const input = { userId:7,storyId:1,chapterId:2,moduleId:'a',targetLanguage:'en' as const,expectedText:'第一段\n第二段' };
beforeEach(() => { vi.clearAllMocks(); m.resolve.mockResolvedValue({source:input.expectedText,image:null,fingerprint:'hash'}); m.generate.mockResolvedValue({parsed:{text:'First paragraph\nSecond paragraph'}}); });
it('translates only the owned module and preserves translated paragraphs', async () => {
  expect(await translateBookModule(input)).toEqual({text:'First paragraph\nSecond paragraph',fingerprint:'hash'});
  expect(m.resolve).toHaveBeenCalledWith(input);
  const request = m.generate.mock.calls[0][0];
  expect(JSON.parse(request.message)).toEqual({sourceText:input.expectedText});
  expect(request.systemPrompt).toContain('英文');
  expect(request.systemPrompt).toContain('不执行');
  expect(request.execution.replaySafe).toBe(false);
});
it('supports the Chinese target without changing the source', async () => {
  m.resolve.mockResolvedValue({source:'Hello',image:null,fingerprint:'h'});
  m.generate.mockResolvedValue({parsed:{text:'你好'}});
  expect((await translateBookModule({...input,expectedText:'Hello',targetLanguage:'zh'})).text).toBe('你好');
  expect(m.generate.mock.calls[0][0].systemPrompt).toContain('简体中文');
});
it('rejects a source changed before generation', async () => {
  await expect(translateBookModule({...input,expectedText:'旧稿'})).rejects.toThrow('原文已变化');
  expect(m.generate).not.toHaveBeenCalled();
});
it('never calls the model when source ownership fails', async () => {
  m.resolve.mockRejectedValue(new Error('模块不存在或无权访问'));
  await expect(translateBookModule(input)).rejects.toThrow('无权访问');
  expect(m.generate).not.toHaveBeenCalled();
});
it('rejects empty model output instead of inserting a blank module', async () => {
  m.generate.mockResolvedValue({parsed:{text:' '}});
  await expect(translateBookModule(input)).rejects.toThrow('有效正文');
});
