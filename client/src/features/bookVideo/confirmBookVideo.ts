import type { BookVideoRecord } from '@shared/bookVideoCreation';

/** Planning always stops at review. Adoption requires a separate confirmation of that revision. */
export async function confirmBookVideo(record: BookVideoRecord, actions: {
  prepare(): Promise<void>;
  generate(): Promise<BookVideoRecord>;
  adopt(): Promise<unknown>;
  openTimeline(): Promise<void>;
  review(record: BookVideoRecord): Promise<void>;
}, reviewedRevision?: number) {
  if (record.status !== 'adopted') {
    if (!record.brief) throw new Error('请先整理制作条件。');
    await actions.prepare();
    const ready = record.preview ? record : await actions.generate();
    if (!ready.preview) throw new Error('正在整理分镜，请稍后再次点击同一个确认按钮；已完成的步骤会继续使用。');
    if(!record.preview || reviewedRevision !== ready.revision) { await actions.review(ready); return; }
    await actions.adopt();
  }
  await actions.openTimeline();
}
