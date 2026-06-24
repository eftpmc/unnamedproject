import { useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { updateItemTask } from '../lib/api.js';
import FileBrowser from './FileBrowser.js';
import type { Block } from '../types.js';

interface BlockRendererProps {
  block: Block;
  spaceId: string;
  itemId: string;
}

export default function BlockRenderer({ block, spaceId, itemId }: BlockRendererProps) {
  switch (block.type) {
    case 'text':      return <TextBlock block={block} />;
    case 'heading':   return <HeadingBlock block={block} />;
    case 'code':      return <CodeBlock block={block} />;
    case 'table':     return <TableBlock block={block} />;
    case 'image':     return <ImageBlock block={block} />;
    case 'task-list': return <TaskListBlock block={block} spaceId={spaceId} itemId={itemId} />;
    case 'callout':   return <CalloutBlock block={block} />;
    case 'file-browser': return <FileBrowser spaceId={spaceId} itemId={itemId} />;
  }
}

function TextBlock({ block }: { block: Extract<Block, { type: 'text' }> }) {
  if (!block.content.trim()) return null;
  return (
    <div className="text-[14px] leading-relaxed text-fg-soft
      [&_p]:mb-3 [&_p:last-child]:mb-0
      [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc
      [&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal
      [&_li]:mb-1
      [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]
      [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-muted/30 [&_pre]:p-3">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
    </div>
  );
}

function HeadingBlock({ block }: { block: Extract<Block, { type: 'heading' }> }) {
  const base = 'font-semibold text-foreground';
  if (block.level === 1) return <h1 className={cn(base, 'text-xl mt-2 mb-1')}>{block.text}</h1>;
  if (block.level === 2) return <h2 className={cn(base, 'text-base mt-4 mb-1')}>{block.text}</h2>;
  return <h3 className={cn(base, 'text-sm mt-3 mb-0.5')}>{block.text}</h3>;
}

function CodeBlock({ block }: { block: Extract<Block, { type: 'code' }> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-soft bg-muted/30">
      <div className="flex items-center gap-2 border-b border-border-soft px-3 py-1.5">
        <span className="font-mono text-[11px] text-faint-fg">{block.language}</span>
      </div>
      <pre className="overflow-x-auto p-3">
        <code className={`language-${block.language} font-mono text-[12px] leading-relaxed`}>
          {block.content}
        </code>
      </pre>
    </div>
  );
}

function TableBlock({ block }: { block: Extract<Block, { type: 'table' }> }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-soft bg-muted/40">
            {block.headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border-soft last:border-0 hover:bg-muted/20">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-xs text-fg-soft">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImageBlock({ block }: { block: Extract<Block, { type: 'image' }> }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-border-soft">
      <img src={block.url} alt={block.alt ?? ''} className="w-full object-cover" />
      {block.caption && (
        <figcaption className="border-t border-border-soft px-3 py-1.5 text-xs text-faint-fg">{block.caption}</figcaption>
      )}
    </figure>
  );
}

function TaskListBlock({
  block,
  spaceId,
  itemId,
}: {
  block: Extract<Block, { type: 'task-list' }>;
  spaceId: string;
  itemId: string;
}) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: ({ taskId, done }: { taskId: string; done: boolean }) =>
      updateItemTask(spaceId, itemId, taskId, done),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-items', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['space-item', spaceId, itemId] });
    },
  });

  if (block.tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background/50 px-3 py-2 text-xs text-faint-fg">
        No tasks yet.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {block.tasks.map(task => (
        <li key={task.id} className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={task.done}
            onChange={e => toggle.mutate({ taskId: task.id, done: e.target.checked })}
            disabled={toggle.isPending}
            className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
          />
          <span className={cn('text-sm', task.done && 'text-faint-fg line-through')}>{task.text}</span>
        </li>
      ))}
    </ul>
  );
}

const CALLOUT_STYLES = {
  info:    'border-blue-200/60 bg-blue-50/50 text-blue-900 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-200',
  warning: 'border-yellow-200/60 bg-yellow-50/50 text-yellow-900 dark:border-yellow-800/40 dark:bg-yellow-950/30 dark:text-yellow-200',
  success: 'border-green-200/60 bg-green-50/50 text-green-900 dark:border-green-800/40 dark:bg-green-950/30 dark:text-green-200',
  error:   'border-red-200/60 bg-red-50/50 text-red-900 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-200',
};

function CalloutBlock({ block }: { block: Extract<Block, { type: 'callout' }> }) {
  return (
    <div className={cn('rounded-lg border-l-4 px-4 py-3 text-[13px] leading-relaxed', CALLOUT_STYLES[block.variant])}>
      {block.content}
    </div>
  );
}
