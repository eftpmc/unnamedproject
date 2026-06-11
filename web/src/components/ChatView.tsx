import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitMerge } from 'lucide-react';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import { getMessages, sendMessage, getChats, updateChatConfig, getModelsForEffort, getSessionWorktree, mergeSessionBranch } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import type { EffortLevel, Message, Session, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved, WSSessionTitleUpdated } from '../types.js';
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

interface ChatViewProps {
  chatId: string;
}

export default function ChatView({ chatId }: ChatViewProps) {
  const queryClient = useQueryClient();

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['messages', chatId],
    queryFn: () => getMessages(chatId),
  });

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });
  const chat = chats.find(s => s.id === chatId);
  const effort = chat?.effort ?? 'medium';

  const { data: models = [] } = useQuery({
    queryKey: ['models', effort],
    queryFn: () => getModelsForEffort(effort),
  });

  const configMutation = useMutation({
    mutationFn: (config: { effort?: EffortLevel; model?: string | null }) => updateChatConfig(chatId, config),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chats'] }),
  });

  const { data: worktree, refetch: refetchWorktree } = useQuery({
    queryKey: ['worktree', chatId],
    queryFn: () => getSessionWorktree(chatId),
    refetchInterval: 20000,
  });

  const [mergeState, setMergeState] = useState<'idle' | 'merging' | 'done' | 'error'>('idle');
  const [mergeError, setMergeError] = useState('');

  const mergeMutation = useMutation({
    mutationFn: () => mergeSessionBranch(chatId),
    onMutate: () => { setMergeState('merging'); setMergeError(''); },
    onSuccess: () => {
      setMergeState('done');
      refetchWorktree();
      setTimeout(() => setMergeState('idle'), 4000);
    },
    onError: (e: Error) => { setMergeState('error'); setMergeError(e.message); },
  });

  // executions: messageId → list of execution cards
  const [executions, setExecutions] = useState<Record<string, InlineExecution[]>>({});
  // map executionId → messageId (ref: never rendered, needs latest value in callbacks)
  const execToMsgRef = useRef<Record<string, string>>({});
  // streaming text for in-progress assistant messages
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());

  const [sending, setSending] = useState(false);

  const mutation = useMutation({
    mutationFn: (content: string) => sendMessage(chatId, content),
    onMutate: () => setSending(true),
    onSettled: () => setSending(false),
    onSuccess: (newMsg) => {
      queryClient.setQueryData<Message[]>(['messages', chatId], prev =>
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
      queryClient.setQueryData<Message[]>(['messages', chatId], prev => {
        if (!prev) return [message];
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
      setStreamingIds(prev => new Set(prev).add(message.id));
      setSending(false);
    }

    if (event.type === 'message_delta') {
      const ev = event as WSMessageDelta;
      queryClient.setQueryData<Message[]>(['messages', chatId], prev =>
        prev?.map(m => m.id === ev.messageId ? { ...m, content: m.content + ev.delta } : m)
      );
    }

    if (event.type === 'message_created') {
      const { message } = event as WSMessageCreated;
      queryClient.setQueryData<Message[]>(['messages', chatId], prev => {
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

      if (ev.status === 'running' && ev.messageId && !execToMsgRef.current[ev.executionId]) {
        // New execution started — register it
        execToMsgRef.current = { ...execToMsgRef.current, [ev.executionId]: ev.messageId };
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
        setExecutions(prev => ({
          ...prev,
          [ev.messageId!]: [...(prev[ev.messageId!] ?? []), newExec],
        }));
      } else {
        // Update to existing execution
        setExecutions(prev => {
          const msgId = execToMsgRef.current[ev.executionId];
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
          if (ev.status === 'done' || ev.status === 'error') refetchWorktree();
          return { ...prev, [msgId]: list.map(e => e.executionId === ev.executionId ? updated : e) };
        });
      }
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

    if (event.type === 'session_title_updated') {
      const ev = event as WSSessionTitleUpdated;
      if (ev.sessionId === chatId) {
        queryClient.invalidateQueries({ queryKey: ['chats'] });
      }
    }

  }, [chatId, queryClient, refetchWorktree]);

  useEffect(() => {
    const unsub = subscribe(handleWsEvent);
    return unsub;
  }, [handleWsEvent]);

  const chatTitle = chat?.title ?? messages.find(m => m.role === 'user')?.content?.slice(0, 40) ?? 'Chat';

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
          <div className="truncate text-sm font-medium">{chatTitle}</div>
        </div>
      </header>

      {worktree && (worktree.ahead > 0 || worktree.has_uncommitted) && (
        <div className="shrink-0 flex items-center gap-3 border-b px-6 py-2 text-xs text-muted-foreground bg-muted/30">
          <GitMerge size={13} className="shrink-0 text-muted-foreground/60" />
          <code className="font-mono text-foreground/70">{worktree.branch}</code>
          <span className="text-muted-foreground/50">·</span>
          {worktree.ahead > 0 && <span>{worktree.ahead} commit{worktree.ahead !== 1 ? 's' : ''}</span>}
          {worktree.ahead > 0 && worktree.has_uncommitted && <span className="text-muted-foreground/50">·</span>}
          {worktree.has_uncommitted && worktree.ahead === 0 && <span>{worktree.files_changed} file{worktree.files_changed !== 1 ? 's' : ''} changed (uncommitted)</span>}
          <div className="ml-auto flex items-center gap-2">
            {mergeState === 'done' && <span className="text-success text-xs">Merged</span>}
            {mergeState === 'error' && <span className="text-destructive text-xs truncate max-w-48" title={mergeError}>Merge failed</span>}
            {worktree.ahead > 0 && (
              <button
                onClick={() => mergeMutation.mutate()}
                disabled={mergeState === 'merging'}
                className="rounded-md px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {mergeState === 'merging' ? 'Merging…' : 'Merge to main'}
              </button>
            )}
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground/60">Send a message to get started</p>
        </div>
      ) : (
        <MessageList messages={messages} executions={executions} streamingIds={streamingIds} sessionId={chatId} />
      )}

      <MessageInput
        onSend={content => mutation.mutate(content)}
        disabled={sending}
        effort={effort}
        onEffortChange={newEffort => configMutation.mutate({ effort: newEffort, model: null })}
        model={chat?.model ?? null}
        onModelChange={model => configMutation.mutate({ model })}
        models={models}
      />
    </div>
  );
}
