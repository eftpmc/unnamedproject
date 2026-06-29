import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { ArrowDown, ArrowRight, Check, ChevronDown, ChevronUp, Copy, FileStack, FileText, GitMerge, Image, ListChecks, Pencil, Plug, RotateCcw, Sparkles, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import ExecutionCard from './ExecutionCard.js';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '../lib/utils.js';
import type { Message, MessageFile, SessionEvent } from '../types.js';

// Cards that always stay individually visible: errors/approvals awaiting a
// decision, and tool calls that render as a richer preview card.
function isGroupExempt(exec: InlineExecution): boolean {
  if (exec.status === 'error' || exec.status === 'awaiting_approval') return true;
  return false;
}

function formatToolLabel(tool: string): string {
  return tool
    .replace(/^invoke_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function summarizeGroup(executions: InlineExecution[]): string {
  const parts: string[] = [];
  let prevLabel = '';
  let count = 0;
  for (const exec of executions) {
    const label = formatToolLabel(exec.tool);
    if (label === prevLabel) {
      count++;
    } else {
      if (prevLabel) parts.push(count > 1 ? `${prevLabel} ×${count}` : prevLabel);
      prevLabel = label;
      count = 1;
    }
  }
  if (prevLabel) parts.push(count > 1 ? `${prevLabel} ×${count}` : prevLabel);
  return parts.join(', ');
}

function ExecutionGroup({ executions }: { executions: InlineExecution[] }) {
  const [expanded, setExpanded] = useState(false);
  const anyRunning = executions.some(e => e.status === 'running' || e.status === 'pending');

  return (
    <div className="overflow-hidden rounded-lg border border-border-soft bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-muted/20"
      >
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <ListChecks size={14} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-xs font-medium text-foreground">Ran {executions.length} tools</span>
          <span className="truncate text-[11px] text-faint-fg">{summarizeGroup(executions)}</span>
        </div>
        <StatusPill status={anyRunning ? 'running' : 'done'} />
        <span className="text-muted-foreground/70">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 border-t border-border-soft bg-muted/10 p-2.5">
          {executions.map(exec => (
            <div key={exec.executionId} data-execution-id={exec.executionId}>
              {renderExecutionCard(exec)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface InlineExecution {
  executionId: string;
  tool: string;
  projectName?: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval';
  outputLog: string;
  result: string | null;
  createdAt: number;
  needsApproval: boolean;
  approvalId: string | null;
  action: string | null;
  payload?: Record<string, unknown>;
}

type TimelineItem =
  | { type: 'message'; message: Message; order: number }
  | { type: 'execution'; execution: InlineExecution; order: number }
  | { type: 'event'; event: SessionEvent; order: number };

interface MessageListProps {
  messages: Message[];
  executions: Record<string, InlineExecution[]>;
  streamingIds?: Set<string>;
  sessionId?: string;
  onEditMessage?: (messageId: string, content: string) => void;
  canEdit?: boolean;
  events?: SessionEvent[];
  failedMessageId?: string | null;
  onRetryFailedMessage?: () => void;
  agentThinking?: boolean;
}

function extractTextContent(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join('');
  if (node && typeof node === 'object' && 'props' in (node as object)) {
    return extractTextContent((node as React.ReactElement<{ children?: React.ReactNode }>).props.children);
  }
  return '';
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const child = (Array.isArray(children) ? children[0] : children) as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;
  const childClassName = child?.props?.className ?? '';
  const lang = childClassName.match(/language-(\S+)/)?.[1] ?? '';
  const codeText = extractTextContent(child?.props?.children);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border-soft bg-[#0d1117]">
      <div className="flex items-center justify-between px-3.5 py-1.5 text-[11px] text-white/30">
        <span className="font-mono">{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy code'}
          className="flex items-center gap-1 transition-colors hover:text-white/70"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto border-t border-white/5 px-3.5 pb-3.5 pt-3 font-mono text-[12px] leading-relaxed [&_.hljs]:bg-transparent [&_.hljs]:p-0">
        {children}
      </pre>
    </div>
  );
}

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p:          ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  strong:     ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em:         ({ children }) => <em className="italic">{children}</em>,
  h1:         ({ children }) => <h1 className="mb-3 mt-5 text-xl font-bold text-foreground first:mt-0">{children}</h1>,
  h2:         ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h2>,
  h3:         ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  h4:         ({ children }) => <h4 className="mb-1 mt-2 text-sm font-medium text-foreground first:mt-0">{children}</h4>,
  h5:         ({ children }) => <h5 className="mb-1 mt-2 text-xs font-medium text-foreground first:mt-0">{children}</h5>,
  h6:         ({ children }) => <h6 className="mb-1 mt-2 text-xs font-medium text-muted-foreground first:mt-0">{children}</h6>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-3.5 text-muted-foreground">{children}</blockquote>
  ),
  hr:         () => <hr className="my-4 border-border-soft" />,
  a:          ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  ),
  code:       ({ className, children }) => {
    const isBlock = className?.includes('language-');
    if (isBlock) return <code className={className}>{children}</code>;
    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground/85">{children}</code>;
  },
  pre:        ({ children }) => <CodeBlock>{children}</CodeBlock>,
  ul:         ({ children }) => <ul className="mb-3 ml-5 list-disc">{children}</ul>,
  ol:         ({ children }) => <ol className="mb-3 ml-5 list-decimal">{children}</ol>,
  li:         ({ children }) => <li className="mb-1">{children}</li>,
  table:      ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-border/40">
      <table className="w-full min-w-max border-collapse text-left text-[13px] leading-relaxed">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/45 text-foreground/80">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border/35">{children}</tbody>,
  tr:    ({ children }) => <tr className="divide-x divide-border/35">{children}</tr>,
  th:    ({ children }) => <th className="whitespace-nowrap px-3 py-2 font-semibold">{children}</th>,
  td:    ({ children }) => <td className="px-3 py-2 align-top text-foreground/80">{children}</td>,
};

function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[ \t]{2,}/g, ' ');
}

function renderExecutionCard(exec: InlineExecution) {
  return <ExecutionCard key={exec.executionId} {...exec} />;
}

function ItemCreatedCard({ itemId, label, title, isUpdate }: { itemId: string; label: string; title: string; isUpdate: boolean }) {
  return (
    <Link
      to={`/documents/${itemId}`}
      className="flex items-center gap-2.5 self-start rounded-xl border border-border-soft bg-card px-3 py-2 text-left text-xs transition-colors hover:border-border hover:bg-muted/30"
    >
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{title}</span>
      <span className="text-faint-fg">{isUpdate ? 'updated' : 'created'}</span>
      <ArrowRight size={11} className="text-faint-fg" />
    </Link>
  );
}

function eventIcon(type: SessionEvent['type']) {
  if (type === 'scope_changed' || type === 'project_linked') return Target;
  if (type === 'artifact_created' || type === 'project_created') return Sparkles;
  if (type === 'document_created' || type === 'document_updated') return FileStack;
  return GitMerge;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy'}
      className="shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-muted-foreground"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

const NEAR_BOTTOM_THRESHOLD = 120;

const TEMPLATE_LABELS: Record<string, string> = {
  blank: 'Item', spec: 'Spec', kanban: 'Kanban', report: 'Report', runbook: 'Runbook', config: 'Config', repo: 'Repo', file: 'File',
  // legacy IDs from before v18
  document: 'Item', note: 'Item', tpl_blank: 'Item', tpl_document: 'Item', tpl_spec: 'Spec', tpl_kanban: 'Kanban', tpl_report: 'Report', tpl_note: 'Item',
};

export default function MessageList({ messages, executions, streamingIds, sessionId, onEditMessage, canEdit, events = [], failedMessageId, onRetryFailedMessage, agentThinking }: MessageListProps) {
  const lastUserMessageId = [...messages].reverse().find(m => m.role === 'user')?.id ?? null;
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [hasNewContent, setHasNewContent] = useState(false);

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD;
  }, []);

  const handleScroll = useCallback(() => {
    const near = isNearBottom();
    setShowScrollButton(!near);
    if (near) setHasNewContent(false);
  }, [isNearBottom]);

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    bottomRef.current?.scrollIntoView({ behavior });
    setShowScrollButton(false);
    setHasNewContent(false);
  }

  // Build timeline by anchoring each message's executions immediately after
  // that message, so tool calls always appear between the triggering message
  // and any follow-up assistant message — regardless of client/server clock skew.
  const sortedMessages = [...messages].sort((a, b) => a.created_at - b.created_at);
  const knownMessageIds = new Set(sortedMessages.map(m => m.id));
  const timeline: TimelineItem[] = [];
  const isConversationExec = (exec: InlineExecution) =>
    exec.tool === 'claude_code' || exec.tool === 'invoke_claude_code' ||
    exec.tool === 'codex' || exec.tool === 'invoke_codex';

  sortedMessages.forEach((message, messageIndex) => {
    const messageOrder = message.created_at * 1000 + messageIndex * 10;
    timeline.push({ type: 'message' as const, message, order: messageOrder });
    (executions[message.id] ?? []).forEach((execution, executionIndex) => {
      if (isConversationExec(execution)) return;
      timeline.push({ type: 'execution' as const, execution, order: messageOrder + executionIndex + 1 });
    });
  });
  // Orphaned executions (no matching message yet) go at the end
  Object.entries(executions).forEach(([msgId, execs], orphanIndex) => {
    if (!knownMessageIds.has(msgId)) {
      execs.forEach((execution, executionIndex) => {
        if (isConversationExec(execution)) return;
        timeline.push({ type: 'execution' as const, execution, order: execution.createdAt * 1000 + orphanIndex * 10 + executionIndex });
      });
    }
  });
  events.forEach((event, eventIndex) => {
    timeline.push({ type: 'event' as const, event, order: event.created_at * 1000 + 500 + eventIndex });
  });
  timeline.sort((a, b) => a.order - b.order);

  // Collapse runs of 2+ consecutive groupable executions (routine reads/lookups)
  // into a single ExecutionGroup, so a chain of tool calls doesn't dominate the transcript.
  type RenderItem = TimelineItem | { type: 'execution-group'; executions: InlineExecution[]; order: number };
  const renderItems: RenderItem[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    if (item.type === 'execution' && !isGroupExempt(item.execution)) {
      const run: InlineExecution[] = [item.execution];
      let j = i + 1;
      while (j < timeline.length) {
        const next = timeline[j];
        if (next.type !== 'execution' || isGroupExempt(next.execution)) break;
        run.push(next.execution);
        j++;
      }
      if (run.length >= 2) {
        renderItems.push({ type: 'execution-group', executions: run, order: item.order });
        i = j - 1;
        continue;
      }
    }
    renderItems.push(item);
  }

  useEffect(() => {
    initialScrollDone.current = false;
    setShowScrollButton(false);
    setHasNewContent(false);
  }, [sessionId]);

  useEffect(() => {
    if (!bottomRef.current) return;
    if (!initialScrollDone.current) {
      bottomRef.current.scrollIntoView({ behavior: 'instant' });
      initialScrollDone.current = true;
      return;
    }
    // Only auto-scroll if the user is already near the bottom
    if (isNearBottom()) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    } else {
      setShowScrollButton(true);
      setHasNewContent(true);
    }
  }, [messages.length, messages[messages.length - 1]?.content, streamingIds?.size, isNearBottom]);

  return (
    <div ref={scrollContainerRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto">
      {showScrollButton && (
        <button
          type="button"
          onClick={() => scrollToBottom()}
          className={cn(
            'absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-md transition-all',
            hasNewContent
              ? 'animate-pulse border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border-border bg-card text-foreground hover:bg-muted',
          )}
        >
          {hasNewContent ? (
            <>
              New message
              <ArrowDown size={12} />
            </>
          ) : (
            <>
              <ArrowDown size={12} />
              Scroll to bottom
            </>
          )}
        </button>
      )}
      <div role="log" aria-live="polite" aria-relevant="additions text" className="mx-auto flex w-full max-w-[46rem] flex-col px-4 pb-48 pt-7 sm:px-6 sm:pb-52 sm:pt-8">
        {renderItems.map((item, idx) => {
          // Compute top margin: tight within a run of the same role, spacious at turn changes
          const prevItem = renderItems[idx - 1];
          const currRole = item.type === 'message' ? item.message.role : null;
          const prevRole = prevItem?.type === 'message' ? prevItem.message.role : null;
          const marginTop = idx === 0 ? 0
            : item.type !== 'message' ? 12
            : currRole === prevRole && prevRole !== null ? 8
            : 32;

          if (item.type === 'execution-group') {
            const firstId = item.executions[0].executionId;
            return (
              <div key={`exec-group-${firstId}`} style={{ marginTop }} className="flex max-w-[94%] flex-col sm:max-w-[86%]">
                <ExecutionGroup executions={item.executions} />
              </div>
            );
          }

          if (item.type === 'event') {
            if (item.event.type === 'mcp_required') {
              return (
                <div key={`event-${item.event.id}`} style={{ marginTop }} className="flex items-start gap-3 rounded-lg border border-border-soft bg-muted/40 p-3.5">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Plug size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{item.event.title}</p>
                    {item.event.body && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.event.body}</p>
                    )}
                    <Link
                      to="/settings"
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Open Settings → MCP <ArrowRight size={11} />
                    </Link>
                  </div>
                </div>
              );
            }
            if (
              (item.event.type === 'document_created' || item.event.type === 'document_updated') &&
              item.event.item_id
            ) {
              const isUpdate = item.event.type === 'document_updated';
              const typeLabel = (item.event.metadata as { itemType?: string })?.itemType ?? 'document';
              const label = TEMPLATE_LABELS[typeLabel] ?? typeLabel;
              return (
                <ItemCreatedCard
                  key={`event-${item.event.id}`}
                  itemId={item.event.item_id}
                  label={label}
                  title={item.event.title.replace(/^(Created|Updated) document: /, '')}
                  isUpdate={isUpdate}
                />
              );
            }
            if (item.event.type === 'scope_changed') {
              return (
                <div key={`event-${item.event.id}`} style={{ marginTop }} className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-border-soft" />
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border-soft bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
                    <Target size={10} strokeWidth={1.85} />
                    {item.event.title}
                  </span>
                  <div className="h-px flex-1 bg-border-soft" />
                </div>
              );
            }
            if (item.event.type === 'runtime_checkpoint') {
              const meta = item.event.metadata as { source?: string; invocationMode?: string };
              const label = meta.source === 'user' ? 'Context reset manually' : item.event.title;
              return (
                <div key={`event-${item.event.id}`} style={{ marginTop }} className="flex items-center gap-2.5 py-0.5">
                  <div className="h-px flex-1 bg-border-soft" />
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint-fg">
                    <RotateCcw size={9} strokeWidth={2} />
                    {label}
                  </span>
                  <div className="h-px flex-1 bg-border-soft" />
                </div>
              );
            }
            const Icon = eventIcon(item.event.type);
            return (
              <div key={`event-${item.event.id}`} style={{ marginTop }} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Icon size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-fg-soft">{item.event.title}</span>
                  {item.event.body && <span className="text-faint-fg"> · {item.event.body}</span>}
                </span>
              </div>
            );
          }

          if (item.type === 'execution') {
            return (
              <div key={`exec-${item.execution.executionId}`} data-execution-id={item.execution.executionId} style={{ marginTop }} className="flex max-w-[94%] flex-col sm:max-w-[86%]">
                {renderExecutionCard(item.execution)}
              </div>
            );
          }

          const msg = item.message;
          const isStreaming = streamingIds?.has(msg.id) ?? false;
          if (msg.role === 'assistant' && !msg.content.trim() && !isStreaming) {
            return null;
          }

          const isLastUser = msg.role === 'user' && msg.id === lastUserMessageId;
          const uploads = msg.uploads ?? [];
          const timestamp = new Date(msg.created_at * 1000).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          });
          return (
          <div key={msg.id} style={{ marginTop }}>
            {msg.role === 'user' ? (
              <div className="group flex flex-col items-end">
                <div className="flex items-end gap-2 justify-end">
                  {msg.content.trim() && (
                    <div className="mb-1">
                      <CopyButton text={msg.content} />
                    </div>
                  )}
                  {isLastUser && canEdit && onEditMessage && (
                    <button
                      type="button"
                      onClick={() => onEditMessage(msg.id, msg.content)}
                      className="mb-1 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-muted-foreground"
                      title="Edit message"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  <div
                    title={timestamp}
                    className="max-w-[88%] rounded-[18px] rounded-tr-md border border-primary/[0.11] bg-primary/[0.08] px-4 py-2.5 text-[15px] leading-relaxed text-foreground sm:max-w-[80%]"
                  >
                    {msg.content && (
                      <div className="[&_p:last-child]:mb-0">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    {uploads.length > 0 && (
                      <div className={msg.content ? 'mt-2 flex flex-wrap gap-1.5' : 'flex flex-wrap gap-1.5'}>
                        {uploads.map(doc => (
                          <DocumentChip key={doc.id} doc={doc} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div title={timestamp} className="group flex max-w-[94%] flex-col sm:max-w-[86%]">
                {(msg.content.trim() || isStreaming) && (
                  <div className="max-w-[90%] text-[15px] leading-[1.72] text-fg-soft">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
                      {stripEmoji(msg.content)}
                    </ReactMarkdown>
                    {isStreaming && (
                      <span className="ml-1 inline-block h-3.5 w-1 animate-pulse align-middle rounded-full bg-foreground/30" />
                    )}
                  </div>
                )}
                {msg.content.trim() && !isStreaming && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <CopyButton text={msg.content} />
                  </div>
                )}
                {msg.id === failedMessageId && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
                    <span>Response didn't finish.</span>
                    {onRetryFailedMessage && (
                      <button
                        type="button"
                        onClick={onRetryFailedMessage}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })}
        {agentThinking && (
          <div style={{ marginTop: 32 }} className="flex max-w-[86%] items-center gap-1.5 pb-1">
            <span className="size-1.5 animate-bounce rounded-full bg-foreground/25 [animation-delay:-0.3s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-foreground/25 [animation-delay:-0.15s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-foreground/25" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function DocumentChip({ doc }: { doc: MessageFile }) {
  const isImage = doc.mimeType.startsWith('image/');
  const Icon = isImage ? Image : FileText;
  return (
    <a
      href={`/library/${doc.id}`}
      className="flex max-w-full items-center gap-1.5 rounded-lg border border-border-soft bg-background/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground"
      title={`Open ${doc.title} in library`}
    >
      <Icon size={13} className="shrink-0" />
      <span className="max-w-44 truncate">{doc.title}</span>
    </a>
  );
}
