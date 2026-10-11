import path from 'node:path';
import { Module } from 'node:module';
import { describe, expect, it } from 'vitest';
import esbuild from 'esbuild';

describe('GoalSubmitForm preview', () => {
  it('无资料预览会记下草稿并展示摘要，供下一条确认发回这份草稿', async () => {
    const root = path.resolve(__dirname, '../../../..');
    const messages: string[] = [];
    const state = {
      draftId: null as string | null,
      awaitingConfirm: false,
      calls: 0,
    };
    const review = {
      useState: (initial: unknown) => {
        const values = [
          '线性代数入门',
          '2027-06-30',
          '学过矩阵',
          '45',
          '能独立证明秩不等式',
          null,
        ];
        const value = review.index < values.length ? values[review.index] : initial;
        review.index += 1;
        return [value, () => {}];
      },
      index: 0,
      assistant: {
        addMessage: (message: { content: string }) => messages.push(message.content),
        appendStreamChunk: () => {},
        setStreaming: () => {},
        stopStreaming: () => {},
        streaming: false,
      },
      session: {
        get draftId() {
          return state.draftId;
        },
        clarifyQuestion: null,
        setClarify: () => {},
        setPreview: (id: string) => {
          state.draftId = id;
          state.awaitingConfirm = true;
        },
        clearClarify: () => {
          state.draftId = null;
        },
        setLastPlanId: () => {},
        setActivePlanId: () => {},
        askForStart: () => {},
      },
      documents: { getSelectedDocumentIds: () => [], markSkipped: () => {} },
      stream: async (
        _fields: unknown,
        handlers: {
          onPreview?: (data: { draftId: string; summary: string }) => void;
        },
      ) => {
        state.calls += 1;
        handlers.onPreview?.({
          draftId: 'no-file-preview',
          summary: 'actual-preview-summary',
        });
      },
    };
    (globalThis as { __goalFormPreview?: typeof review }).__goalFormPreview = review;

    const mocks: Record<string, string> = {
      react: `
        export const useState=(initial)=>globalThis.__goalFormPreview.useState(initial);
        export const useRef=(initial)=>({current:initial});`,
      '@/store': `
        export const useAssistantStore=selector=>selector(globalThis.__goalFormPreview.assistant);
        useAssistantStore.getState=()=>globalThis.__goalFormPreview.assistant;`,
      '@/store/planSessionStore': `
        export const usePlanSessionStore=selector=>selector(globalThis.__goalFormPreview.session);
        usePlanSessionStore.getState=()=>globalThis.__goalFormPreview.session;`,
      '@/store/documentsStore': `
        export const useDocumentsStore=selector=>selector(globalThis.__goalFormPreview.documents);`,
      '@/lib/plansApi': `
        export const streamPlanGenerate=(...args)=>globalThis.__goalFormPreview.stream(...args);
        export const streamPlanClarify=(id,...args)=>globalThis.__goalFormPreview.stream(...args);
        export const planStartQuestion=()=>"start-question";`,
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
        sourcefile: 'goal-form-preview.tsx',
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
          name: 'form-preview-boundaries',
          setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
              if (Object.hasOwn(mocks, args.path)) {
                return { path: args.path, namespace: 'form-preview-mock' };
              }
              return undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'form-preview-mock' }, (args) => ({
              contents: mocks[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const virtualPath = path.join(root, '__goal_form_preview_test.cjs');
    const loaded = new Module(virtualPath);
    const nodeModule = Module as typeof Module & {
      _nodeModulePaths: (from: string) => string[];
    };
    const compilable = loaded as Module & {
      _compile: (code: string, filename: string) => void;
    };
    loaded.filename = virtualPath;
    loaded.paths = nodeModule._nodeModulePaths(root);
    compilable._compile(compiled.outputFiles[0].text, virtualPath);
    await loaded.exports.form().props.onSubmit({ preventDefault() {} });

    expect(state.calls).toBe(1);
    expect(state.draftId).toBe('no-file-preview');
    expect(state.awaitingConfirm).toBe(true);
    expect(messages).toContain('actual-preview-summary');
  });
});
