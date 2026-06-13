import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil } from 'lucide-react';
import ExecutionCard from './ExecutionCard.js';
import CampaignCard from './CampaignCard.js';
import type { Message } from '../types.js';
import { Card, CardContent } from '@/components/ui/card';

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
  p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => (
    <code className="rounded-md bg-muted/70 px-1.5 py-0.5 font-mono text-[13px] text-foreground/85">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-xl border border-border/40 bg-muted/35 p-3 text-[13px] leading-relaxed font-mono">{children}</pre>
  ),
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
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
  if (exec.tool === 'create_campaign' && exec.status === 'done' && exec.result) {
    try {
      const parsed = JSON.parse(exec.result) as { campaign_id: string; project_id: string };
      if (parsed.campaign_id && parsed.project_id) {
        return (
          <CampaignCard
            key={exec.executionId}
            campaignId={parsed.campaign_id}
            projectId={parsed.project_id}
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
                      onClick={() => onEditMessage(msg.id, msg.content)}
                      className="mb-1 shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 hover:text-muted-foreground"
                      title="Edit message"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  <Card className="max-w-[88%] rounded-lg border-border/35 bg-muted/45 py-0 text-foreground shadow-none sm:max-w-[76%]">
                    <CardContent className="px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="flex max-w-[94%] flex-col sm:max-w-[86%]">
                {(msg.content.trim() || isStreaming) && (
                  <div className="w-fit rounded-lg border border-border/35 bg-background/55 px-4 py-3 text-[15px] leading-7 text-foreground shadow-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {stripEmoji(msg.content)}
                    </ReactMarkdown>
                    {isStreaming && (
                      <span className="ml-1 inline-block h-4 w-1.5 animate-pulse align-middle rounded-full bg-foreground/35" />
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
