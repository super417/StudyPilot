import { describe, expect, it } from 'vitest';
import { rechargeAmountFen, type BillingAccount, type BillingOrder, type PlatformModel } from '../billingApi';
import { billingCapabilityLabels, reconcileBillingDraft, reconcileBillingOrder } from '../billingViewState';
const pending: BillingOrder = { id: 'pending-a', channel: 'wechat', amountFen: 100, state: 'pending', paymentUrl: null, codeUrl: null, createdAt: '2026-10-29' };
const account: BillingAccount = { status: 'ok', mode: 'byok', modelId: null, balanceMicros: 0, reservedMicros: 0, availableMicros: 0, orders: [pending], ledger: [] };
const models: PlatformModel[] = [{ id: 'model-b', provider: 'provider-b', displayName: 'Model B', inputPricePerMillionYuan: '2', outputPricePerMillionYuan: '4', maxInputTokens: 1000, maxOutputTokens: 1000, reservationMicros: 6000 }];
describe('计费刷新与重新充值边界', () => {
  it('充值范围对齐服务端1–1000元，精确支持分，不接受范围外金额', () => {
    expect(rechargeAmountFen('1')).toBe(100);
    expect(rechargeAmountFen('999.99')).toBe(99999);
    expect(rechargeAmountFen('1000.00')).toBe(100000);
    for (const input of ['0.01', '0.99', '1000.01', '1001', '1e2', '1.001', '-1']) expect(rechargeAmountFen(input)).toBeNull();
  });
  it('仅首次加载恢复待支付订单，放弃本次选择后刷新不重选，也不篡改服务端状态', () => {
    expect(reconcileBillingOrder(null, account.orders, true)?.id).toBe(pending.id);
    expect(reconcileBillingOrder(null, account.orders, false)).toBeNull();
    expect(pending.state).toBe('pending');
    expect(account.orders).toEqual([pending]);
  });
  it('历史中重新打开待支付单仍可查询，只有服务端paid才更新选中订单', () => {
    expect(reconcileBillingOrder(pending, account.orders, false)?.state).toBe('pending');
    expect(reconcileBillingOrder(pending, [{ ...pending, state: 'paid' }], false)?.state).toBe('paid');
  });
  it('刷新账本或支付完成时保留尚未保存的模型选择', () => {
    const draft = { mode: 'platform' as const, modelId: 'model-b', provider: 'provider-b' };
    expect(reconcileBillingDraft(draft, account, models, true)).toEqual(draft);
    expect(reconcileBillingDraft(draft, account, models, false)).toEqual({ mode: 'byok', modelId: '', provider: '' });
    expect(reconcileBillingDraft(draft, { ...account, mode: 'platform', modelId: 'model-b' }, models, false)).toEqual(draft);
  });
  it('能力名称来自目录数组，不宣传目录未返回的能力', () => {
    expect(billingCapabilityLabels(['assistant_chat', 'planning', 'diagnosis', 'practice'])).toEqual(['学习助手对话', '学习规划', '学习诊断', '练习与判题']);
    expect(billingCapabilityLabels(['assistant_chat'])).toEqual(['学习助手对话']);
    expect(billingCapabilityLabels([])).toEqual([]);
  });
});
