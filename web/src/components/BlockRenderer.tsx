import { Component, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDown, ArrowRight, ArrowUp, Download, ExternalLink, FileText, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSpaceItem, updateItemTask } from '../lib/api.js';
import { getToken } from '../lib/auth.js';
import FileBrowser from './FileBrowser.js';
import type { Block, SpaceItem } from '../types.js';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

interface BlockRendererProps {
  block: Block;
  spaceId: string;
  itemId: string;
  onEdit?: (updated: Block) => void;
  /** When true, content blocks are rendered read-only. Interactive blocks (task-list, input) are always editable. */
  readOnly?: boolean;
}

// A block render failure (malformed data slipping past server validation,
// a third-party chart lib choking on an edge case, etc.) should blank that
// one block, not the rest of the item — each block gets its own boundary,
// keyed on its content so a later fix (new block data) remounts and clears
// the error instead of getting stuck showing a stale failure.
class BlockErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-dashed border-red-300 bg-red-50/50 px-3 py-2 text-xs text-red-700 dark:border-red-800/40 dark:bg-red-950/30 dark:text-red-300">
          This block failed to render.
        </div>
      );
    }
    return this.props.children;
  }
}

export default function BlockRenderer({ block, spaceId, itemId, onEdit, readOnly }: BlockRendererProps) {
  return (
    <BlockErrorBoundary key={JSON.stringify(block)}>
      {renderBlock(block, spaceId, itemId, onEdit, readOnly)}
    </BlockErrorBoundary>
  );
}

function renderBlock(block: Block, spaceId: string, itemId: string, onEdit?: (updated: Block) => void, readOnly?: boolean) {
  const edit = readOnly ? undefined : onEdit;
  switch (block.type) {
    case 'text':      return <TextBlock block={block} onEdit={edit} />;
    case 'heading':   return <HeadingBlock block={block} onEdit={edit} />;
    case 'code':      return <CodeBlock block={block} onEdit={edit} />;
    case 'table':     return <TableBlock block={block} />;
    case 'image':     return <ImageBlock block={block} />;
    case 'task-list': return <TaskListBlock block={block} spaceId={spaceId} itemId={itemId} onEdit={onEdit} />;
    case 'callout':   return <CalloutBlock block={block} onEdit={edit} />;
    case 'file-browser': return <FileBrowser spaceId={spaceId} itemId={itemId} />;
    case 'chart':     return <ChartBlock block={block} />;
    case 'stat':      return <StatBlock block={block} />;
    case 'list':      return <ListBlock block={block} onEdit={edit} />;
    case 'progress':  return <ProgressBlock block={block} />;
    case 'input':     return <InputBlock block={block} onEdit={onEdit} />;
    case 'file-preview': return <FilePreviewBlock block={block} />;
    case 'relation':  return <RelationBlock block={block} />;
    default:          return null;
  }
}

const PROSE_CLASSES = `text-[14px] leading-relaxed text-fg-soft
  [&_p]:mb-3 [&_p:last-child]:mb-0
  [&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc
  [&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal
  [&_li]:mb-1
  [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]
  [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border-soft [&_pre]:bg-muted/30 [&_pre]:p-3`;

function TextBlock({ block, onEdit }: { block: Extract<Block, { type: 'text' }>; onEdit?: (updated: Block) => void }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  function autoResize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
  }

  if (onEdit && editing) {
    return (
      <textarea
        ref={ref}
        autoFocus
        value={block.content}
        placeholder="Write something…"
        rows={1}
        onChange={e => { onEdit({ ...block, content: e.target.value }); autoResize(); }}
        onFocus={autoResize}
        onBlur={() => setEditing(false)}
        className="animate-in fade-in-0 duration-100 w-full resize-none overflow-hidden rounded bg-transparent px-1 -mx-1 text-[14px] leading-relaxed text-fg-soft outline-none placeholder:text-faint-fg focus:ring-1 focus:ring-ring/30"
      />
    );
  }

  if (!block.content.trim()) {
    if (!onEdit) return null;
    return (
      <div
        onClick={() => setEditing(true)}
        className="cursor-text rounded px-1 -mx-1 py-0.5 text-[14px] text-faint-fg italic hover:bg-muted/30 transition-colors"
      >
        Empty text block — click to edit
      </div>
    );
  }

  return (
    <div
      onClick={onEdit ? () => setEditing(true) : undefined}
      className={cn(PROSE_CLASSES, onEdit && 'cursor-text rounded px-1 -mx-1 hover:bg-muted/30 transition-colors')}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.content}</ReactMarkdown>
    </div>
  );
}

