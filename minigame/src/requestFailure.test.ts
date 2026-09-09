import { expect, it } from 'vitest';
import { classifyRequestFailure } from './requestFailure';
import { createLiveClient } from './liveClient';

it.each([
  ['request:fail url not in domain list', 'network_domain'],
  ['request:fail timeout', 'network_timeout'],
  ['request:fail ssl hand shake error', 'network_tls'],
  ['request:fail certificate expired', 'network_tls'],
  ['request:fail ERR_NAME_NOT_RESOLVED', 'network_dns'],
  ['request:fail interrupted', 'network_error'],
])('classifies %s without returning raw diagnostics', (errMsg, expected) => {
  expect(classifyRequestFailure({ errMsg })).toBe(expected);
});

it('never exposes arbitrary error data or credentials', () => {
  expect(classifyRequestFailure({ errMsg: 'secret-token private@example.com' })).toBe('network_error');
  expect(classifyRequestFailure(null)).toBe('network_error');
  expect(classifyRequestFailure({ errMsg: 42 })).toBe('network_error');
});

it.each(['network_domain', 'network_timeout', 'network_tls', 'network_dns', 'network_error'])(
  'renders safe actionable feedback for %s and ends the login spinner', async code => {
    const client = createLiveClient(async () => { throw new Error(code); }, () => {});
    await client.loginWechat('test-code');
    expect(client.getState().authenticated).toBe(false);
    expect(client.getState().busy).toBe(false);
    expect(client.getState().error).toContain(code);
  },
);
