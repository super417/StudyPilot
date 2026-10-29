import { creditModelGroups, CREDIT_SELECTION_CHANGED } from '@/lib/creditModelOptions';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchBillingAccount, formatMicros, type BillingAccount } from '@/lib/billingApi';
import { fetchCreditAccount, fetchCreditCatalog, saveCreditPreferences, formatPoints, type CreditAccount, type CreditCatalog } from '@/lib/creditsApi';
import './PlatformBillingCard.css';

const kindLabel: Record<string, string> = { test_base: '测试基础积分', test_bonus: '测试赠送积分', monthly_grant: '月度发放', usage: '模型消费', free: '免费基础积分', base: '套餐基础积分', bonus: '活动赠送积分', supply: '补给积分', grant: '发放', consume: '模型消费', charge: '模型消费', expire: '到期' };
export default function PlatformBillingCard({ advancedSettings }: { advancedSettings?: ReactNode } = {}) {
  const [catalog, setCatalog] = useState<CreditCatalog | null>(null);
  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [legacy, setLegacy] = useState<BillingAccount | null>(null);
  const [legacyError, setLegacyError] = useState(false);
  const [modelId, setModelId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(true);
  const edited = useRef(false);
  const working = useRef(false);
  const reload = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [nextCatalog, nextAccount] = await Promise.all([fetchCreditCatalog(), fetchCreditAccount()]);
      if (!mounted.current) return;
      setCatalog(nextCatalog); setAccount(nextAccount);
      if (!edited.current) setModelId(nextAccount.modelId ?? '');
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '积分账户暂时无法读取，请重试。'); }
    finally { if (mounted.current) setBusy(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void reload();
    void fetchBillingAccount().then((value) => { if (mounted.current) setLegacy(value); }).catch(() => { if (mounted.current) setLegacyError(true); });
    return () => { mounted.current = false; };
  }, [reload]);
  const save = async (mode: 'byok' | 'platform') => {
    if (working.current || busy || !account) return;
    if (mode === 'platform' && (!catalog?.platformAvailable || !catalog.models.some((m) => m.id === modelId))) return;
    working.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await saveCreditPreferences(mode, mode === 'platform' ? modelId : null);
      edited.current = false; await reload();
      if (mounted.current) setNotice(mode === 'platform' ? '已启用所选积分模型。' : '已切换为自带 Key，原有配置继续保留。');
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '保存失败，请重试。'); }
    finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => { const refresh = () => { void reload(); }; window.addEventListener(CREDIT_SELECTION_CHANGED, refresh); return () => window.removeEventListener(CREDIT_SELECTION_CHANGED, refresh); }, [reload]);
  const model = catalog?.models.find((item) => item.id === modelId);
  return <section className="platform-billing" aria-labelledby="platform-billing-title" aria-busy={busy}>
    <header><p>STUDYPILOT · AI 账户</p><h2 id="platform-billing-title">平台积分与模型选择</h2><button type="button" disabled={busy} onClick={() => void reload()}>刷新账户</button></header>
    <p>免费版每个自然月发放 500 积分，当月有效、不结转。模型按实际输入与输出 token 用量结算，积分不对应固定调用次数。</p>
    {busy && <p role="status">正在读取账户…</p>}
    {error && <p role="alert" className="billing-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {account && <>
      <p><strong>{account.planName ?? (account.testPlan ? '启航版（测试）' : '免费版')}</strong>{account.testPlan && ' · 测试权益，不代表真实购买或付款。'}</p>
      <dl className="billing-balances"><div><dt>可用积分</dt><dd>{formatPoints(account.availableMicroPoints)}</dd></div><div><dt>调用预留积分</dt><dd>{formatPoints(account.reservedMicroPoints)}</dd></div></dl>
      <p>下次免费积分刷新：{account.nextRefreshAt.replace('+', ' ')}</p>
      <p>当前使用方式：{account.mode === 'byok' ? '自带 API Key' : account.modelId?.startsWith('credits:') ? '平台积分' : '原人民币余额模型'}。选择模型后，点击启用才会改变使用方式。</p>
      <fieldset disabled={busy}><legend>选择积分模型</legend>
        {!catalog?.platformAvailable && <p>平台积分模型暂未开放；已有积分不会因浏览而扣除。</p>}
        <label>模型<select value={modelId} onChange={(e) => { edited.current = true; setModelId(e.target.value); }}><option value="">请选择已开放模型</option>{creditModelGroups(catalog?.models ?? []).map((group) => <optgroup key={group.id} label={group.name}>{group.models.length ? group.models.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>) : <option disabled value={`pending:${group.id}`}>{group.name} · 待接入</option>}</optgroup>)}</select></label>
        <p className="billing-note">未接入的供应商仅供浏览，暂不能启用；实际可用模型与积分单价以平台目录为准。</p>
        {model && <p>输入 {model.inputPointsPerMillion} 积分／百万 token · 输出 {model.outputPointsPerMillion} 积分／百万 token。单次输入上限 {model.maxInputTokens}、输出上限 {model.maxOutputTokens} token。这是 StudyPilot 试运行价。</p>}
        <button type="button" disabled={!catalog?.platformAvailable || !model} onClick={() => void save('platform')}>启用所选积分模型</button>
      </fieldset>
      <details><summary>积分来源与到期时间</summary>{account.lots.length ? account.lots.map((lot) => <p key={lot.id}>{kindLabel[lot.kind] ?? lot.kind} · 剩余 {formatPoints(lot.remainingMicroPoints)} 积分 · 预留 {formatPoints(lot.reservedMicroPoints)} · 到期 {lot.expiresAt}</p>) : <p>暂无积分批次。</p>}<p>优先使用临期积分；同日到期时优先基础积分。</p></details>
      <details><summary>积分明细（{account.ledger.length}）</summary>{account.ledger.length ? <ul>{account.ledger.map((item) => <li key={item.id}>{item.createdAt} · {kindLabel[item.kind] ?? item.kind} · {formatPoints(item.amountMicroPoints)} 积分</li>)}</ul> : <p>暂无积分变动。</p>}</details>
    </>}
    <details><summary>启航版与补给包</summary><p>启航版：99 元单月、70 元连续包月、672 元连续包年；每月基础 2,000 积分，活动期间每月赠送 2,000 积分。补给包：50 元／1,000 积分，有效期一个月。</p><p>套餐购买、自动续费与补给包购买暂未开放。此处不收款，也不会通过旧余额充值发放积分。</p></details>
    <details><summary>原人民币余额与订单记录</summary><p>原余额保留，不自动兑换积分。</p>{legacy ? <><p>余额 ¥{formatMicros(legacy.balanceMicros)} · 预留 ¥{formatMicros(legacy.reservedMicros)}</p>{legacy.orders.map((o) => <p key={o.id}>{o.createdAt} · ¥{(o.amountFen / 100).toFixed(2)} · {o.state}</p>)}{legacy.ledger.map((item) => <p key={item.id}>{item.createdAt} · {item.description || item.kind} · ¥{formatMicros(item.amountMicros)}</p>)}</> : <p>{legacyError ? '原余额记录读取失败，请稍后重新打开页面。' : '正在读取原余额记录…'}</p>}</details>
    {advancedSettings && <details className="billing-advanced"><summary>高级设置 · 自带 API Key</summary><p>使用自己的 Key，由供应商直接计费，不扣平台积分。展开或收起不会删除配置。</p><button type="button" disabled={busy || !account || account.mode === 'byok'} onClick={() => void save('byok')}>{account?.mode === 'byok' ? '当前已使用自带 Key' : '切换为自带 Key'}</button>{advancedSettings}</details>}
  </section>;
}