function HeadingBlock({ block, onEdit }: { block: Extract<Block, { type: 'heading' }>; onEdit?: (updated: Block) => void }) {
  const [editing, setEditing] = useState(false);
  const base = 'font-semibold text-foreground';
  const sizeClass = block.level === 1 ? 'text-xl mt-2 mb-1' : block.level === 2 ? 'text-base mt-4 mb-1' : 'text-sm mt-3 mb-0.5';

  if (onEdit && editing) {
    return (
      <input
        autoFocus
        value={block.text}
        onChange={e => onEdit({ ...block, text: e.target.value })}
        onBlur={() => setEditing(false)}
        className={cn(base, sizeClass, 'animate-in fade-in-0 duration-100 w-full rounded bg-transparent px-1 -mx-1 outline-none focus:ring-1 focus:ring-ring/30')}
      />
    );
  }

  const hoverClass = onEdit ? 'cursor-text rounded px-1 -mx-1 hover:bg-muted/30 transition-colors' : '';
  const onClick = onEdit ? () => setEditing(true) : undefined;
  if (block.level === 1) return <h1 onClick={onClick} className={cn(base, sizeClass, hoverClass)}>{block.text}</h1>;
  if (block.level === 2) return <h2 onClick={onClick} className={cn(base, sizeClass, hoverClass)}>{block.text}</h2>;
  return <h3 onClick={onClick} className={cn(base, sizeClass, hoverClass)}>{block.text}</h3>;
}

function CodeBlock({ block, onEdit }: { block: Extract<Block, { type: 'code' }>; onEdit?: (updated: Block) => void }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  function autoResize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border-soft bg-muted/30">
      <div className="flex items-center gap-2 border-b border-border-soft px-3 py-1.5">
        {onEdit && editing ? (
          <input
            value={block.language}
            onChange={e => onEdit({ ...block, language: e.target.value })}
            placeholder="language"
            className="font-mono text-[11px] text-faint-fg bg-transparent outline-none w-24"
          />
        ) : (
          <span className="font-mono text-[11px] text-faint-fg">{block.language || 'plaintext'}</span>
        )}
      </div>
      {onEdit && editing ? (
        <textarea
          ref={ref}
          autoFocus
          value={block.content}
          onChange={e => { onEdit({ ...block, content: e.target.value }); autoResize(); }}
          onFocus={autoResize}
          onBlur={() => setEditing(false)}
          rows={1}
          spellCheck={false}
          className="w-full resize-none overflow-hidden bg-transparent p-3 font-mono text-[12px] leading-relaxed outline-none"
        />
      ) : (
        <pre
          onClick={onEdit ? () => setEditing(true) : undefined}
          className={cn('overflow-x-auto p-3', onEdit && 'cursor-text hover:bg-muted/10 transition-colors')}
        >
          <code className={`language-${block.language} font-mono text-[12px] leading-relaxed`}>
            {block.content}
          </code>
        </pre>
      )}
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
  onEdit,
}: {
  block: Extract<Block, { type: 'task-list' }>;
  spaceId: string;
  itemId: string;
  onEdit?: (updated: Block) => void;
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

  if (onEdit) {
    const updateTask = (id: string, patch: Partial<{ text: string; done: boolean }>) =>
      onEdit({ ...block, tasks: block.tasks.map(t => t.id === id ? { ...t, ...patch } : t) });
    const addTask = () =>
      onEdit({ ...block, tasks: [...block.tasks, { id: crypto.randomUUID(), text: '', done: false }] });
    const removeTask = (id: string) =>
      onEdit({ ...block, tasks: block.tasks.filter(t => t.id !== id) });
    return (
      <div className="flex flex-col gap-1.5">
        {block.tasks.map(task => (
          <div key={task.id} className="group/task flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={task.done}
              onChange={e => updateTask(task.id, { done: e.target.checked })}
              className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
            />
            <input
              value={task.text}
              onChange={e => updateTask(task.id, { text: e.target.value })}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); addTask(); }
                if (e.key === 'Backspace' && !task.text && block.tasks.length > 1) { e.preventDefault(); removeTask(task.id); }
              }}
              placeholder="Task…"
              className={cn('flex-1 bg-transparent text-sm outline-none placeholder:text-faint-fg', task.done && 'text-faint-fg line-through')}
            />
            <button
              type="button"
              onClick={() => removeTask(task.id)}
              className="rounded p-0.5 text-faint-fg opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover/task:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addTask}
          className="mt-0.5 flex items-center gap-1 text-xs text-faint-fg hover:text-muted-foreground"
        >
          <Plus size={11} /> Add task
        </button>
      </div>
    );
  }

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

