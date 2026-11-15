import {expect,it} from 'vitest';
import {inferenceFailureMessage} from './inferenceFailureMessage';
it('explains unknown submission without promising a refund or automatic retry',()=>{
 const text=inferenceFailureMessage('LLM submission outcome unknown; reconciliation required');
 expect(text).toContain('费用仍在核对');expect(text).toContain('不要重复发送');expect(text).not.toMatch(/已退款|未扣费|自动重试/);
 expect(inferenceFailureMessage('unrelated')).toBe('unrelated');
});
