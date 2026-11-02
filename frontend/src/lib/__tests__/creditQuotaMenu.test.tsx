import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CreditModelMenu from '../../components/chat/CreditModelMenu';
import type { CreditAccount, CreditCatalog } from '../creditsApi';

const catalog: CreditCatalog = {
  status: 'ok', platformAvailable: true, plans: [],
  models: [{ id: 'credits:deepseek-flash', provider: 'deepseek', displayName: 'DeepSeek Flash', inputPointsPerMillion: '40', outputPointsPerMillion: '160', maxInputTokens: 16000, maxOutputTokens: 4096 }],
};
function account(eligible: boolean): CreditAccount {
  return {
    status: 'ok', mode: 'platform', modelId: 'credits:deepseek-flash', testPlan: !eligible,
    availableMicroPoints: eligible ? 0 : 4000000000, reservedMicroPoints: 0,
    nextRefreshAt: '2026-11-01T00:00:00+08:00', lots: [], ledger: [],
    freeChat: { eligible, limit: 5, remaining: 3, reserved: 0, resetsAt: '2026-11-01T00:00:00+08:00' },
  };
}
describe('聊天模型入口的免费次数', () => {
  it('免费用户直接看到剩余3/5次', () => {
    const markup = renderToStaticMarkup(createElement(CreditModelMenu, { account: account(true), catalog }));
    expect(markup).toContain('免费 3/5 次');
    expect(markup).toContain('DeepSeek-V4.1-Flash');
    expect(markup).not.toContain('DeepSeek Flash');
  });
  it('测试启航套餐显示平台积分', () => {
    const markup = renderToStaticMarkup(createElement(CreditModelMenu, { account: account(false), catalog }));
    expect(markup).toContain('平台积分');
    expect(markup).not.toContain('免费 3/5 次');
  });
});
