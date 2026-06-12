import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
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
  needsApproval: boolean;
  approvalId: string | null;
  action: string | null;
}

interface MessageListProps {
  messages: Message[];
  executions: Record<string, InlineExecution[]>;
  streamingIds?: Set<string>;
  sessionId?: string;
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
};

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

export default function MessageList({ messages, executions, streamingIds, sessionId }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

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
        {messages.map(msg => {
          const msgExecutions = executions[msg.id] ?? [];
          const isStreaming = streamingIds?.has(msg.id) ?? false;
          if (msg.role === 'assistant' && !msg.content.trim() && msgExecutions.length === 0 && !isStreaming) {
            return null;
          }

          return (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex flex-col items-end gap-2">
                <div className="flex justify-end">
                  <Card className="max-w-[88%] rounded-2xl rounded-br-md border-border/35 bg-muted/45 py-0 text-foreground shadow-none sm:max-w-[76%]">
                    <CardContent className="px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </CardContent>
                  </Card>
                </div>
                {msgExecutions.map(exec => (
                  <div key={exec.executionId} className="w-full max-w-[92%] sm:max-w-[82%]">
                    {renderExecutionCard(exec)}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex max-w-[94%] flex-col gap-2 sm:max-w-[86%]">
                {(msg.content.trim() || isStreaming) && (
                  <div className="w-fit rounded-2xl rounded-bl-md border border-border/35 bg-background/55 px-4 py-3 text-[15px] leading-7 text-foreground shadow-xs">
                    <ReactMarkdown components={markdownComponents}>
                      {msg.content}
                    </ReactMarkdown>
                    {isStreaming && (
                      <span className="ml-1 inline-block h-4 w-1.5 animate-pulse align-middle rounded-full bg-foreground/35" />
                    )}
                  </div>
                )}
                {msgExecutions.map(exec => (
                  <div key={exec.executionId} className="w-full max-w-[92%] sm:max-w-[82%]">
                    {renderExecutionCard(exec)}
                  </div>
                ))}
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
