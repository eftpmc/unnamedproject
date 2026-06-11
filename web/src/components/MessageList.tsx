import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import ExecutionCard from './ExecutionCard.js';
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
}

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children, className }) => {
    const isBlock = !!className;
    if (isBlock) return <code className="block">{children}</code>;
    return <code className="rounded bg-muted px-1 font-mono text-[13px]">{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 text-[13px] leading-relaxed font-mono">{children}</pre>
  ),
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
};

export default function MessageList({ messages, executions, streamingIds }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);

  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({
      behavior: initialScrollDone.current ? 'smooth' : 'instant',
    });
    initialScrollDone.current = true;
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-6">
        {messages.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <Card className="max-w-[72%] rounded-3xl rounded-br-lg border-transparent bg-foreground py-0 text-background shadow-sm">
                  <CardContent className="px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="flex w-fit max-w-[86%] flex-col gap-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-success" />
                  Assistant
                </div>
                <div className="rounded-3xl rounded-bl-lg bg-background/72 px-4 py-3 text-[15px] leading-7 text-foreground shadow-xs ring-1 ring-border/45">
                  <ReactMarkdown components={markdownComponents}>
                    {msg.content}
                  </ReactMarkdown>
                  {streamingIds?.has(msg.id) && (
                    <span className="ml-1 inline-block h-4 w-1.5 animate-pulse align-middle rounded-full bg-foreground/40" />
                  )}
                </div>
                {(executions[msg.id] ?? []).map(exec => (
                  <ExecutionCard key={exec.executionId} {...exec} />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
