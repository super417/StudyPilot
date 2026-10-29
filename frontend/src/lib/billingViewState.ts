import type { BillingOrder, PlatformModel, BillingAccount, BillingMode } from './billingApi';

const CAPABILITIES: Record<string, string> = {
  assistant_chat: '学习助手对话', planning: '学习规划', diagnosis: '学习诊断', practice: '练习与判题',
};
export function billingCapabilityLabels(capabilities: string[]): string[] {
  return [...new Set(capabilities)].map((item) => CAPABILITIES[item] ?? item);
}
/** 只在首次载入恢复待支付订单；暂不支付后刷新不会重新选回。 */
export function reconcileBillingOrder(current: BillingOrder | null, orders: BillingOrder[], recoverPending: boolean): BillingOrder | null {
  return current ? orders.find((item) => item.id === current.id) ?? current
    : recoverPending ? orders.find((item) => item.state === 'pending') ?? null : null;
}
export interface BillingPreferenceDraft { mode: BillingMode; modelId: string; provider: string }
export function reconcileBillingDraft(current: BillingPreferenceDraft, account: BillingAccount, models: PlatformModel[], edited: boolean): BillingPreferenceDraft {
  return edited ? current : {
    mode: account.mode, modelId: account.modelId ?? '',
    provider: models.find((item) => item.id === account.modelId)?.provider ?? '',
  };
}
