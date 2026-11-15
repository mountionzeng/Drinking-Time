/** Preserve the uncertain billing state while giving the user an actionable explanation. */
export function inferenceFailureMessage(message: string): string {
  return message === 'LLM submission outcome unknown; reconciliation required'
    ? '对话服务连接中断，本次回复是否完成及费用仍在核对。请先不要重复发送；你输入的内容不会覆盖已有故事。'
    : message;
}
