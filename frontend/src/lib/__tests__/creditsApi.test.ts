import { describe, expect, it } from 'vitest';
import { formatPoints } from '../creditsApi';
import { PRICING_POSTCARDS } from '../../components/overview/PricingPostcardStack';

describe('积分定价与精度', () => {
  it('保留最小积分消费精度，不显示为人民币', () => {
    expect(formatPoints(1)).toBe('0.000001');
    expect(formatPoints(500000000)).toBe('500');
    expect(formatPoints(-320)).toBe('-0.00032');
  });
  it('赠送按活动每月发放且未开放购买不伪装成功', () => {
    expect(PRICING_POSTCARDS[1].detail).toContain('672');
    expect(PRICING_POSTCARDS[1].features[0]).toContain('并非只赠首月');
    expect(PRICING_POSTCARDS[1].blurb).toContain('暂未开放');
    expect(PRICING_POSTCARDS[2].detail).toContain('一个月');
  });
});

it('免费权益是每月五轮对话，不再承诺500积分', () => {
  expect(PRICING_POSTCARDS[0].category).toContain('5 轮');
  expect(PRICING_POSTCARDS[0].detail).toContain('失败不扣次数');
  expect(JSON.stringify(PRICING_POSTCARDS[0])).not.toContain('500');
});
