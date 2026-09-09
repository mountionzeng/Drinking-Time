/** Only return allowlisted codes; raw wx errors can contain URLs or private data. */
export function classifyRequestFailure(error: unknown): string {
  const message = error && typeof error === 'object' && 'errMsg' in error &&
    typeof error.errMsg === 'string' ? error.errMsg.toLowerCase() : '';
  if (message.includes('not in domain list')) return 'network_domain';
  if (message.includes('timeout') || message.includes('timed out')) return 'network_timeout';
  if (/ssl|certificate|tls/.test(message)) return 'network_tls';
  if (/name_not_resolved|dns/.test(message)) return 'network_dns';
  return 'network_error';
}
