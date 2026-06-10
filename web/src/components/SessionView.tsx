import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import { getMessages, sendMessage } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import type { Message, WSEvent, WSMessageCreated, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved } from '../types.js';

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

interface SessionViewProps {
  sessionId: string;
}

export default function SessionView({ sessionId }: SessionViewProps) {
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => getMessages(sessionId),
  });

  // executions: messageId → list of execution cards
  const [executions, setExecutions] = useState<Record<string, InlineExecution[]>>({});
  // map executionId → messageId (for updates)
  const [execToMsg, setExecToMsg] = useState<Record<string, string>>({});

  const [sending, setSending] = useState(false);

  const mutation = useMutation({
    mutationFn: (content: string) => sendMessage(sessionId, content),
    onMutate: () => setSending(true),
    onSettled: () => setSending(false),
    onSuccess: (newMsg) => {
      queryClient.setQueryData<Message[]>(['messages', sessionId], prev =>
        prev ? [...prev, newMsg] : [newMsg]
      );
    },
  });

  const handleWsEvent = useCallback((event: WSEvent) => {
    if (event.type === 'message_created') {
      const { message } = event as WSMessageCreated;
      queryClient.setQueryData<Message[]>(['messages', sessionId], prev => {
        if (!prev) return [message];
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
      setSending(false);
    }

    if (event.type === 'execution_update') {
      const ev = event as WSExecutionUpdate;
      setExecutions(prev => {
        const msgId = execToMsg[ev.executionId];
        if (!msgId) return prev;
        const list = prev[msgId] ?? [];
        const existing = list.find(e => e.executionId === ev.executionId);
        if (!existing) return prev;
        const updated = {
          ...existing,
          ...(ev.status ? { status: ev.status as InlineExecution['status'] } : {}),
          ...(ev.chunk ? { outputLog: existing.outputLog + ev.chunk } : {}),
          ...(ev.result ? { result: ev.result } : {}),
        };
        return { ...prev, [msgId]: list.map(e => e.executionId === ev.executionId ? updated : e) };
      });
    }

    if (event.type === 'approval_requested') {
      const ev = event as WSApprovalRequested;
      setExecutions(prev => {
        // Find or create the execution entry
        for (const [msgId, list] of Object.entries(prev)) {
          const existing = list.find(e => e.executionId === ev.executionId);
          if (existing) {
            const updated = { ...existing, status: 'awaiting_approval' as const, needsApproval: true, approvalId: ev.approvalId, action: ev.action };
            return { ...prev, [msgId]: list.map(e => e.executionId === ev.executionId ? updated : e) };
          }
        }
        return prev;
      });
    }

    if (event.type === 'action_auto_approved') {
      const ev = event as WSAutoApproved;
      setExecutions(prev => {
        for (const [msgId, list] of Object.entries(prev)) {
          const existing = list.find(e => e.executionId === ev.executionId);
          if (existing) {
            return { ...prev, [msgId]: list.map(e =>
              e.executionId === ev.executionId ? { ...e, status: 'running' as const } : e
            )};
          }
        }
        return prev;
      });
    }

    // New execution started (from execution_update with status='running' + no existing entry)
    if (event.type === 'execution_update') {
      const ev = event as WSExecutionUpdate & { tool?: string; workspaceName?: string; messageId?: string };
      if (ev.status === 'running' && ev.messageId) {
        const newExec: InlineExecution = {
          executionId: ev.executionId,
          tool: ev.tool ?? 'unknown',
          workspaceName: ev.workspaceName,
          status: 'running',
          outputLog: '',
          result: null,
          needsApproval: false,
          approvalId: null,
          action: null,
        };
        setExecToMsg(prev => ({ ...prev, [ev.executionId]: ev.messageId! }));
        setExecutions(prev => ({
          ...prev,
          [ev.messageId!]: [...(prev[ev.messageId!] ?? []), newExec],
        }));
      }
    }
  }, [sessionId, queryClient, execToMsg]);

  useEffect(() => {
    const unsub = subscribe(handleWsEvent);
    return unsub;
  }, [handleWsEvent]);

  const sessionTitle = messages.find(m => m.role === 'user')?.content?.slice(0, 40) ?? 'Session';

  if (isLoading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 11 }}>Loading…</div>;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        height: 40,
        padding: '0 16px',
        borderBottom: '1px solid #141414',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ color: '#aaaaaa', fontSize: 11, fontWeight: 500, flex: 1 }}>
          {sessionTitle}
        </span>
      </div>

      <MessageList messages={messages} executions={executions} />

      <MessageInput
        onSend={content => mutation.mutate(content)}
        disabled={sending}
      />
    </div>
  );
}
