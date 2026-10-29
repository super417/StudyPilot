import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PlatformBillingCard from '../profile/PlatformBillingCard';
import PricingPostcardStack, { PRICING_POSTCARDS } from '../overview/PricingPostcardStack';

describe('自带 Key 仅在个人中心高级设置管理', () => {
  it('高级设置默认收起且内容仍挂载，折叠无需销毁配置表单', () => {
    const html = renderToStaticMarkup(
      <PlatformBillingCard
        advancedSettings={<input name="original-api-config-field" defaultValue="unsaved-edit" />}
      />,
    );
    const details = html.match(/<details class="billing-advanced"[^>]*>/)?.[0];
    expect(details).toBeDefined();
    expect(details).not.toContain(' open');
    expect(html).toContain('高级设置 · 自带 API Key');
    expect(html.match(/name="original-api-config-field"/g)).toHaveLength(1);
    expect(html).toContain('value="unsaved-edit"');
  });
  it('付费方案保留补给包第三卡，嵌入账户不提供自带Key配置入口', () => {
    expect(PRICING_POSTCARDS.map((item) => item.name)).toEqual(['免费版', '启航版', '补给包']);
    const pricing = renderToStaticMarkup(createElement(PricingPostcardStack));
    expect(pricing).toContain('3 项学习方案');
    expect(pricing).toContain('补充额度');
    expect(pricing).toContain('1,000 积分');
    expect(PRICING_POSTCARDS[2].detail).toContain('购买暂未开放');
    expect(pricing).not.toContain('自带 Key');
    expect(pricing).not.toContain('三档');
    const embedded = renderToStaticMarkup(createElement(PlatformBillingCard));
    expect(embedded).not.toContain('billing-advanced');
    expect(embedded).not.toContain('高级设置');
    expect(embedded).not.toContain('original-api-config-field');
  });
});
