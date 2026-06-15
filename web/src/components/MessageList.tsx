import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight, FileText, GitMerge, Image, Pencil, Plug, Sparkles, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import ExecutionCard from './ExecutionCard.js';
import CampaignCard from './CampaignCard.js';
import ArtifactPreviewCard from './ArtifactPreviewCard.js';
import type { Message, SessionEvent } from '../types.js';

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
}

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p:      ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code:   ({ children }) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground/85">{children}</code>
  ),
  pre:    ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-xl border border-border-soft bg-muted/30 p-3 font-mono text-[12px] leading-relaxed">{children}</pre>
  ),
  ul: ({ children }) => <ul className="mb-3 ml-5 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-border/40">
      <table className="w-full min-w-max border-collapse text-left text-[13px] leading-relaxed">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/45 text-foreground/80">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-border/35">{children}</tbody>,
  tr: ({ children }) => <tr className="divide-x divide-border/35">{children}</tr>,
  th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top text-foreground/80">{children}</td>,
};

function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[ \t]{2,}/g, ' ');
}

function renderExecutionCard(exec: InlineExecution) {
  if (exec.status === 'done' && exec.result) {
    try {
      const parsed = JSON.parse(exec.result) as Record<string, unknown>;
      if (exec.tool === 'create_campaign' && parsed.campaign_id && parsed.project_id) {
        return (
          <CampaignCard
            key={exec.executionId}
            campaignId={parsed.campaign_id as string}
            projectId={parsed.project_id as string}
          />
        );
      }
      if ((exec.tool === 'create_artifact' || exec.tool === 'register_artifact') && parsed.artifact_id && parsed.project_id) {
        return (
          <ArtifactPreviewCard
            key={exec.executionId}
            artifactId={parsed.artifact_id as string}
            projectId={parsed.project_id as string}
            title={parsed.title as string}
            kind={parsed.kind as string}
            mimeType={parsed.mime_type as string | undefined}
          />
        );
      }
    } catch { /* fall through to ExecutionCard */ }
  }
  return <ExecutionCard key={exec.executionId} {...exec} />;
}

function eventIcon(type: SessionEvent['type']) {
  if (type === 'scope_changed' || type === 'project_linked') return Target;
  if (type === 'campaign_created' || type === 'artifact_created' || type === 'project_created') return Sparkles;
  return GitMerge;
}

export default function MessageList({ messages, executions, streamingIds, sessionId, onEditMessage, canEdit, events = [] }: MessageListProps) {
  const lastUserMessageId = [...messages].reverse().find(m => m.role === 'user')?.id ?? null;
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

  // Build timeline by anchoring each message's executions immediately after
  // that message, so tool calls always appear between the triggering message
  // and any follow-up assistant message — regardless of client/server clock skew.
  const sortedMessages = [...messages].sort((a, b) => a.created_at - b.created_at);
  const knownMessageIds = new Set(sortedMessages.map(m => m.id));
  const timeline: TimelineItem[] = [];
  sortedMessages.forEach((message, messageIndex) => {
    const messageOrder = message.created_at * 1000 + messageIndex * 10;
    timeline.push({ type: 'message' as const, message, order: messageOrder });
    (executions[message.id] ?? []).forEach((execution, executionIndex) => {
      timeline.push({ type: 'execution' as const, execution, order: messageOrder + executionIndex + 1 });
    });
  });
  // Orphaned executions (no matching message yet) go at the end
  Object.entries(executions).forEach(([msgId, execs], orphanIndex) => {
    if (!knownMessageIds.has(msgId)) {
      execs.forEach((execution, executionIndex) => {
        timeline.push({ type: 'execution' as const, execution, order: execution.createdAt * 1000 + orphanIndex * 10 + executionIndex });
      });
    }
  });
  events.forEach((event, eventIndex) => {
    timeline.push({ type: 'event' as const, event, order: event.created_at * 1000 + 500 + eventIndex });
  });
  timeline.sort((a, b) => a.order - b.order);

  useEffect(() => {
    initialScrollDone.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({
      behavior: initialScrollDone.current ? 'smooth' : 'instant',
    });
    initialScrollDone.current = true;
  }, [messages.length, messages[messages.length - 1]?.content, streamingIds?.size]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 py-7 sm:px-6 sm:py-8">
        {timeline.map(item => {
          if (item.type === 'event') {
            if (item.event.type === 'mcp_required') {
              return (
                <div key={`event-${item.event.id}`} className="flex items-start gap-3 rounded-lg border border-border-soft bg-muted/40 p-3.5">
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
            const Icon = eventIcon(item.event.type);
            return (
              <div key={`event-${item.event.id}`} className="flex items-center gap-2 text-xs text-muted-foreground">
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
              <div key={`exec-${item.execution.executionId}`} data-execution-id={item.execution.executionId} className="flex max-w-[94%] flex-col sm:max-w-[86%]">
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
          const attachments = msg.attachments ?? [];
          return (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="group flex flex-col items-end">
                <div className="flex items-end gap-2 justify-end">
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
                  <div className="max-w-[88%] rounded-[18px] rounded-tr-md bg-muted px-4 py-2.5 text-[15px] leading-relaxed text-foreground sm:max-w-[80%]">
                    {msg.content && <div className="whitespace-pre-wrap">{msg.content}</div>}
                    {attachments.length > 0 && (
                      <div className={msg.content ? 'mt-2 flex flex-wrap gap-1.5' : 'flex flex-wrap gap-1.5'}>
                        {attachments.map(attachment => {
                          const Icon = attachment.mimeType.startsWith('image/') ? Image : FileText;
                          return (
                            <div key={attachment.id} className="flex max-w-full items-center gap-1.5 rounded-lg border border-border-soft bg-background/70 px-2 py-1 text-xs text-muted-foreground">
                              <Icon size={13} className="shrink-0" />
                              <span className="max-w-44 truncate">{attachment.filename}</span>
                              <span className="shrink-0 text-faint-fg">{formatFileSize(attachment.sizeBytes)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex max-w-[94%] flex-col sm:max-w-[86%]">
                {(msg.content.trim() || isStreaming) && (
                  <div className="max-w-[90%] text-[15px] leading-[1.72] text-fg-soft">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {stripEmoji(msg.content)}
                    </ReactMarkdown>
                    {isStreaming && (
                      <span className="ml-1 inline-block h-3.5 w-1 animate-pulse align-middle rounded-full bg-foreground/30" />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
