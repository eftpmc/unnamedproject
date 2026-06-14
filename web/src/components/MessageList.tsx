import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil } from 'lucide-react';
import ExecutionCard from './ExecutionCard.js';
import CampaignCard from './CampaignCard.js';
import ArtifactPreviewCard from './ArtifactPreviewCard.js';
import type { Message } from '../types.js';

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
  | { type: 'message'; message: Message }
  | { type: 'execution'; execution: InlineExecution };

interface MessageListProps {
  messages: Message[];
  executions: Record<string, InlineExecution[]>;
  streamingIds?: Set<string>;
  sessionId?: string;
  onEditMessage?: (messageId: string, content: string) => void;
  canEdit?: boolean;
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

export default function MessageList({ messages, executions, streamingIds, sessionId, onEditMessage, canEdit }: MessageListProps) {
  const lastUserMessageId = [...messages].reverse().find(m => m.role === 'user')?.id ?? null;
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

  // Build timeline by anchoring each message's executions immediately after
  // that message, so tool calls always appear between the triggering message
  // and any follow-up assistant message — regardless of client/server clock skew.
  const sortedMessages = [...messages].sort((a, b) => a.created_at - b.created_at);
  const knownMessageIds = new Set(sortedMessages.map(m => m.id));
  const timeline: TimelineItem[] = [];
  sortedMessages.forEach((message) => {
    timeline.push({ type: 'message' as const, message });
    (executions[message.id] ?? []).forEach((execution) => {
      timeline.push({ type: 'execution' as const, execution });
    });
  });
  // Orphaned executions (no matching message yet) go at the end
  Object.entries(executions).forEach(([msgId, execs]) => {
    if (!knownMessageIds.has(msgId)) {
      execs.forEach((execution) => {
        timeline.push({ type: 'execution' as const, execution });
      });
    }
  });

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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-7">
        {timeline.map(item => {
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
                  <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-muted px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
                    {msg.content}
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
