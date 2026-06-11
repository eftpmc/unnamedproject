import { useEffect, useRef } from 'react';
import ExecutionCard from './ExecutionCard.js';
import type { Message } from '../types.js';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';

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
  executions: Record<string, InlineExecution[]>; // keyed by messageId
  streamingIds?: Set<string>;
}

export default function MessageList({ messages, executions, streamingIds }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <ScrollArea className="flex-1">
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
                <div className="rounded-3xl rounded-bl-lg bg-background/72 px-4 py-3 text-[15px] leading-7 whitespace-pre-wrap text-foreground shadow-xs ring-1 ring-border/45">
                  {msg.content}
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
    </ScrollArea>
  );
}
