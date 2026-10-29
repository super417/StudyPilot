import { useEffect, useRef, useState } from 'react';
import { creditModelGroups } from '@/lib/creditModelOptions';
import { saveCreditPreferences, type CreditAccount, type CreditCatalog } from '@/lib/creditsApi';

export default function CreditModelMenu({ account, catalog }: { account: CreditAccount; catalog: CreditCatalog }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const working = useRef(false);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const current = catalog.models.find((model) => model.id === account.modelId);
  const choose = async (id: string) => {
    if (working.current || !catalog.platformAvailable || !catalog.models.some((model) => model.id === id)) return;
    working.current = true; setBusy(true); setError('');
    try { await saveCreditPreferences('platform', id); setOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : '模型切换失败'); }
    finally { working.current = false; setBusy(false); }
  };
  return <div ref={root} className="relative min-w-0">
    <button type="button" aria-label="积分模型选择" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="h-8 max-w-full truncate rounded-full border border-emerald-800 bg-[#04150e] px-3 text-xs text-emerald-200">✧ {current?.displayName ?? '积分模型暂不可用'} · 平台积分 ▾</button>
    {open && <div role="menu" aria-label="积分模型选择" className="absolute bottom-[calc(100%+8px)] right-0 z-30 max-h-[55vh] w-[304px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl border border-emerald-800 bg-[#04150e] p-3 text-emerald-100 shadow-xl">
      <p className="text-xs text-emerald-300">平台积分模型</p>
      {creditModelGroups(catalog.models).map((group) => <div key={group.id} className="mt-3"><p className="text-xs text-emerald-200/70">{group.name}</p>{group.models.length ? group.models.map((model) => <button key={model.id} type="button" role="menuitemradio" aria-checked={account.modelId === model.id} disabled={busy || !catalog.platformAvailable} onClick={() => void choose(model.id)} className="mt-1 flex w-full justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-emerald-900 disabled:opacity-50"><span>{model.displayName}</span>{account.modelId === model.id && <span>✓</span>}</button>) : <button type="button" role="menuitem" disabled className="w-full px-2 py-2 text-left text-xs text-emerald-200/40">{group.name} · 待接入</button>}</div>)}
      <p className="mt-3 text-xs text-emerald-200/60">未接入模型暂不能启用。积分单价以平台目录为准。</p>
      {current && <p className="mt-2 text-xs">输入 {current.inputPointsPerMillion} / 输出 {current.outputPointsPerMillion} 积分／百万 token；不启用思考模式。</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </div>}
  </div>;
}
