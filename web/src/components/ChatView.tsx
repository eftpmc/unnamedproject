import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, GitBranch, PanelRight, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import ContextPanel from './ContextPanel.js';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import EditableTitle from './EditableTitle.js';
import WorktreeDiff from './WorktreeDiff.js';
import ContextBar from './ContextBar.js';
import EmptyChatState from './EmptyChatState.js';
import ScopePopover from './ScopePopover.js';
import { getMessages, sendMessage, getChats, updateChatConfig, getModelsForEffort, getSessionWorktree, mergeSessionBranch, getWorktreeDiff, getSpaces, truncateMessagesFrom, approveExecution, rejectExecution, getChatEvents, getChatStatus, stopChat } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '../lib/utils.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { getAgentStatusText } from '../lib/chatStatus.js';
import type { EffortLevel, Message, MessageExecution, Session, SessionEvent, SessionSpaceLink, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved, WSSessionTitleUpdated, WSSessionEventCreated, WSAgentError, WSTurnComplete } from '../types.js';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/app-layout';

type InlineExecution = MessageExecution;

interface ChatViewProps {
  chatId: string;
}

export default function ChatView({ chatId }: ChatViewProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: messages = [], isLoading, isError: messagesError, error: messagesErrorObj, refetch: refetchMessages } = useQuery({
    queryKey: ['messages', chatId],
    queryFn: () => getMessages(chatId),
  });

  const { data: chatStatus } = useQuery({
    queryKey: ['chat-status', chatId],
    queryFn: () => getChatStatus(chatId),
    refetchInterval: query => query.state.data?.active ? 3000 : false,
  });

  const { data: chatEventsData } = useQuery({
    queryKey: ['chat-events', chatId],
    queryFn: () => getChatEvents(chatId),
  });
  const chatEvents = chatEventsData?.events ?? [];
  const linkedProjects = chatEventsData?.projects ?? [];

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });
  const chat = chats.find(s => s.id === chatId);
  const effort = chat?.effort ?? 'medium';

  usePageTitle(chat?.title);

  const { data: models = [] } = useQuery({
    queryKey: ['models', effort],
    queryFn: () => getModelsForEffort(effort),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['spaces'],
    queryFn: getSpaces,
  });
  const pinnedProject = projects.find(p => p.id === chat?.pinned_space_id) ?? null;
  const inferredProject = !pinnedProject ? linkedProjects[linkedProjects.length - 1] ?? null : null;
  const contextProject = pinnedProject ?? inferredProject;

  const configMutation = useMutation({
    mutationFn: (config: { effort?: EffortLevel; model?: string | null; pinned_space_id?: string | null; title?: string }) => updateChatConfig(chatId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chat-events', chatId] });
    },
  });

  const { data: worktree, refetch: refetchWorktreeQuery } = useQuery({
    queryKey: ['worktree', chatId],
    queryFn: () => getSessionWorktree(chatId),
    refetchInterval: 20000,
  });
  const refetchWorktreeRef = useRef(refetchWorktreeQuery);
  refetchWorktreeRef.current = refetchWorktreeQuery;
  const refetchWorktree = useCallback(() => refetchWorktreeRef.current(), []);

  const [mergeState, setMergeState] = useState<'idle' | 'merging' | 'done' | 'error'>('idle');
  const [lastInputTokens, setLastInputTokens] = useState<number | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);

  const { data: diffData } = useQuery({
    queryKey: ['worktree-diff', chatId],
    queryFn: () => getWorktreeDiff(chatId),
    enabled: diffOpen,
    staleTime: 10_000,
  });

  const mergeMutation = useMutation({
    mutationFn: () => mergeSessionBranch(chatId),
    onMutate: () => { setMergeState('merging'); },
    onSuccess: () => {
      setMergeState('done');
      refetchWorktree();
      setTimeout(() => setMergeState('idle'), 4000);
    },
    onError: () => { setMergeState('error'); },
  });

  // executions: messageId -> list of execution cards
  const [executions, setExecutions] = useState<Record<string, InlineExecution[]>>({});
  // map executionId → messageId (ref: never rendered, needs latest value in callbacks)
  const execToMsgRef = useRef<Record<string, string>>({});
  // streaming text for in-progress assistant messages
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());

  // Hydrate executions from persisted message data so reloading mid-execution
  // or after completion still shows past tool runs and their output.
  const hydratedRef = useRef(false);
  useEffect(() => {
    hydratedRef.current = false;
    execToMsgRef.current = {};
    setExecutions({});
    setStreamingIds(new Set());
    setSending(false);
    setAgentError(null);
    setFailedMessageId(null);
    setLastInputTokens(null);
  }, [chatId]);

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

  const draftKey = `draft:${chatId}`;
  const [inputValue, setInputValue] = useState(() => localStorage.getItem(draftKey) ?? '');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [failedMessageId, setFailedMessageId] = useState<string | null>(null);
  const hasActiveExecution = Object.values(executions).some(list =>
    list.some(exec => exec.status === 'running' || exec.status === 'awaiting_approval')
  );
  const agentActive = sending || !!chatStatus?.active || streamingIds.size > 0 || hasActiveExecution;
  const agentStarting = !!chatStatus?.active && streamingIds.size === 0 && !hasActiveExecution;
  const [statusNow, setStatusNow] = useState(() => Math.floor(Date.now() / 1000));
  const agentStatusText = getAgentStatusText({
    sending,
    agentStarting,
    chatStatus,
    now: statusNow,
  });

  const pendingApproval = Object.values(executions).flat().find(
    e => e.status === 'awaiting_approval' && e.needsApproval
  ) ?? null;

  const [dropFiles, setDropFiles] = useState<File[]>([]);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  function handleDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounterRef.current++;
    setIsDragging(true);
  }
  function handleDragLeave() {
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }
  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) setDropFiles(files);
  }

  const [ctxOpen, setCtxOpen] = useState<boolean>(() => {
    if (window.innerWidth <= 768) return false;
    return localStorage.getItem('ctx_panel') !== 'closed';
  });

  function toggleCtx() {
    setCtxOpen(prev => {
      const next = !prev;
      localStorage.setItem('ctx_panel', next ? 'open' : 'closed');
      return next;
    });
  }

  async function handleApprove(approvalId: string) {
    await approveExecution(approvalId);
  }
  async function handleDeny(approvalId: string) {
    await rejectExecution(approvalId);
  }

  const mutation = useMutation({
    mutationFn: ({ content, attachments }: { content: string; attachments: File[] }) => sendMessage(chatId, content, attachments),
    onMutate: async ({ content }) => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] });
      const previous = queryClient.getQueryData<Message[]>(['messages', chatId]);
      const optimisticId = `opt-${Date.now()}`;
      queryClient.setQueryData<Message[]>(['messages', chatId], prev => [
        ...(prev ?? []),
        { id: optimisticId, role: 'user' as const, content, created_at: Math.floor(Date.now() / 1000) },
      ]);
      return { previous, optimisticId };
    },
    onSuccess: (newMsg, _, context) => {
      queryClient.setQueryData<Message[]>(['messages', chatId], prev => {
        if (!prev) return [newMsg];
        const filtered = prev.filter(m => m.id !== context?.optimisticId);
        if (filtered.some(m => m.id === newMsg.id)) return filtered.map(m => m.id === newMsg.id ? newMsg : m);
        return [...filtered, newMsg];
      });
      queryClient.setQueryData(['chat-status', chatId], {
        active: true,
        turn: { id: `pending-${newMsg.id}`, userMessageId: newMsg.id, startedAt: Math.floor(Date.now() / 1000) },
        execution: null,
      });
    },
    onError: (_, __, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['messages', chatId], context.previous);
      }
    },
  });

  const handleEditMessage = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setInputValue(content);
  }, []);

  const sendPrompt = useCallback(async (overrideContent?: string, attachments: File[] = []): Promise<boolean> => {
    const content = (overrideContent ?? inputValue).trim();
    if (!content && attachments.length === 0) return false;
    setSending(true);
    setAgentError(null);
    setFailedMessageId(null);

    // Clear input immediately so it feels instant
    setInputValue('');
    localStorage.removeItem(draftKey);

    try {
      if (editingMessageId) {
        const eid = editingMessageId;
        setEditingMessageId(null);
        await truncateMessagesFrom(chatId, eid);
        queryClient.setQueryData<Message[]>(['messages', chatId], prev => {
          if (!prev) return prev;
          const idx = prev.findIndex(x => x.id === eid);
          return idx === -1 ? prev : prev.slice(0, idx);
        });
      }

      await mutation.mutateAsync({ content, attachments });
      setSending(false);
      return true;
    } catch {
      // Restore input on failure so user doesn't lose their message
      setInputValue(content);
      if (content) localStorage.setItem(draftKey, content);
      setSending(false);
      setAgentError('Message could not be sent. Please try again.');
      return false;
    }
  }, [inputValue, editingMessageId, chatId, queryClient, mutation]);

  const handleWsEvent = useCallback((event: WSEvent) => {
    const scopedTypes = new Set([
      'agent_error',
      'message_started',
      'message_delta',
      'message_created',
      'execution_update',
      'approval_requested',
      'action_auto_approved',
      'turn_complete',
    ]);
    if (scopedTypes.has(event.type)) {
      const eventSessionId = typeof event.sessionId === 'string' ? event.sessionId : null;
      if (eventSessionId !== chatId) return;
    }

    if (event.type === 'agent_error') {
      const ev = event as WSAgentError;
      setSending(false);
      setAgentError(ev.error ?? 'The agent encountered an error. Please try again.');
      queryClient.setQueryData(['chat-status', chatId], { active: false, turn: null, execution: null });
      // A turn that errors mid-stream never fires message_created, so streamingIds
      // would otherwise leave a permanently stuck streaming cursor on that message.
      setStreamingIds(prev => {
        if (prev.size === 0) return prev;
        setFailedMessageId([...prev][0]);
        return new Set();
      });
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
      queryClient.setQueryData(['chat-status', chatId], (prev: unknown) => ({ ...(prev as object ?? {}), active: true }));
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

    if (event.type === 'turn_complete') {
      const ev = event as WSTurnComplete;
      queryClient.setQueryData(['chat-status', chatId], { active: false, turn: null, execution: null });
      if (ev.status === 'error') {
        queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
        setStreamingIds(prev => {
          if (prev.size === 0) return prev;
          setFailedMessageId([...prev][0]);
          return new Set();
        });
      }
      if (ev.status === 'done' && ev.inputTokens) setLastInputTokens(ev.inputTokens);
    }

    if (event.type === 'execution_update') {
      const ev = event as WSExecutionUpdate;
      if (ev.status === 'running' || ev.status === 'awaiting_approval') {
        queryClient.setQueryData(['chat-status', chatId], (prev: unknown) => ({ ...(prev as object ?? {}), active: true }));
      }

      if (ev.status === 'running' && ev.messageId && !execToMsgRef.current[ev.executionId]) {
        // New execution started — register it
        execToMsgRef.current = { ...execToMsgRef.current, [ev.executionId]: ev.messageId };
        const newExec: InlineExecution = {
          executionId: ev.executionId,
          tool: ev.tool ?? 'unknown',
          spaceName: ev.spaceName,
          status: 'running',
          outputLog: '',
          result: null,
          createdAt: Math.floor(Date.now() / 1000),
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
            ...(ev.status ? {
              status: ev.status as InlineExecution['status'],
              needsApproval: ev.status === 'awaiting_approval' ? existing.needsApproval : false,
              approvalId: ev.status === 'awaiting_approval' ? existing.approvalId : null,
              action: ev.status === 'awaiting_approval' ? existing.action : null,
            } : {}),
            ...(ev.chunk ? { outputLog: existing.outputLog + ev.chunk } : {}),
            ...(ev.result ? { result: ev.result } : {}),
          };
          if (ev.status === 'done' || ev.status === 'error') refetchWorktree();
          if (ev.status === 'done' || ev.status === 'error') queryClient.invalidateQueries({ queryKey: ['chat-status', chatId] });
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
            const updated = { ...existing, status: 'awaiting_approval' as const, needsApproval: true, approvalId: ev.approvalId, action: ev.action, payload: ev.payload };
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

    if (event.type === 'session_event_created') {
      const ev = event as WSSessionEventCreated;
      if (ev.sessionId === chatId) {
        queryClient.setQueryData<{ events: SessionEvent[]; projects: SessionSpaceLink[] }>(['chat-events', chatId], prev => {
          if (!prev) return { events: [ev.event], projects: [] };
          if (prev.events.some(e => e.id === ev.event.id)) return prev;
          return { ...prev, events: [...prev.events, ev.event] };
        });
        queryClient.invalidateQueries({ queryKey: ['chat-events', chatId] });
      }
    }

  }, [chatId, queryClient, refetchWorktree]);

  useEffect(() => {
    const unsub = subscribe(handleWsEvent);
    return unsub;
  }, [handleWsEvent]);

  useEffect(() => {
    if (!agentActive) return;
    setStatusNow(Math.floor(Date.now() / 1000));
    const interval = window.setInterval(() => setStatusNow(Math.floor(Date.now() / 1000)), 15000);
    return () => window.clearInterval(interval);
  }, [agentActive]);

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 w-2/3 rounded-2xl" />
        <Skeleton className="ml-auto h-20 w-1/2 rounded-2xl" />
      </div>
    );
  }

  if (messagesError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load this chat.</div>
          <p className="mt-1 text-muted-foreground">{messagesErrorObj instanceof Error ? messagesErrorObj.message : 'Please try again.'}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchMessages()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 backdrop-blur-[1px]">
          <div className="rounded-xl border border-primary/20 bg-card px-6 py-4 text-center shadow-lg">
            <p className="text-sm font-medium text-foreground">Drop files to attach</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Images, PDFs, text files</p>
          </div>
        </div>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
      <PageHeader
        title={(
          <div className="flex min-w-0 items-center gap-1">
            <EditableTitle title={chat?.title ?? 'Untitled chat'} onSave={(t) => configMutation.mutate({ title: t })} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Chat settings"
                  className="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronDown size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <ScopePopover
                  spaces={projects}
                  pinnedProject={pinnedProject}
                  inferredProject={inferredProject}
                  agentActive={agentActive}
                  onOpenSpace={(spaceId) => navigate(`/spaces/${spaceId}`)}
                  onScopeChange={(spaceId) => configMutation.mutate({ pinned_space_id: spaceId })}
                />
                {worktree && (
                  <DropdownMenuItem onSelect={() => setDiffOpen(true)}>
                    <GitBranch size={14} className="shrink-0" />
                    <span className="flex-1 truncate font-mono text-xs">{worktree.branch}</span>
                    {worktree.files_changed > 0 && (
                      <span className="text-warning">{worktree.files_changed} changed</span>
                    )}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        className="border-0 px-5 py-2.5"
        description={lastInputTokens !== null ? <ContextBar inputTokens={lastInputTokens} /> : undefined}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleCtx}
              aria-pressed={ctxOpen}
              title={ctxOpen ? 'Hide context' : 'Show context'}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                ctxOpen
                  ? 'border-transparent bg-accent-tint text-on-accent-soft'
                  : 'border-border-soft bg-muted text-muted-foreground hover:border-muted-foreground',
              )}
            >
              <PanelRight size={14} strokeWidth={1.75} />
              Context
              {!ctxOpen && pendingApproval && (
                <span className="size-1.5 rounded-full bg-warning" />
              )}
            </button>
          </div>
        }
      />

      {messages.length === 0 ? (
        <EmptyChatState
          value={inputValue}
          onChange={(v) => { setInputValue(v); if (v) localStorage.setItem(draftKey, v); else localStorage.removeItem(draftKey); }}
          onSendContent={(content) => sendPrompt(content)}
          disabled={agentActive}
          projectName={pinnedProject?.name}
        />
      ) : (
        <MessageList
          messages={messages}
          executions={executions}
          streamingIds={streamingIds}
          sessionId={chatId}
          onEditMessage={handleEditMessage}
          canEdit={!agentActive}
          events={chatEvents}
          failedMessageId={failedMessageId}
          onRetryFailedMessage={() => {
            const lastUserContent = [...messages].reverse().find(m => m.role === 'user')?.content ?? null;
            if (lastUserContent) sendPrompt(lastUserContent);
          }}
        />
      )}

      {messages.length > 0 && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="pointer-events-auto relative flex flex-col">
          <div className="pointer-events-none absolute bottom-full left-1/2 h-20 w-full max-w-3xl -translate-x-1/2 bg-gradient-to-t from-background via-background/90 to-transparent sm:h-24" />

          {agentError && (() => {
            const lastUserContent = [...messages].reverse().find(m => m.role === 'user')?.content ?? null;
            return (
              <div className="px-4 sm:px-6">
                <div className="mx-auto flex max-w-[46rem] items-center justify-between gap-3 rounded-t-lg border border-b-0 border-destructive/20 bg-destructive/5 px-5 py-2.5 text-xs text-destructive">
                  <span className="min-w-0 flex-1 truncate">{agentError}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {lastUserContent && (
                      <button
                        type="button"
                        onClick={() => { setAgentError(null); sendPrompt(lastUserContent); }}
                        className="font-medium text-destructive/70 transition-colors hover:text-destructive"
                      >
                        Retry
                      </button>
                    )}
                    <button type="button" onClick={() => setAgentError(null)} className="text-destructive/60 hover:text-destructive" aria-label="Dismiss error">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {pendingApproval && !ctxOpen && (
            <div className="px-4 sm:px-6 md:hidden">
              <div className="mx-auto flex max-w-[46rem] items-center justify-between gap-3 rounded-t-lg border border-b-0 border-warning/25 bg-warning/8 px-5 py-2.5 text-sm">
                <div className="flex items-center gap-2 text-fg-soft">
                  <Bell size={14} className="text-warning" />
                  <span>Approval needed for <strong className="font-semibold text-foreground">{pendingApproval.action ?? 'Tool execution'}</strong></span>
                </div>
                <button
                  type="button"
                  onClick={toggleCtx}
                  className="text-xs font-medium text-on-accent-soft hover:underline"
                >
                  Review
                </button>
              </div>
            </div>
          )}

          <MessageInput
            value={inputValue}
            onChange={(v) => { setInputValue(v); if (v) localStorage.setItem(draftKey, v); else localStorage.removeItem(draftKey); }}
            onSend={(attachments) => sendPrompt(undefined, attachments)}
            onStop={() => stopChat(chatId).catch(() => {})}
            disabled={agentActive}
            isEditing={!!editingMessageId}
            onCancelEdit={() => { setEditingMessageId(null); setInputValue(''); }}
            pendingFiles={dropFiles}
            onPendingFilesConsumed={() => setDropFiles([])}
            effort={effort}
            model={chat?.model ?? null}
            models={models}
            onConfigChange={(config) => configMutation.mutate(config)}
          />
        </div>
      </div>}
      </div>
      <Sheet open={diffOpen} onOpenChange={setDiffOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-border-soft px-5 py-4">
            <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
              <GitBranch size={14} className="text-muted-foreground" />
              {worktree?.branch ?? 'Worktree diff'}
              {worktree?.files_changed ? (
                <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-warning">
                  {worktree.files_changed} file{worktree.files_changed !== 1 ? 's' : ''} changed
                </span>
              ) : null}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            {!diffData ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">Loading diff…</div>
            ) : !diffData.diff ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">No uncommitted changes</div>
            ) : (
              <WorktreeDiff diff={diffData.diff} />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ContextPanel
        open={ctxOpen}
        onClose={() => { setCtxOpen(false); localStorage.setItem('ctx_panel', 'closed'); }}
        pinnedSpace={pinnedProject}
        linkedSpaces={linkedProjects}
        worktree={worktree ? { branch: worktree.branch, commits_ahead: worktree.ahead } : null}
        pendingApproval={pendingApproval ? {
          executionId: pendingApproval.executionId,
          approvalId: pendingApproval.approvalId ?? '',
          action: pendingApproval.action ?? 'Tool execution',
        } : null}
        onApprove={handleApprove}
        onDeny={handleDeny}
        onMerge={() => mergeMutation.mutate()}
        mergeState={mergeState}
      />
    </div>
  );
}
