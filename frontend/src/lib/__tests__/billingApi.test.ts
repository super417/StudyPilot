import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBillingOrder, fetchBillingAccount, fetchBillingCatalog, fetchBillingOrder,
  formatMicros, queryBillingOrder, safePaymentUrl, saveBillingPreferences, yuanToFen, type BillingOrder,
} from '../billingApi';
import { generatePaymentQr } from '../paymentQr';
const order: BillingOrder = { id: 'a/b', channel: 'alipay', amountFen: 100, state: 'pending', paymentUrl: null, codeUrl: null, createdAt: '2026-10-29' };
const fetchMock = vi.fn();
describe('平台余额请求与金额边界', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ status: 'ok', order }), { status: 200 }));
  });
  afterEach(() => vi.unstubAllGlobals());
  it('金额精确转分，拒绝指数/负数/三位小数/零和不安全整数', () => {
    expect(yuanToFen('0.01')).toBe(1);
    expect(yuanToFen('12.30')).toBe(1230);
    expect(yuanToFen('1.1')).toBe(110);
    for (const value of ['1e2', '-1', '0', '1.001', '01', '', '90071992547409910']) expect(yuanToFen(value)).toBeNull();
    expect(formatMicros(1234567)).toBe('1.234567');
  });
  it('创建订单保留幂等key与整数分，不在前端伪造成功', async () => {
    const result = await createBillingOrder(1230, 'wechat', 'same-retry-key');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/billing/orders');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body)).toEqual({ amountFen: 1230, channel: 'wechat', idempotencyKey: 'same-retry-key' });
    expect(result.order.state).toBe('pending');
  });
  it('显式保存使用方式，查询订单使用服务端接口和编码ID', async () => {
    await saveBillingPreferences('platform', 'model-a');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ mode: 'platform', modelId: 'model-a' });
    await saveBillingPreferences('byok', null);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ mode: 'byok', modelId: null });
    await fetchBillingOrder(order.id); await queryBillingOrder(order.id);
    expect(fetchMock.mock.calls[2][0]).toBe('/api/billing/orders/a%2Fb');
    expect(fetchMock.mock.calls[3][0]).toBe('/api/billing/orders/a%2Fb/query');
    expect(fetchMock.mock.calls[3][1].method).toBe('POST');
  });
  it('目录与账户真实读取；401不能被包装成零余额', async () => {
    await fetchBillingCatalog(); await fetchBillingAccount();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/billing/catalog', '/api/billing/account']);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'AUTH_REQUIRED', message: '请登录' }), { status: 401 }));
    await expect(fetchBillingAccount()).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
  });
  it('拒绝脚本URL、伪装域名、明文HTTP与带用户信息的链接', () => {
    expect(safePaymentUrl({ ...order, paymentUrl: 'https://openapi.alipay.com/gateway.do?order=a' })).toContain('openapi.alipay.com');
    for (const paymentUrl of ['javascript:alert(1)', 'https://alipay.com.evil.example/pay', 'http://openapi.alipay.com/pay', 'https://x@openapi.alipay.com/pay', 'data:text/html,hello']) expect(safePaymentUrl({ ...order, paymentUrl })).toBeNull();
    expect(safePaymentUrl({ ...order, channel: 'wechat', paymentUrl: 'https://pay.weixin.qq.com/pay' })).toContain('weixin.qq.com');
    expect(safePaymentUrl({ ...order, channel: 'wechat', paymentUrl: 'https://openapi.alipay.com/pay' })).toBeNull();
  });
  it('服务端订单失败或账本不可读时保留错误，不自增余额', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'PAYMENT_UNAVAILABLE', message: '支付未配置' }), { status: 503 }));
    await expect(createBillingOrder(100, 'alipay', 'same-key')).rejects.toMatchObject({ status: 503 });
  });
});
describe('微信本地支付二维码', () => {
  it('使用真实本地库生成PNG，不请求外部二维码服务', async () => {
    const image = await generatePaymentQr('weixin://wxpay/bizpayurl?pr=test-only-no-payment');
    expect(image).toMatch(/^data:image\/png;base64,iVBOR/);
    const buffer = Buffer.from(image.split(',')[1], 'base64');
    expect(buffer.readUInt32BE(16)).toBe(256);
    expect(buffer.readUInt32BE(20)).toBe(256);
  });
  it('拒绝空内容与超长内容', async () => {
    await expect(generatePaymentQr('')).rejects.toThrow();
    await expect(generatePaymentQr('x'.repeat(2049))).rejects.toThrow();
  });
});
