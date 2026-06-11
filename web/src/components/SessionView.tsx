import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import { getMessages, sendMessage, getSessions, updateSessionConfig, getModelsForEffort } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import type { EffortLevel, Message, Session, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved } from '../types.js';
import { Skeleton } from '@/components/ui/skeleton';

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

interface SessionViewProps {
  sessionId: string;
}

export default function SessionView({ sessionId }: SessionViewProps) {
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => getMessages(sessionId),
  });

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: getSessions,
  });
  const session = sessions.find(s => s.id === sessionId);
  const effort = session?.effort ?? 'medium';

  const { data: models = [] } = useQuery({
    queryKey: ['models', effort],
    queryFn: () => getModelsForEffort(effort),
  });

  const configMutation = useMutation({
    mutationFn: (config: { effort?: EffortLevel; model?: string | null }) => updateSessionConfig(sessionId, config),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  });

  // executions: messageId → list of execution cards
  const [executions, setExecutions] = useState<Record<string, InlineExecution[]>>({});
  // map executionId → messageId (for updates)
  const [execToMsg, setExecToMsg] = useState<Record<string, string>>({});
  // streaming text for in-progress assistant messages
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());

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
    if (event.type === 'agent_error') {
      setSending(false);
    }

    if (event.type === 'message_started') {
      const { message } = event as WSMessageStarted;
      queryClient.setQueryData<Message[]>(['messages', sessionId], prev => {
        if (!prev) return [message];
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
      setStreamingIds(prev => new Set(prev).add(message.id));
      setSending(false);
    }

    if (event.type === 'message_delta') {
      const ev = event as WSMessageDelta;
      queryClient.setQueryData<Message[]>(['messages', sessionId], prev =>
        prev?.map(m => m.id === ev.messageId ? { ...m, content: m.content + ev.delta } : m)
      );
    }

    if (event.type === 'message_created') {
      const { message } = event as WSMessageCreated;
      queryClient.setQueryData<Message[]>(['messages', sessionId], prev => {
        if (!prev) return [message];
        if (prev.some(m => m.id === message.id)) return prev.map(m => m.id === message.id ? message : m);
        return [...prev, message];
      });
      setStreamingIds(prev => {
        if (!prev.has(message.id)) return prev;
        const next = new Set(prev);
        next.delete(message.id);
        return next;
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
      const ev = event as WSExecutionUpdate;
      if (ev.status === 'running' && ev.messageId) {
        const newExec: InlineExecution = {
          executionId: ev.executionId,
          tool: ev.tool ?? 'unknown',
          projectName: ev.projectName,
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
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-2/3 rounded-2xl" />
        <Skeleton className="ml-auto h-20 w-1/2 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center gap-3 px-6">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{sessionTitle}</div>
          <div className="text-xs text-muted-foreground">Agent session</div>
        </div>
      </header>

      <MessageList messages={messages} executions={executions} streamingIds={streamingIds} />

      <MessageInput
        onSend={content => mutation.mutate(content)}
        disabled={sending}
        effort={effort}
        onEffortChange={newEffort => configMutation.mutate({ effort: newEffort, model: null })}
        model={session?.model ?? null}
        onModelChange={model => configMutation.mutate({ model })}
        models={models}
      />
    </div>
  );
}
