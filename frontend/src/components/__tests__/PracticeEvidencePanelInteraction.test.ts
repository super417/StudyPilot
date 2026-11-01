import path from 'node:path';
import { Module } from 'node:module';
import esbuild from 'esbuild';
import { expect, it } from 'vitest';

type Node = { type?: unknown; props?: { children?: unknown; onClick?: () => void } };
function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return node && typeof node === 'object' ? text((node as Node).props?.children) : '';
}
function click(tree: unknown, label: string) {
  const found: Node[] = [];
  function visit(node: unknown) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const item = node as Node;
    if (item.type === 'button' && text(item) === label) found.push(item);
    visit(item.props?.children);
  }
  visit(tree);
  if (!found[0]?.props?.onClick) throw new Error(`missing button: ${label}`);
  found[0].props.onClick();
}
it('展开才加载，读取失败保持入口并可点击刷新重试', async () => {
  const root=path.resolve(__dirname,'../../..');
  const slots: unknown[]=[];
  const effects: Array<() => unknown>=[];
  let cursor=0; let calls=0;
  const harness={
    useState(initial: unknown) {
      const index=cursor++;
      if (!(index in slots)) slots[index]=initial;
      return [slots[index],(value: unknown) => { slots[index]=typeof value === 'function' ? (value as (old:unknown)=>unknown)(slots[index]) : value; }];
    },
    useEffect(effect: () => unknown,deps: unknown[]) {
      const index=cursor++;
      const previous=slots[index] as unknown[] | undefined;
      if (!previous || deps.some((value,i)=>!Object.is(value,previous[i]))) { slots[index]=deps;effects.push(effect); }
    },
    fetch() {
      calls++;
      return calls===1 ? Promise.reject(new Error('读取暂时失败')) : Promise.resolve({status:'ok',question:{id:'q',phaseId:'p',phaseName:'阶段A',practiceType:'generated'},evidence:[]});
    },
  };
  (globalThis as {__practiceHistory?: typeof harness}).__practiceHistory=harness;
  const mocks: Record<string,string>={react:'export const useState=x=>globalThis.__practiceHistory.useState(x);export const useEffect=(f,d)=>globalThis.__practiceHistory.useEffect(f,d);','@/lib/practiceApi':'export const fetchPracticeEvidence=()=>globalThis.__practiceHistory.fetch();'};
  const compiled=await esbuild.build({stdin:{contents:'import Panel from "./src/components/PracticeEvidencePanel";export const panel=()=>Panel({questionId:"q",revision:"1"});',resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',jsx:'automatic',alias:{'@':path.join(root,'src')},plugins:[{name:'history-hooks',setup(build){build.onResolve({filter:/.*/},args=>Object.prototype.hasOwnProperty.call(mocks,args.path)?{path:args.path,namespace:'history-hooks'}:undefined);build.onLoad({filter:/.*/,namespace:'history-hooks'},args=>({contents:mocks[args.path],loader:'js'}));}}]});
  const virtual=path.join(root,'__history_panel_test.cjs');const loaded=new Module(virtual);
  const nodeModule=Module as typeof Module & {_nodeModulePaths:(from:string)=>string[]};
  loaded.filename=virtual;loaded.paths=nodeModule._nodeModulePaths(root);
  (loaded as Module & {_compile:(source:string,filename:string)=>void})._compile(compiled.outputFiles[0].text,virtual);
  function render() {cursor=0;effects.length=0;const tree=loaded.exports.panel();effects.forEach(effect=>effect());return tree;}
  try {
    let tree=render();expect(calls).toBe(0);
    click(tree,'判分记录与依据');render();
    await new Promise(done=>setImmediate(done));
    tree=render();expect(text(tree)).toContain('读取暂时失败');expect(calls).toBe(1);
    click(tree,'刷新记录');render();await new Promise(done=>setImmediate(done));
    tree=render();expect(calls).toBe(2);expect(text(tree)).not.toContain('读取暂时失败');
    // Successful load mounts the view with its returned question metadata.
    const serialized=JSON.stringify(tree);expect(serialized).toContain('阶段A');
  } finally {delete (globalThis as {__practiceHistory?:unknown}).__practiceHistory;}
});
