import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { GitMerge } from 'lucide-react';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import { getMessages, sendMessage, getChats, updateChatConfig, getModelsForEffort, getSessionWorktree, mergeSessionBranch, getProjects } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '../lib/utils.js';
import type { EffortLevel, Message, MessageExecution, Session, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved, WSSessionTitleUpdated, WSAgentError } from '../types.js';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

type InlineExecution = MessageExecution;

interface ChatViewProps {
  chatId: string;
}

export default function ChatView({ chatId }: ChatViewProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
  });
  const pinnedProject = projects.find(p => p.id === chat?.pinned_project_id) ?? null;

  const configMutation = useMutation({
    mutationFn: (config: { effort?: EffortLevel; model?: string | null; pinned_project_id?: string | null }) => updateChatConfig(chatId, config),
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

  // Hydrate executions from persisted message data so reloading mid-execution
  // or after completion still shows past tool runs and their output.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !messages.length) return;
    hydratedRef.current = true;
    const byMessage: Record<string, InlineExecution[]> = {};
    for (const msg of messages) {
      if (!msg.executions?.length) continue;
      byMessage[msg.id] = msg.executions;
      for (const e of msg.executions) execToMsgRef.current[e.executionId] = msg.id;
    }
    if (Object.keys(byMessage).length) setExecutions(prev => ({ ...byMessage, ...prev }));
  }, [messages]);

  const [sending, setSending] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const agentActive = sending || streamingIds.size > 0 || Object.values(executions).some(list =>
    list.some(exec => exec.status === 'running' || exec.status === 'awaiting_approval')
  );

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

  const sendPrompt = useCallback((content: string) => {
    setAgentError(null);
    mutation.mutate(content);
  }, [mutation]);

  const handleWsEvent = useCallback((event: WSEvent) => {
    if (event.type === 'agent_error') {
      const ev = event as WSAgentError;
      setSending(false);
      setAgentError(ev.error ?? 'The agent encountered an error. Please try again.');
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
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-2 sm:flex-nowrap sm:px-5">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-foreground">
            {chat?.title ?? 'Untitled chat'}
          </span>
          {pinnedProject && (
            <button
              onClick={() => navigate(`/projects/${pinnedProject.id}`)}
              className="flex w-fit max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
              title={`Open ${pinnedProject.name}`}
            >
              <span className={cn(
                'size-1.5 shrink-0 rounded-full',
                agentActive ? 'bg-success' : 'bg-muted-foreground/40',
              )} />
              <span className="text-xs text-muted-foreground truncate">{pinnedProject.name}</span>
            </button>
          )}
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <Select value={effort} onValueChange={value => configMutation.mutate({ effort: value as EffortLevel })}>
            <SelectTrigger size="sm" className="h-7 w-24 rounded-lg border-border/50 bg-muted/70 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['low', 'medium', 'high'] as EffortLevel[]).map(o => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={chat?.model ?? 'auto'}
            onValueChange={value => configMutation.mutate({ model: value === 'auto' ? null : value })}
          >
            <SelectTrigger size="sm" className="h-7 w-40 rounded-lg border-border/50 bg-muted/70 text-xs sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              {models.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              <Button
                size="sm"
                onClick={() => mergeMutation.mutate()}
                disabled={mergeState === 'merging'}
              >
                {mergeState === 'merging' ? 'Merging…' : 'Merge to main'}
              </Button>
            )}
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <EmptyChatState
          projectName={pinnedProject?.name}
          disabled={sending}
          onSelect={sendPrompt}
        />
      ) : (
        <MessageList messages={messages} executions={executions} streamingIds={streamingIds} sessionId={chatId} />
      )}

      {agentError && (
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-destructive/20 bg-destructive/5 px-5 py-2.5 text-xs text-destructive">
          <span>{agentError}</span>
          <button onClick={() => setAgentError(null)} className="shrink-0 text-destructive/60 hover:text-destructive">✕</button>
        </div>
      )}

      <MessageInput
        onSend={sendPrompt}
        disabled={sending}
      />
    </div>
  );
}

function EmptyChatState({
  projectName,
  disabled,
  onSelect,
}: {
  projectName?: string;
  disabled: boolean;
  onSelect: (content: string) => void;
}) {
  const prompts = projectName
    ? [
        `Give me a quick orientation to ${projectName}.`,
        `Review the current state of ${projectName} and suggest next steps.`,
        `Find the highest-impact UI/UX improvements for ${projectName}.`,
      ]
    : [
        'Help me plan the next useful step.',
        'Review this app and suggest the highest-impact improvements.',
        'Start by asking me the fewest questions needed to get moving.',
      ];

  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-xl text-center">
        <div className="text-sm font-semibold text-foreground">
          {projectName ? `Start with ${projectName}` : 'Start a chat'}
        </div>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          Ask for a plan, a review, or a concrete change. The agent will keep tool work and project context attached to this conversation.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
          {prompts.map(prompt => (
            <Button
              key={prompt}
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onSelect(prompt)}
              className="h-auto justify-start rounded-xl px-3 py-2 text-left text-xs font-normal sm:max-w-56"
            >
              {prompt}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
