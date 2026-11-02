import type { ChatCitation } from '@/store/assistantStore';

export function groupCitations(citations: ChatCitation[]): { filename: string; snippets: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const item of citations) {
    const snippets = groups.get(item.filename) ?? [];
    if (!snippets.includes(item.snippet)) snippets.push(item.snippet);
    groups.set(item.filename, snippets);
  }
  return Array.from(groups, ([filename, snippets]) => ({ filename, snippets }));
}
