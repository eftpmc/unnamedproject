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
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      {messages.map(msg => (
        <div key={msg.id}>
          {msg.role === 'user' ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{
                background: '#161616',
                border: '1px solid #222222',
                borderRadius: '8px 8px 2px 8px',
                padding: '8px 12px',
                maxWidth: '70%',
                color: '#bbbbbb',
                fontSize: 11,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ color: '#555555', fontSize: 9 }}>Assistant</div>
              <div style={{ color: '#bbbbbb', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
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
