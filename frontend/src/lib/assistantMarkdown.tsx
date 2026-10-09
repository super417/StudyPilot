import { Fragment, type ReactNode } from 'react';

export type AssistantBlock =
  | { type: 'p'; text: string }
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'pre'; lang: string; code: string };

/** 复制、朗读用：去掉 Markdown 记号，保留换行。 */
export function stripAssistantMarkup(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (block) => {
      const inner = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
      return inner.trim();
    })
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*-{2,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function headingLevel(line: string): 1 | 2 | 3 | 0 {
  const match = /^(#{1,3})\s+\S/.exec(line);
  return match ? (match[1].length as 1 | 2 | 3) : 0;
}

function isFence(line: string): boolean {
  return line.trimStart().startsWith('```');
}

function isUl(line: string): boolean {
  return /^\s*[-*•]\s+\S/.test(line);
}

function isOl(line: string): boolean {
  return /^\s*\d+[.)]\s+\S/.test(line);
}

export function parseAssistantBlocks(text: string): AssistantBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: AssistantBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (isFence(line)) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !isFence(lines[i] ?? '')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ type: 'pre', lang, code: body.join('\n') });
      continue;
    }
    const level = headingLevel(line);
    if (level) {
      blocks.push({ type: 'h', level, text: line.replace(/^#{1,3}\s+/, '') });
      i += 1;
      continue;
    }
    if (isUl(line)) {
      const items: string[] = [];
      while (i < lines.length && isUl(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (isOl(line)) {
      const items: string[] = [];
      while (i < lines.length && isOl(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+[.)]\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !isFence(lines[i] ?? '') &&
      !headingLevel(lines[i] ?? '') &&
      !isUl(lines[i] ?? '') &&
      !isOl(lines[i] ?? '')
    ) {
      para.push(lines[i] ?? '');
      i += 1;
    }
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
  }
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const token = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:[^)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  const pushText = (chunk: string) => {
    if (!chunk) return;
    const parts = chunk.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) nodes.push(<br key={`br-${key++}`} />);
      if (part) nodes.push(<Fragment key={`t-${key++}`}>{part}</Fragment>);
    });
  };
  while ((match = token.exec(text))) {
    pushText(text.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[1]) {
      nodes.push(
        <code
          key={`c-${key++}`}
          className="rounded bg-brandDark/10 px-1 py-0.5 font-mono text-[0.92em]"
        >
          {match[1].slice(1, -1)}
        </code>,
      );
    } else if (match[2]) {
      nodes.push(
        <strong key={`b-${key++}`} className="font-semibold">
          {match[2].slice(2, -2)}
        </strong>,
      );
    } else if (match[3] && match[4]) {
      const label = match[3].slice(1, match[3].indexOf(']'));
      nodes.push(
        <a
          key={`a-${key++}`}
          href={match[4]}
          target="_blank"
          rel="noreferrer"
          className="break-all underline decoration-brand/50 underline-offset-2"
        >
          {label}
        </a>,
      );
    }
  }
  pushText(text.slice(last));
  return nodes;
}

export function AssistantMarkdown({ text }: { text: string }) {
  const blocks = parseAssistantBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="min-w-0 max-w-full [&_p+p]:mt-2.5 [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h3]:mb-1 [&_h3]:mt-2.5 [&_h2]:text-[0.95rem] [&_h2]:font-semibold [&_h3]:text-[0.9rem] [&_h3]:font-semibold [&_ul]:my-2 [&_ol]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:space-y-1 [&_ol]:space-y-1 [&_ul]:pl-4 [&_ol]:pl-4">
      {blocks.map((block, index) => {
        if (block.type === 'p') {
          return (
            <p key={index} className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.type === 'h') {
          const Tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h2' : 'h3';
          return (
            <Tag key={index} className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
              {renderInline(block.text)}
            </Tag>
          );
        }
        if (block.type === 'ul' || block.type === 'ol') {
          const List = block.type === 'ul' ? 'ul' : 'ol';
          return (
            <List key={index} className="min-w-0 max-w-full">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="break-words [overflow-wrap:anywhere]">
                  {renderInline(item)}
                </li>
              ))}
            </List>
          );
        }
        return (
          <pre
            key={index}
            className="my-2 max-w-full overflow-x-auto rounded-xl bg-brandDark/10 px-2.5 py-2 font-mono text-[13px] leading-snug"
          >
            <code className="whitespace-pre">{block.code}</code>
          </pre>
        );
      })}
    </div>
  );
}
