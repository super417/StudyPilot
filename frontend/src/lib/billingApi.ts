import { apiRequest } from './httpClient';
export type BillingMode = 'byok' | 'platform';
export type PaymentChannel = 'alipay' | 'wechat';
export interface PlatformModel {
  id: string; provider: string; displayName: string; inputPricePerMillionYuan: string;
  outputPricePerMillionYuan: string; maxInputTokens: number; maxOutputTokens: number; reservationMicros?: number;
}
export interface BillingCatalog {
  status: string; models: PlatformModel[]; platformAvailable: boolean;
  channels: { id: PaymentChannel; available: boolean }[]; supportedCapabilities: string[];
}
export interface BillingOrder {
  id: string; channel: PaymentChannel; amountFen: number; state: 'pending' | 'paid' | 'failed';
  paymentUrl: string | null; codeUrl: string | null; createdAt: string;
}
export interface BillingAccount {
  status: string; mode: BillingMode; modelId: string | null; balanceMicros: number;
  reservedMicros: number; availableMicros: number;
  ledger: { id: string; kind: string; amountMicros: number; createdAt: string; description: string }[];
  orders: BillingOrder[];
}
export const fetchBillingCatalog = () => apiRequest<BillingCatalog>('/api/billing/catalog');
export const fetchBillingAccount = () => apiRequest<BillingAccount>('/api/billing/account');
export const saveBillingPreferences = (mode: BillingMode, modelId: string | null) =>
  apiRequest('/api/billing/preferences', { method: 'PUT', body: JSON.stringify({ mode, modelId }) });
export const createBillingOrder = (amountFen: number, channel: PaymentChannel, idempotencyKey: string) =>
  apiRequest<{ status: string; order: BillingOrder }>('/api/billing/orders', { method: 'POST', body: JSON.stringify({ amountFen, channel, idempotencyKey }) });
export const queryBillingOrder = (id: string) =>
  apiRequest<{ status: string; order: BillingOrder }>(`/api/billing/orders/${encodeURIComponent(id)}/query`, { method: 'POST' });
export const fetchBillingOrder = (id: string) =>
  apiRequest<{ status: string; order: BillingOrder }>(`/api/billing/orders/${encodeURIComponent(id)}`);
export function yuanToFen(value: string): number | null {
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value.trim())) return null;
  const [yuan, fraction = ''] = value.trim().split('.');
  const fen = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(fen) && fen > 0 ? fen : null;
}
// 金额解析与充值范围分开：服务端仅接受单笔 1–1000 元。
export function rechargeAmountFen(value: string): number | null {
  const fen = yuanToFen(value);
  return fen !== null && fen >= 100 && fen <= 100_000 ? fen : null;
}
export function formatMicros(value: number): string {
  return (value / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}
/** 只展示支付渠道域名的 HTTPS 链接，不渲染商户返回的 HTML。 */
export function safePaymentUrl(order: BillingOrder): string | null {
  if (!order.paymentUrl) return null;
  try {
    const url = new URL(order.paymentUrl);
    const domains = order.channel === 'alipay' ? ['alipay.com', 'alipaydev.com'] : ['weixin.qq.com', 'tenpay.com'];
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return domains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : null;
  } catch { return null; }
}
