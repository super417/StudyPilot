import path from 'node:path';
import { Module } from 'node:module';
import { describe, expect, it } from 'vitest';
import esbuild from 'esbuild';

function visit(node: unknown, callback: (node: { type?: unknown; props?: Record<string, unknown> }) => void) {
  if (Array.isArray(node)) {
    node.forEach((child) => visit(child, callback));
    return;
  }
  if (!node || typeof node !== 'object') return;
  callback(node as { type?: unknown; props?: Record<string, unknown> });
  visit((node as { props?: { children?: unknown } }).props?.children, callback);
}

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text((node as { props?: { children?: unknown } }).props?.children);
  return '';
}

function deferred() {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('GoalSubmitForm stale material results', () => {
  it('挂起响应、逆序比较和规划切换不能恢复旧选择，并显示实际来源', async () => {
    const root = path.resolve(__dirname, '../../../..');
    const slots: Array<{ value: unknown }> = [];
    let cursor = 0;
    const observed = {
      planId: null as string | null,
      compare: (_body: unknown) => Promise.resolve({}),
      select: (_id: string, _body: unknown) => Promise.resolve({}),
    };
    (globalThis as { __materialStale?: unknown }).__materialStale = {
      useState(initial: unknown) {
        const index = cursor++;
        if (!slots[index]) slots[index] = { value: initial };
        return [
          slots[index].value,
          (value: unknown) => {
            slots[index].value = typeof value === 'function' ? (value as (prev: unknown) => unknown)(slots[index].value) : value;
          },
        ];
      },
      useRef(initial: unknown) {
        const index = cursor++;
        if (!slots[index]) slots[index] = { value: { current: initial } };
        return slots[index].value;
      },
      observed,
    };
    const mocks: Record<string, string> = {
      react: `
        export const useState=(value)=>globalThis.__materialStale.useState(value);
        export const useRef=(value)=>globalThis.__materialStale.useRef(value);
        export const useEffect=()=>{};`,
      '@/lib/directionsApi': `
        export const fetchDirections=()=>Promise.resolve({status:'ok',directions:[]});`,
      '@/store': `
        export const useAssistantStore=selector=>selector({
          addMessage(){}, appendStreamChunk(){}, setStreaming(){}, stopStreaming(){}, streaming:false
        });`,
      '@/store/planSessionStore': `
        export const usePlanSessionStore=selector=>selector({
          draftId:null, clarifyQuestion:null, activePlanId:globalThis.__materialStale.observed.planId,
          lastPlanId:null, setClarify(){}, clearClarify(){}, setLastPlanId(){}, setActivePlanId(){}, setPreview(){}
        });
        usePlanSessionStore.getState=()=>({});`,
      '@/store/documentsStore': `
        export const useDocumentsStore=selector=>selector({
          selectedIds:['original'], getSelectedDocumentIds:()=>['original'], markSkipped(){}
        });`,
      '@/lib/plansApi': `
        export const streamPlanGenerate=()=>{ throw new Error('不应生成'); };
        export const streamPlanClarify=()=>{ throw new Error('不应生成'); };
        export const planStartQuestion=()=>'start';`,
      '@/lib/materialsApi': `
        export const compareMaterials=body=>globalThis.__materialStale.observed.compare(body);
        export const selectMaterial=(id,body)=>globalThis.__materialStale.observed.select(id,body);`,
      '@/lib/httpClient': `export class ApiError extends Error {}`,
      './DocumentPicker': `export default function DocumentPicker(){return null;}`,
      'lucide-react': `export const X=()=>null;`,
    };
    const compiled = await esbuild.build({
      stdin: {
        contents: `import Form from "./src/components/planner/GoalSubmitForm"; export const form=()=>Form({});`,
        resolveDir: root,
        sourcefile: 'material-stale.tsx',
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
          name: 'material-stale',
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: 'material-stale' };
              return undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'material-stale' }, (args) => ({
              contents: mocks[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const virtualPath = path.join(root, '__material_stale.cjs');
    const loaded = new Module(virtualPath);
    const nodeModule = Module as typeof Module & { _nodeModulePaths: (from: string) => string[] };
    const compilable = loaded as Module & { _compile: (code: string, filename: string) => void };
    loaded.filename = virtualPath;
    loaded.paths = nodeModule._nodeModulePaths(root);
    compilable._compile(compiled.outputFiles[0].text, virtualPath);

    function render() {
      cursor = 0;
      return loaded.exports.form();
    }
    function button(tree: unknown, label: string) {
      let found: { props?: { onClick?: () => Promise<unknown>; disabled?: boolean } } | undefined;
      visit(tree, (node) => {
        if (node.type === 'button' && text(node) === label) found = node;
      });
      return found;
    }
    function input(tree: unknown, predicate: (props: Record<string, unknown>) => boolean) {
      let found: { props: Record<string, unknown> } | undefined;
      visit(tree, (node) => {
        if (node.type === 'input' && node.props && predicate(node.props)) found = node as { props: Record<string, unknown> };
      });
      if (!found) throw new Error('缺少输入框');
      return found;
    }
    const goal = {
      goalName: '线性代数入门',
      goalDate: '2027-06-30',
      currentLevel: '学过矩阵',
      dailyMinutes: 45,
      completionCriterion: '能独立证明秩不等式',
      completionCriterionLabel: '能独立证明秩不等式',
    };
    function response(id: string, planId: string | null = null, goalOverride = goal) {
      return {
        comparisonId: id,
        planId,
        goal: goalOverride,
        selectedCandidateId: null,
        suggestion: { status: 'not_called', text: null },
        candidates: [
          {
            candidateId: 'link:0',
            kind: 'link',
            readStatus: 'read',
            displayName: 'course',
            source: { url: 'https://example.com/actual-source' },
            usableSource: true,
            facts: {
              excerpts: [],
              unreadNote: '',
              unreadChunkCount: 0,
              prerequisite: '未知',
              coverage: 'matrix rank',
              duration: { status: '已知', playSeconds: 371, note: '已读播放时长不是完整学习耗时。' },
            },
          },
          {
            candidateId: 'doc:original',
            kind: 'document',
            readStatus: 'read',
            displayName: 'notes.pdf',
            source: { docId: 'original' },
            usableSource: true,
            facts: {
              excerpts: [{ chunkIndex: 8, content: 'proof excerpt', contentHash: 'hash', pageStart: 17 }],
              unreadNote: '',
              unreadChunkCount: 0,
              prerequisite: '未知',
              coverage: 'proof excerpt',
              duration: { status: '未知', playSeconds: null, note: '文档没有播放时长。' },
            },
          },
        ],
      };
    }
    function fill(planId: string | null = null) {
      slots.length = 0;
      observed.planId = planId;
      const tree = render();
      (input(tree, (props) => String(props.placeholder || '').startsWith('要学')).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: goal.goalName } });
      (input(tree, (props) => props.type === 'date').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: goal.goalDate } });
      (input(tree, (props) => props.type === 'number').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '45' } });
      (input(tree, (props) => String(props.placeholder || '').startsWith('当前基础')).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: goal.currentLevel } });
      (input(tree, (props) => props['aria-label'] === '完成标准').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: goal.completionCriterion } });
    }

    fill();
    const waiting = deferred();
    observed.compare = () => waiting.promise;
    const pending = button(render(), '比较资料')?.props?.onClick?.();
    await new Promise((done) => setImmediate(done));
    (input(render(), (props) => String(props.placeholder || '').startsWith('要学')).props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: '概率论入门' },
    });
    waiting.resolve(response('old-goal'));
    await pending;
    expect(text(render())).not.toContain('matrix rank');

    fill();
    const first = deferred();
    const second = deferred();
    let count = 0;
    observed.compare = () => (++count === 1 ? first.promise : second.promise);
    const firstPending = button(render(), '比较资料')?.props?.onClick?.();
    await new Promise((done) => setImmediate(done));
    const secondPending = button(render(), '比较资料')?.props?.onClick?.();
    await new Promise((done) => setImmediate(done));
    second.resolve(response('new'));
    await secondPending;
    first.resolve(response('old'));
    await firstPending;
    let selectedComparison = '';
    observed.select = async (id: string) => {
      selectedComparison = id;
      return response(id);
    };
    await button(render(), '选择这份')?.props?.onClick?.();
    expect(selectedComparison).toBe('new');

    fill('plan-a');
    observed.compare = async () => response('plan-a-comparison', 'plan-a', {
      ...goal,
      goalName: '规划里的线性代数',
      completionCriterionLabel: '规划里的完成标准',
    });
    await button(render(), '比较资料')?.props?.onClick?.();
    const planned = text(render());
    expect(planned).toContain('规划里的线性代数');
    expect(planned).toContain('plan-a');
    expect(planned).toContain('https://example.com/actual-source');
    expect(planned).toContain('371');
    expect(planned).toContain('17');
    expect(planned).toMatch(/8/);
    observed.planId = 'plan-b';
    let calls = 0;
    observed.select = async () => {
      calls += 1;
      return response('plan-a-comparison', 'plan-a');
    };
    const selectable = button(render(), '选择这份');
    if (selectable && !selectable.props?.disabled) await selectable.props?.onClick?.();
    expect(calls).toBe(0);

    fill();
    const tagged = (id: string) => {
      const body = response(id);
      body.candidates = [{ ...body.candidates[0], facts: { ...body.candidates[0].facts, coverage: `coverage-${id}` } }];
      return body;
    };
    observed.compare = async () => tagged('old');
    await button(render(), '比较资料')?.props?.onClick?.();
    let releasePending: (value: unknown) => void = () => {};
    observed.compare = () => new Promise((resolve) => {
      releasePending = resolve;
    });
    const pendingNew = button(render(), '比较资料')?.props?.onClick?.();
    await new Promise((done) => setImmediate(done));
    const selectedIds: string[] = [];
    observed.select = async (id: string) => {
      selectedIds.push(id);
      return tagged(id);
    };
    const oldButton = button(render(), '选择这份');
    if (oldButton && !oldButton.props?.disabled) await oldButton.props?.onClick?.();
    releasePending(tagged('fresh'));
    await pendingNew;
    const after = text(render());
    expect(selectedIds).toEqual([]);
    expect(after).toContain('coverage-fresh');
    expect(after).not.toContain('coverage-old');
  });
});
