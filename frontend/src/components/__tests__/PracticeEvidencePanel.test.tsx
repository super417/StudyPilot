import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PracticeEvidencePanel, { PracticeEvidenceView } from '../PracticeEvidencePanel';
import { fetchPracticeEvidence, type PracticeEvidenceResponse } from '@/lib/practiceApi';
const client = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/lib/httpClient', () => ({ apiRequest: client.apiRequest }));

const data: PracticeEvidenceResponse = {
  status: 'ok', question: { id: 'q-1', phaseId: 'phase-1', phaseName: '阶段A', practiceType: 'reinforce_retest' },
  evidence: [{ id: 'e-1', evidenceType: 'quiz', createdAt: '2026-11-01T12:00:00Z', phaseId: 'phase-1', phaseName: '阶段A', answerText: '原始答卷', result: 'partial', reason: '旧格式判分理由', sourceRef: 'doc#0', source: { status: 'available', label: '当前资料片段；不是判分当时的历史快照。', docId: 'doc', chunkIndex: 0, filename: '讲义.txt', content: '当前片段', pageStart: 3 } }],
};
describe('判分记录与依据', () => {
  it('只读API路径按题编码，保留历史响应而不把出题引用替代判分来源', async () => {
    client.apiRequest.mockResolvedValueOnce(data);
    expect(await fetchPracticeEvidence('q/1')).toBe(data);
    expect(client.apiRequest).toHaveBeenLastCalledWith('/api/practice/q%2F1/evidence');
  });
  it('默认折叠，不因渲染自动读模型或判分', () => {
    client.apiRequest.mockClear();
    const html=renderToStaticMarkup(createElement(PracticeEvidencePanel, {questionId:'q-1',revision:''}));
    expect(html).toContain('判分记录与依据');
    expect(html).toContain('aria-expanded="false"');
    expect(client.apiRequest).not.toHaveBeenCalled();
  });
  it('展示当次答卷理由、阶段、当前非历史快照及重测边界', () => {
    const html=renderToStaticMarkup(createElement(PracticeEvidenceView,{data}));
    for(const value of ['原始答卷','旧格式判分理由','阶段A','不是判分当时的历史快照','讲义.txt','当前片段','同阶段新题重测','保留历史判分','北京时间','2026-11-01 20:00:00']) expect(html).toContain(value);
  });
  it('资料不可用不冒充仍有摘录，未判分也显示阶段与来源', () => {
    const unavailable: PracticeEvidenceResponse={...data,evidence:[{...data.evidence[0],source:{status:'unavailable',label:'判分来源当前不可用，未保存历史摘录快照。'}}]};
    const html=renderToStaticMarkup(createElement(PracticeEvidenceView,{data:unavailable}));
    expect(html).toContain('当前不可用');expect(html).not.toContain('当前片段');
    const blank=renderToStaticMarkup(createElement(PracticeEvidenceView,{data:{...data,evidence:[]}}));
    expect(blank).toContain('尚无判分记录');expect(blank).toContain('阶段A');expect(blank).toContain('同阶段新题重测');
  });
});
