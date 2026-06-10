import { useEffect, useRef } from 'react';
import ExecutionCard from './ExecutionCard.js';
import type { Message } from '../types.js';

interface InlineExecution {
  executionId: string;
  tool: string;
  workspaceName?: string;
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
}

export default function MessageList({ messages, executions }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-4">
      {messages.map(msg => (
        <div key={msg.id}>
          {msg.role === 'user' ? (
            <div className="flex justify-end">
              <div className="bg-base-300 rounded-2xl rounded-br-md px-4 py-3 max-w-[70%] text-base-content text-[15px] leading-relaxed whitespace-pre-wrap">
                {msg.content}
              </div>
            </div>
          ) : (
            <div className="max-w-[85%] flex flex-col gap-2">
              <div className="text-base-content/40 text-xs uppercase tracking-wider">Assistant</div>
              <div className="text-base-content text-[15px] leading-relaxed whitespace-pre-wrap">
                {msg.content}
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
  );
}