function CalloutBlock({ block, onEdit }: { block: Extract<Block, { type: 'callout' }>; onEdit?: (updated: Block) => void }) {
  if (onEdit) {
    return (
      <div className={cn('rounded-lg border-l-4 px-4 py-3', CALLOUT_STYLES[block.variant])}>
        <div className="mb-2 flex gap-1.5">
          {(['info', 'warning', 'success', 'error'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => onEdit({ ...block, variant: v })}
              className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium capitalize transition-opacity', v === block.variant ? 'bg-black/10 dark:bg-white/10' : 'opacity-40 hover:opacity-70')}
            >
              {v}
            </button>
          ))}
        </div>
        <textarea
          value={block.content}
          onChange={e => onEdit({ ...block, content: e.target.value })}
          rows={2}
          placeholder="Callout text…"
          className="w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:opacity-50"
        />
      </div>
    );
  }
  return (
    <div className={cn('rounded-lg border-l-4 px-4 py-3 text-[13px] leading-relaxed', CALLOUT_STYLES[block.variant])}>
      {block.content}
    </div>
  );
}

const CHART_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#ec4899'];

function ChartBlock({ block }: { block: Extract<Block, { type: 'chart' }> }) {
  if (block.data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background/50 px-3 py-2 text-xs text-faint-fg">
        No data yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-soft bg-card p-3">
      {block.title && <div className="mb-2 text-xs font-medium text-muted-foreground">{block.title}</div>}
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {block.chartType === 'pie' ? (
            <PieChart>
              <Tooltip />
              <Pie data={block.data} dataKey="value" nameKey="label" outerRadius="80%">
                {block.data.map((entry, i) => (
                  <Cell key={entry.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : block.chartType === 'bar' ? (
            <BarChart data={block.data}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill={CHART_COLORS[0]} radius={4} />
            </BarChart>
          ) : (
            <LineChart data={block.data}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const TREND_ICON = { up: ArrowUp, down: ArrowDown, flat: ArrowRight };
const TREND_COLOR = {
  up: 'text-green-600 dark:text-green-400',
  down: 'text-red-600 dark:text-red-400',
  flat: 'text-muted-foreground',
};

function StatBlock({ block }: { block: Extract<Block, { type: 'stat' }> }) {
  const TrendIcon = block.trend ? TREND_ICON[block.trend.direction] : null;
  return (
    <div className="rounded-xl border border-border-soft bg-card px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">{block.label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-foreground">{block.value}</span>
        {block.trend && TrendIcon && (
          <span className={cn('flex items-center gap-0.5 text-xs font-medium', TREND_COLOR[block.trend.direction])}>
            <TrendIcon size={12} />
            {block.trend.label}
          </span>
        )}
      </div>
    </div>
  );
}

function ListBlock({ block, onEdit }: { block: Extract<Block, { type: 'list' }>; onEdit?: (updated: Block) => void }) {
  if (onEdit) {
    const updateItem = (i: number, value: string) =>
      onEdit({ ...block, items: block.items.map((item, idx) => idx === i ? value : item) });
    const addItem = () => onEdit({ ...block, items: [...block.items, ''] });
    const removeItem = (i: number) => onEdit({ ...block, items: block.items.filter((_, idx) => idx !== i) });
    return (
      <div className="flex flex-col gap-1">
        {block.items.map((item, i) => (
          <div key={i} className="group/li flex items-center gap-1.5">
            <span className="w-4 shrink-0 select-none text-center text-xs text-faint-fg">
              {block.ordered ? `${i + 1}.` : '•'}
            </span>
            <input
              value={item}
              onChange={e => updateItem(i, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); addItem(); }
                if (e.key === 'Backspace' && !item && block.items.length > 1) { e.preventDefault(); removeItem(i); }
              }}
              placeholder="List item…"
              className="flex-1 bg-transparent text-sm text-fg-soft outline-none placeholder:text-faint-fg"
            />
            <button
              type="button"
              onClick={() => removeItem(i)}
              className="rounded p-0.5 text-faint-fg opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover/li:opacity-100"
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addItem}
          className="mt-0.5 flex items-center gap-1 text-xs text-faint-fg hover:text-muted-foreground"
        >
          <Plus size={11} /> Add item
        </button>
      </div>
    );
  }
  if (block.items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background/50 px-3 py-2 text-xs text-faint-fg">
        No items yet.
      </div>
    );
  }
  const Tag = block.ordered ? 'ol' : 'ul';
  return (
    <Tag className={cn('flex flex-col gap-1 text-sm text-fg-soft', block.ordered ? 'ml-5 list-decimal' : 'ml-5 list-disc')}>
      {block.items.map((item, i) => <li key={i}>{item}</li>)}
    </Tag>
  );
}

function InputBlock({ block, onEdit }: { block: Extract<Block, { type: 'input' }>; onEdit?: (updated: Block) => void }) {
  const update = (value: string) => onEdit?.({ ...block, value });

  const inputClass = 'w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-ring/30 placeholder:text-faint-fg disabled:opacity-50';

  return (
    <div className="flex flex-col gap-1.5">
      {onEdit ? (
        <input
          value={block.label}
          onChange={e => onEdit({ ...block, label: e.target.value })}
          placeholder="Label…"
          className="bg-transparent text-xs font-medium text-muted-foreground outline-none placeholder:text-faint-fg"
        />
      ) : block.label && (
        <label className="text-xs font-medium text-muted-foreground">{block.label}</label>
      )}
      {block.input_type === 'multiline' ? (
        <textarea
          value={block.value}
          placeholder={block.placeholder}
          onChange={e => update(e.target.value)}
          rows={3}
          className={cn(inputClass, 'resize-y')}
        />
      ) : block.input_type === 'select' ? (
        <select
          value={block.value}
          onChange={e => update(e.target.value)}
          className={inputClass}
        >
          {!block.value && <option value="" disabled>Select…</option>}
          {block.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : (
        <input
          type={block.input_type === 'number' ? 'number' : 'text'}
          value={block.value}
          placeholder={block.placeholder}
          onChange={e => update(e.target.value)}
          className={inputClass}
        />
      )}
    </div>
  );
}

function ProgressBlock({ block }: { block: Extract<Block, { type: 'progress' }> }) {
  const max = block.max ?? 100;
  const pct = max > 0 ? Math.min(100, Math.max(0, (block.value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      {block.label && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{block.label}</span>
          <span>{block.value}/{max}</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RelationBlock({ block }: { block: Extract<Block, { type: 'relation' }> }) {
  const { data: item } = useQuery<SpaceItem>({
    queryKey: ['space-item', block.space_id, block.item_id],
    queryFn: () => getSpaceItem(block.space_id, block.item_id),
  });

  const name = item?.name ?? block.label ?? 'Linked item';
  const type = item?.type ?? '';

  return (
    <Link
      to={`/spaces/${block.space_id}/items/${block.item_id}`}
      className="group flex items-center gap-3 rounded-xl border border-border-soft bg-card px-4 py-3 transition-[border-color,box-shadow] hover:border-border hover:shadow-sm"
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <ExternalLink size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        {type && <p className="text-[11px] text-faint-fg capitalize">{type}</p>}
      </div>
      <ArrowRight size={14} className="shrink-0 text-faint-fg transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function FilePreviewBlock({ block }: { block: Extract<Block, { type: 'file-preview' }> }) {
  const isPdf = block.mime_type === 'application/pdf';
  const isImage = block.mime_type.startsWith('image/');
  const token = getToken();
  const apiUrl = token ? `${block.url}?token=${encodeURIComponent(token)}` : block.url;

  if (isPdf) {
    return (
      <div className="overflow-hidden rounded-lg border border-border-soft">
        <div className="flex items-center justify-between border-b border-border-soft bg-muted/40 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText size={13} />
            <span className="font-medium text-foreground">{block.filename}</span>
          </div>
          <a href={apiUrl} download={block.filename} className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Download size={11} />Download
          </a>
        </div>
        <iframe src={apiUrl} title={block.filename} className="h-[700px] w-full bg-white" />
      </div>
    );
  }

  if (isImage) {
    return (
      <div className="overflow-hidden rounded-lg border border-border-soft">
        <img src={apiUrl} alt={block.filename} className="max-h-[600px] w-full object-contain bg-muted/20" />
        <div className="flex items-center justify-between border-t border-border-soft bg-muted/40 px-3 py-2">
          <span className="text-xs text-muted-foreground">{block.filename}</span>
          <a href={apiUrl} download={block.filename} className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Download size={11} />Download
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
      <FileText size={18} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{block.filename}</span>
      <a href={apiUrl} download={block.filename} className="flex items-center gap-1.5 rounded-md border border-border-soft bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
        <Download size={12} />Download
      </a>
    </div>
  );
}
