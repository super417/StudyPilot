import path from 'node:path';
import { Module } from 'node:module';
import { describe, expect, it } from 'vitest';
import esbuild from 'esbuild';

function textOf(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(textOf);
  return [];
}

function walk(node: { props?: { children?: unknown; onClick?: () => unknown } } | null, visit: (node: { props?: { children?: unknown; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void } }) => void) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  visit(node);
  const children = node.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child as never, visit);
  } else {
    walk(children as never, visit);
  }
}

describe('GoalSubmitForm material compare', () => {
  it('比较和选择走资料接口，改目标后清掉这次比较', async () => {
    const root = path.resolve(__dirname, '../../../..');
    const calls = { compare: [] as unknown[], select: [] as unknown[], generate: 0, cleared: 0, planId: null as string | null };
    (globalThis as { __materialEntry?: typeof calls }).__materialEntry = calls;
    const comparison = {
      comparisonId: 'cmp-1',
      planId: null,
      goal: {
        goalName: '线性代数入门',
        goalDate: '2027-06-30',
        currentLevel: '学过矩阵',
        dailyMinutes: 45,
        completionCriterion: '能独立证明秩不等式',
        completionCriterionLabel: '能独立证明秩不等式',
      },
      selectedCandidateId: null,
      suggestion: { status: 'not_called', text: null },
      candidates: [
        {
          candidateId: 'doc:doc-la',
          kind: 'document',
          readStatus: 'read',
          displayName: '笔记',
          source: { docId: 'doc-la' },
          facts: {
            excerpts: [],
            unreadChunkCount: 1,
            unreadNote: '没读到不等于文档没讲。',
            prerequisite: '未知',
            coverage: '矩阵',
            duration: { status: '未知', playSeconds: null, note: '文档没有播放时长。' },
          },
        },
      ],
    };
    let index = 0;
    const boxes: unknown[] = [];
    const review = {
      reset: () => {
        index = 0;
        boxes.length = 0;
      },
      useState: (initial: unknown) => {
        const current = index++;
        if (boxes[current] === undefined) {
          const scripted = [
            '线性代数入门',
            '2027-06-30',
            '学过矩阵',
            '45',
            '能独立证明秩不等式',
            '',
            [],
            null,
            'https://example.com/course',
            comparison,
            null,
          ];
          boxes[current] = current < scripted.length ? scripted[current] : initial;
        }
        return [
          boxes[current],
          (next: unknown) => {
            const value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(boxes[current]) : next;
            boxes[current] = value;
            if (current === 9 && value === null) calls.cleared += 1;
          },
        ];
      },
    };
    (globalThis as { __materialForm?: typeof review }).__materialForm = review;
    const mocks: Record<string, string> = {
      react: `
        export const useState=(initial)=>globalThis.__materialForm.useState(initial);
        export const useRef=(initial)=>({current:initial});
        export const useEffect=()=>{};`,
      '@/lib/directionsApi': `
        export const fetchDirections=()=>Promise.resolve({status:'ok',directions:[]});`,
      '@/store': `
        export const useAssistantStore=selector=>selector({
          addMessage(){}, appendStreamChunk(){}, setStreaming(){}, stopStreaming(){}, streaming:false
        });`,
      '@/store/planSessionStore': `
        export const usePlanSessionStore=selector=>selector({
          draftId:null, clarifyQuestion:null, activePlanId:globalThis.__materialEntry.planId, lastPlanId:null,
          setClarify(){}, clearClarify(){}, setLastPlanId(){}, setActivePlanId(){}, setPreview(){}
        });
        usePlanSessionStore.getState=()=>({});`,
      '@/store/documentsStore': `
        export const useDocumentsStore=selector=>selector({
          getSelectedDocumentIds:()=>['doc-la'], markSkipped(){}, selectedIds:['doc-la']
        });`,
      '@/lib/plansApi': `
        export const streamPlanGenerate=()=>{ globalThis.__materialEntry.generate += 1; return Promise.resolve(); };
        export const streamPlanClarify=()=>Promise.resolve();
        export const planStartQuestion=()=>'start';`,
      '@/lib/materialsApi': `
        export const compareMaterials=(body)=>{ globalThis.__materialEntry.compare.push(body); return Promise.resolve(body); };
        export const selectMaterial=(id, body)=>{ globalThis.__materialEntry.select.push({id, body}); return Promise.resolve({comparisonId:id, selectedCandidateId:body.candidateId}); };`,
      '@/lib/httpClient': `export class ApiError extends Error {}`,
      './DocumentPicker': `export default function DocumentPicker(){return null;}`,
      'lucide-react': `export const X=()=>null;`,
    };
    const compiled = await esbuild.build({
      stdin: {
        contents: `
          import GoalSubmitForm from "./src/components/planner/GoalSubmitForm";
          export function form(){return GoalSubmitForm({});}`,
        resolveDir: root,
        sourcefile: 'material-compare-entry.tsx',
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      jsx: 'automatic',
      alias: { '@': path.join(root, 'src') },
      plugins: [
        {
          name: 'material-entry',
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: 'material-entry' };
              return undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'material-entry' }, (args) => ({
              contents: mocks[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const virtualPath = path.join(root, '__material_compare_entry.cjs');
    const loaded = new Module(virtualPath);
    const nodeModule = Module as typeof Module & { _nodeModulePaths: (from: string) => string[] };
    const compilable = loaded as Module & { _compile: (code: string, filename: string) => void };
    loaded.filename = virtualPath;
    loaded.paths = nodeModule._nodeModulePaths(root);
    compilable._compile(compiled.outputFiles[0].text, virtualPath);
    const tree = loaded.exports.form();
    const buttons: Array<{ label: string; onClick?: () => void }> = [];
    const inputs: Array<{ placeholder?: string; onChange?: (event: { target: { value: string } }) => void }> = [];
    walk(tree, (node) => {
      const label = textOf(node.props?.children).join('');
      const onClick = node.props?.onClick;
      if (label && onClick) buttons.push({ label, onClick });
      const placeholder = (node.props as { placeholder?: string } | undefined)?.placeholder;
      const onChange = (node.props as { onChange?: (event: { target: { value: string } }) => void } | undefined)?.onChange;
      if (placeholder && onChange) inputs.push({ placeholder, onChange });
    });
    const compare = buttons.find((button) => button.label === '比较资料');
    const select = buttons.find((button) => button.label === '选择这份');
    expect(compare).toBeTruthy();
    expect(select).toBeTruthy();
    await compare?.onClick?.();
    await select?.onClick?.();
    expect(calls.generate).toBe(0);
    expect(calls.select).toEqual([]);
    expect(calls.compare).toEqual([
      expect.objectContaining({
        goalName: '线性代数入门',
        documentIds: ['doc-la'],
        links: ['https://example.com/course'],
        planId: null,
      }),
    ]);
    calls.cleared = 0;
    inputs.find((input) => input.placeholder?.includes('要学的内容'))?.onChange?.({ target: { value: '概率论入门' } });
    expect(calls.cleared).toBe(1);

    calls.planId = 'plan-existing';
    review.reset();
    const planned: Array<{ label: string; onClick?: () => Promise<unknown> }> = [];
    walk(loaded.exports.form(), (node) => {
      const label = textOf(node.props?.children).join('');
      const onClick = node.props?.onClick as (() => Promise<unknown>) | undefined;
      if (label && onClick) planned.push({ label, onClick });
    });
    await planned.find((button) => button.label === '比较资料')?.onClick?.();
    expect(calls.generate).toBe(0);
    expect(calls.compare[1]).toEqual(expect.objectContaining({ planId: 'plan-existing', documentIds: ['doc-la'] }));
  });
});
