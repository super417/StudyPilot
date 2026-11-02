import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PracticeEvidenceView } from '../PracticeEvidencePanel';
import type { PracticeEvidenceResponse } from '@/lib/practiceApi';

it('distinguishes historical and insufficient sources from literal matches', () => {
  const data: PracticeEvidenceResponse = {status:'ok', question:{id:'q',phaseId:null,phaseName:null,practiceType:'uploaded'}, evidence:[{id:'e',evidenceType:'quiz',createdAt:'2026-11-01T12:00:00Z',phaseId:null,phaseName:null,answerText:'答',result:'correct',reason:'理由',sourceRef:'doc#0',source:{status:'available',label:'当前资料片段',quoteCheck:'matched',sourceQuote:'原文短句'}}]};
  const render=()=>renderToStaticMarkup(createElement(PracticeEvidenceView,{data}));
  expect(render()).toContain('不代表语义支持判分');
  expect(render()).toContain('原文短句');
  data.evidence[0].source.quoteCheck='insufficient';
  expect(render()).toContain('依据不足');
  data.evidence[0].source.quoteCheck='unverified';
  expect(render()).toContain('引用未经核验');
});
