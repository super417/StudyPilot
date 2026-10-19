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
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('GoalSubmitForm material task preview', () => {
  it('进入比较后不退回旧生成，并只展示未确认的任务预览', async () => {
    const root = path.resolve(__dirname, '../../../..');
    const slots: Array<{ value: unknown }> = [];
    let cursor = 0;
    const observed = {
      generate: 0,
      clarify: 0,
      preview: [] as string[],
      draftId: 'old-draft',
      draftClears: 0,
      compare: (_body: unknown) => Promise.resolve({}),
      select: (_id: string, _body: unknown) => Promise.resolve({}),
      previewTask: (_id: string, _body: unknown) => Promise.resolve({}),
    };
    (globalThis as { __materialTask?: unknown }).__materialTask = {
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
        export const useState=(value)=>globalThis.__materialTask.useState(value);
        export const useRef=(value)=>globalThis.__materialTask.useRef(value);
        export const useEffect=()=>{};`,
      '@/lib/directionsApi': `
        export const fetchDirections=()=>Promise.resolve({status:'ok',directions:[]});`,
      '@/store': `
        export const useAssistantStore=selector=>selector({
          addMessage(){}, appendStreamChunk(){}, setStreaming(){}, stopStreaming(){}, streaming:false
        });`,
      '@/store/planSessionStore': `
        export const usePlanSessionStore=selector=>selector({
          get draftId(){ return globalThis.__materialTask.observed.draftId; },
          clarifyQuestion:null, activePlanId:null, lastPlanId:null,
          setClarify(){}, clearClarify(){ globalThis.__materialTask.observed.draftClears += 1; globalThis.__materialTask.observed.draftId = null; }, setLastPlanId(){}, setActivePlanId(){}, setPreview(){}
        });
        usePlanSessionStore.getState=()=>({ askForStart(){} });`,
      '@/store/documentsStore': `
        export const useDocumentsStore=selector=>selector({
          selectedIds:['doc-other'], getSelectedDocumentIds:()=>['doc-other'], markSkipped(){}
        });`,
      '@/lib/plansApi': `
        export const streamPlanGenerate=()=>{ globalThis.__materialTask.observed.generate += 1; return Promise.resolve(); };
        export const streamPlanClarify=()=>{ globalThis.__materialTask.observed.clarify += 1; return Promise.resolve(); };
        export const planStartQuestion=()=>'start';`,
      '@/lib/materialsApi': `
        export const compareMaterials=body=>globalThis.__materialTask.observed.compare(body);
        export const selectMaterial=(id,body)=>globalThis.__materialTask.observed.select(id, body);
        export const previewMaterialTasks=(id,body)=>globalThis.__materialTask.observed.previewTask(id, body);`,
      '@/lib/httpClient': `export class ApiError extends Error {}`,
      './DocumentPicker': `export default function DocumentPicker(){return null;}`,
      'lucide-react': `export const X=()=>null;`,
    };
    const compiled = await esbuild.build({
      stdin: {
        contents: `import Form from "./src/components/planner/GoalSubmitForm"; export const form=()=>Form({});`,
        resolveDir: root,
        sourcefile: 'material-task.tsx',
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
          name: 'material-task',
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: 'material-task' };
              return undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'material-task' }, (args) => ({
              contents: mocks[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const virtualPath = path.join(root, '__material_task.cjs');
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
      let found: { props?: { onClick?: (event: { preventDefault: () => void }) => Promise<unknown> } } | undefined;
      visit(tree, (node) => {
        if (node.type === 'button' && text(node) === label) found = node;
      });
      return found;
    }
    function formOf(tree: unknown) {
      let found: { props?: { onSubmit?: (event: { preventDefault: () => void }) => Promise<unknown> } } | undefined;
      visit(tree, (node) => {
        if (node.type === 'form') found = node;
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
    const candidate = {
      candidateId: 'doc:doc-la',
      kind: 'document',
      readStatus: 'read',
      displayName: '只用于显示.pdf',
      source: { docId: 'doc-la' },
      usableSource: true,
      facts: {
        excerpts: [{ chunkIndex: 8, content: '矩阵与秩', contentHash: 'hash', pageStart: 17 }],
        unreadNote: '',
        unreadChunkCount: 1,
        prerequisite: '未知',
        coverage: '矩阵与秩',
        duration: { status: '未知', playSeconds: null, note: '文档没有播放时长。' },
      },
    };
    function comparison(selected: string | null, status = 'read') {
      return {
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
        selectedCandidateId: selected,
        suggestion: { status: 'not_called', text: null },
        candidates: [
          status === 'title_only'
            ? { ...candidate, readStatus: 'title_only', usableSource: false, facts: { ...candidate.facts, basisNote: '只有标题' } }
            : candidate,
          {
            ...candidate,
            candidateId: 'doc:doc-b',
            displayName: 'Doc-b',
            source: { docId: 'doc-b' },
            facts: { ...candidate.facts, coverage: 'excerpt-b' },
          },
        ],
      };
    }
    function fill() {
      slots.length = 0;
      const tree = render();
      (input(tree, (props) => String(props.placeholder || '').startsWith('要学')).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '线性代数入门' } });
      (input(tree, (props) => props.type === 'date').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '2027-06-30' } });
      (input(tree, (props) => props.type === 'number').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '45' } });
      (input(tree, (props) => String(props.placeholder || '').startsWith('当前基础')).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '学过矩阵' } });
      (input(tree, (props) => props['aria-label'] === '完成标准').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '能独立证明秩不等式' } });
    }
    async function submit(tree: unknown) {
      await formOf(tree)?.props?.onSubmit?.({ preventDefault() {} });
    }

    fill();
    const waiting = deferred();
    observed.compare = () => waiting.promise;
    const pending = button(render(), '比较资料')?.props?.onClick?.({ preventDefault() {} });
    expect(observed.draftClears).toBeGreaterThan(0);
    expect(observed.draftId).toBeNull();
    await new Promise((done) => setImmediate(done));
    await submit(render());
    expect(text(render())).toContain('正在比较');
    expect(observed.generate).toBe(0);
    expect(observed.clarify).toBe(0);
    expect(observed.preview).toEqual([]);
    waiting.resolve(comparison(null));
    await pending;

    await submit(render());
    expect(text(render())).toContain('请选择一份有正文的资料');
    expect(observed.generate).toBe(0);
    expect(observed.clarify).toBe(0);

    observed.compare = async () => comparison('doc:doc-la', 'title_only');
    await button(render(), '比较资料')?.props?.onClick?.({ preventDefault() {} });
    await submit(render());
    expect(observed.generate).toBe(0);
    expect(observed.clarify).toBe(0);
    expect(observed.preview).toEqual([]);

    observed.compare = async () => comparison(null);
    observed.select = async () => comparison('doc:doc-la');
    await button(render(), '比较资料')?.props?.onClick?.({ preventDefault() {} });
    await button(render(), '选择这份')?.props?.onClick?.({ preventDefault() {} });
    observed.previewTask = async (id: string) => {
      observed.preview.push(id);
      return {
        previewId: 'preview-1',
        previewVersion: 1,
        confirmOpen: false,
        comparisonId: id,
        selectedCandidateId: 'doc:doc-la',
        planId: null,
        displayName: '只用于显示.pdf',
        basis: { kind: 'document', docId: 'doc-la', chunks: [{ chunkIndex: 8, pageStart: 17 }] },
        emptyDates: ['2026-10-12'],
        validation: { ok: true, checks: { duration: 'pass' } },
        phases: [
          {
            name: '秩',
            startDate: '2026-10-11',
            endDate: '2026-10-12',
            tasks: [{ actionId: 'a0', taskDate: '2026-10-11', description: '线性代数：矩阵秩，做例题 1-3，写出秩的结论', estimatedMinutes: 25 }],
          },
        ],
      };
    };
    await submit(render());
    await Promise.resolve();
    const shown = text(render());
    expect(observed.preview).toEqual(['cmp-1']);
    expect(observed.generate).toBe(0);
    expect(observed.clarify).toBe(0);
    expect(shown).toContain('写出秩的结论');
    expect(shown).toContain('预计 25 分钟');
    expect(shown).toContain('doc-la');
    expect(shown).toContain('还不能确认写入');
    expect(shown).toContain('不会补任务');

    const choosing = deferred();
    observed.select = () => choosing.promise;
    observed.previewTask = async (id: string) => {
      observed.preview.push(id);
      return {
        previewId: 'preview-during-select',
        previewVersion: 1,
        confirmOpen: false,
        comparisonId: id,
        selectedCandidateId: 'doc:doc-la',
        planId: null,
        displayName: '只用于显示.pdf',
        basis: { kind: 'document', docId: 'doc-la', chunks: [] },
        emptyDates: [],
        validation: { ok: true, checks: {} },
        phases: [{ name: '旧', startDate: '2026-10-11', endDate: '2026-10-11', tasks: [{ actionId: 'a0', taskDate: '2026-10-11', description: '写出秩的结论', estimatedMinutes: 25 }] }],
      };
    };
    const choosingCall = button(render(), '选择这份')?.props?.onClick?.({ preventDefault() {} });
    await Promise.resolve();
    const waitingTree = render();
    let submitButton: { props?: { disabled?: boolean } } | undefined;
    visit(waitingTree, (node) => {
      if (node.type === 'button' && node.props?.type === 'submit') submitButton = node as { props?: { disabled?: boolean } };
    });
    const previewCount = observed.preview.length;
    expect(submitButton?.props?.disabled).toBe(true);
    await submit(waitingTree);
    await Promise.resolve();
    expect(observed.preview.length).toBe(previewCount);
    expect(text(render())).not.toContain('写出秩的结论');
    choosing.resolve(comparison('doc:doc-b'));
    await choosingCall;
    await Promise.resolve();
    expect(text(render())).not.toContain('写出秩的结论');

    observed.select = async () => comparison('doc:doc-la');
    await button(render(), '选择这份')?.props?.onClick?.({ preventDefault() {} });
    await submit(render());
    await Promise.resolve();
    expect(text(render())).toContain('写出秩的结论');
    const failing = deferred();
    observed.select = () => failing.promise;
    const failingCall = button(render(), '选择这份')?.props?.onClick?.({ preventDefault() {} });
    await Promise.resolve();
    await submit(render());
    await Promise.resolve();
    failing.reject(new Error('select failed'));
    await failingCall?.catch(() => undefined);
    await Promise.resolve();
    expect(text(render())).not.toContain('写出秩的结论');

    observed.compare = async () => comparison(null);
    observed.select = async (_id: string, body: { candidateId: string }) => comparison(body.candidateId);
    await button(render(), '比较资料')?.props?.onClick?.({ preventDefault() {} });
    await button(render(), '选择这份')?.props?.onClick?.({ preventDefault() {} });
    const hangingChoice = deferred();
    observed.previewTask = () => hangingChoice.promise;
    formOf(render())?.props?.onSubmit?.({ preventDefault() {} });
    await new Promise((done) => setImmediate(done));
    await button(render(), '选择这份')?.props?.onClick?.({ preventDefault() {} });
    hangingChoice.resolve({
      previewId: 'preview-a',
      previewVersion: 1,
      confirmOpen: false,
      comparisonId: 'cmp-1',
      selectedCandidateId: 'doc:doc-la',
      planId: null,
      displayName: '只用于显示.pdf',
      basis: { kind: 'document', docId: 'doc-la', chunks: [] },
      emptyDates: [],
      validation: { ok: true, checks: {} },
      phases: [{ name: '旧', startDate: '2026-10-11', endDate: '2026-10-11', tasks: [{ actionId: 'a0', taskDate: '2026-10-11', description: '写出秩的结论', estimatedMinutes: 25 }] }],
    });
    await Promise.resolve();
    expect(text(render())).not.toContain('写出秩的结论');

    const hung = deferred();
    observed.previewTask = () => hung.promise;
    formOf(render())?.props?.onSubmit?.({ preventDefault() {} });
    await new Promise((done) => setImmediate(done));
    (input(render(), (props) => String(props.placeholder || '').startsWith('要学')).props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: '概率论入门' },
    });
    hung.resolve({
      previewId: 'preview-old',
      previewVersion: 1,
      confirmOpen: false,
      comparisonId: 'cmp-1',
      selectedCandidateId: 'doc:doc-la',
      planId: null,
      displayName: '旧预览',
      basis: { kind: 'document', docId: 'doc-la', chunks: [] },
      emptyDates: [],
      validation: { ok: true, checks: {} },
      phases: [{ name: '旧', startDate: '2026-10-11', endDate: '2026-10-11', tasks: [{ actionId: 'a0', taskDate: '2026-10-11', description: '旧任务不该回来', estimatedMinutes: 10 }] }],
    });
    await Promise.resolve();
    expect(text(render())).not.toContain('旧任务不该回来');

    observed.draftId = null;
    await button(render(), '不使用这次资料比较，按原来的方式生成')?.props?.onClick?.({ preventDefault() {} });
    expect(observed.generate).toBe(1);
    expect(observed.clarify).toBe(0);
  });
});
