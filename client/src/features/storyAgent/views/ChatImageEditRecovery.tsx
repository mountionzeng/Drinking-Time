import React from 'react';
import type { FailedImageEditRecovery } from '../failedImageEditRecovery';

export function ChatImageEditRecovery({ request, disabled, onQuote }: {
  request: FailedImageEditRecovery;
  disabled: boolean;
  onQuote: () => void;
}) {
  return <button type="button" className="mt-1 text-xs underline disabled:opacity-40" disabled={disabled}
    title={`用原话继续修改 #${request.ref.imageId}，只准备报价，不生成；不重试之前的文字请求。`}
    onClick={onQuote}>继续改图 / Resume edit · #{request.ref.imageId}</button>;
}
