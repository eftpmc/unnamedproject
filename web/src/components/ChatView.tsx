import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, ChevronDown, Folder, GitBranch, Loader2, PanelRight, Square, Target, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import ContextPanel from './ContextPanel.js';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import { getMessages, sendMessage, getChats, updateChatConfig, getModelsForEffort, getSessionWorktree, mergeSessionBranch, getWorktreeDiff, getProjects, truncateMessagesFrom, approveExecution, rejectExecution, getChatEvents, getChatStatus, stopChat } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '../lib/utils.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import type { EffortLevel, Message, MessageExecution, Project, Session, SessionEvent, SessionProjectLink, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved, WSSessionTitleUpdated, WSSessionEventCreated, WSAgentError, WSTurnComplete, ClaudeModelInfo } from '../types.js';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
    queryKey: ['projects'],
    queryFn: getProjects,
  });
  const pinnedProject = projects.find(p => p.id === chat?.pinned_project_id) ?? null;
  const inferredProject = !pinnedProject ? linkedProjects[linkedProjects.length - 1] ?? null : null;
  const contextProject = pinnedProject ?? inferredProject;

  const configMutation = useMutation({
    mutationFn: (config: { effort?: EffortLevel; model?: string | null; pinned_project_id?: string | null; title?: string }) => updateChatConfig(chatId, config),
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
      if (ev.status === 'error') queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
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
          projectName: ev.projectName,
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
        queryClient.setQueryData<{ events: SessionEvent[]; projects: SessionProjectLink[] }>(['chat-events', chatId], prev => {
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
      <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title={<EditableTitle title={chat?.title ?? 'Untitled chat'} onSave={(t) => configMutation.mutate({ title: t })} />}
        className="border-b border-border-soft px-5 py-4"
        description={
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
            <ScopePopover
              projects={projects}
              pinnedProject={pinnedProject}
              inferredProject={inferredProject}
              agentActive={agentActive}
              onOpenProject={(projectId) => navigate(`/projects/${projectId}`)}
              onScopeChange={(projectId) => configMutation.mutate({ pinned_project_id: projectId })}
            />
            {worktree && (
              <button
                type="button"
                onClick={() => setDiffOpen(true)}
                title={worktree.files_changed > 0 ? `${worktree.files_changed} uncommitted file${worktree.files_changed !== 1 ? 's' : ''} — click to view diff` : worktree.branch}
                className="flex items-center gap-1 rounded-md border border-border-soft bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-muted"
              >
                <GitBranch size={10} className="shrink-0" />
                {worktree.branch}
                {worktree.files_changed > 0 && (
                  <span className="text-warning">·{worktree.files_changed}</span>
                )}
              </button>
            )}
          </div>
            {lastInputTokens !== null && (
              <ContextBar inputTokens={lastInputTokens} />
            )}
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <ChatConfigPopover
              effort={effort}
              model={chat?.model ?? null}
              models={models}
              onConfigChange={(config) => configMutation.mutate(config)}
            />
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
          projectName={pinnedProject?.name}
          disabled={agentActive}
          onSelect={(content) => sendPrompt(content)}
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
        />
      )}

      {agentError && (() => {
        const lastUserContent = [...messages].reverse().find(m => m.role === 'user')?.content ?? null;
        return (
          <div className="shrink-0 flex items-center justify-between gap-3 border-t border-destructive/20 bg-destructive/5 px-5 py-2.5 text-xs text-destructive">
            <span className="flex-1 min-w-0 truncate">{agentError}</span>
            <div className="flex items-center gap-2 shrink-0">
              {lastUserContent && (
                <button
                  type="button"
                  onClick={() => { setAgentError(null); sendPrompt(lastUserContent); }}
                  className="font-medium text-destructive/70 hover:text-destructive transition-colors"
                >
                  Retry
                </button>
              )}
              <button type="button" onClick={() => setAgentError(null)} className="text-destructive/60 hover:text-destructive" aria-label="Dismiss error">
                <X size={14} />
              </button>
            </div>
          </div>
        );
      })()}

      {pendingApproval && !ctxOpen && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-warning/25 bg-warning/8 px-5 py-2.5 text-sm md:hidden">
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
      )}

      {agentActive && !pendingApproval && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border-soft bg-muted/35 px-5 py-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          <span className="flex-1">{agentStatusText}</span>
          <button
            type="button"
            onClick={() => stopChat(chatId).catch(() => {})}
            title="Stop agent"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Square size={11} className="fill-current" />
            Stop
          </button>
        </div>
      )}

      <MessageInput
        value={inputValue}
        onChange={(v) => { setInputValue(v); if (v) localStorage.setItem(draftKey, v); else localStorage.removeItem(draftKey); }}
        onSend={(attachments) => sendPrompt(undefined, attachments)}
        disabled={agentActive}
        isEditing={!!editingMessageId}
        onCancelEdit={() => { setEditingMessageId(null); setInputValue(''); }}
        pendingFiles={dropFiles}
        onPendingFilesConsumed={() => setDropFiles([])}
      />
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
        project={contextProject}
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

function getAgentStatusText({
  sending,
  agentStarting,
  chatStatus,
  now,
}: {
  sending: boolean;
  agentStarting: boolean;
  chatStatus: Awaited<ReturnType<typeof getChatStatus>> | undefined;
  now: number;
}): string {
  if (sending) return 'Sending message...';
  const elapsedFrom = chatStatus?.execution?.createdAt ?? chatStatus?.turn?.startedAt ?? null;
  const elapsed = elapsedFrom ? ` for ${formatElapsedSeconds(now - elapsedFrom)}` : '';
  if (chatStatus?.execution) {
    const tool = formatToolName(chatStatus.execution.tool);
    if (chatStatus.execution.status === 'awaiting_approval') return `${tool} is waiting for approval${elapsed}`;
    return `Running ${tool}${elapsed}`;
  }
  if (agentStarting) return `Agent is getting started${elapsed}`;
  return `Agent is working${elapsed}`;
}

function formatElapsedSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatToolName(tool: string): string {
  return tool
    .replace(/^invoke_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function EditableTitle({ title, onSave }: { title: string; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onSave(trimmed);
    else setDraft(title);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(title); setEditing(false); } }}
        className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-foreground outline-none focus:underline focus:decoration-border"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(title); setEditing(true); }}
      title="Click to rename"
      className="min-w-0 truncate text-left text-[15px] font-semibold text-foreground hover:underline hover:decoration-border"
    >
      {title}
    </button>
  );
}

function WorktreeDiff({ diff }: { diff: string }) {
  const files = diff.split(/^(?=diff --git )/m).filter(Boolean);
  return (
    <div className="divide-y divide-border-soft">
      {files.map((fileDiff, i) => {
        const header = fileDiff.split('\n')[0] ?? '';
        const filename = header.replace('diff --git a/', '').split(' b/')[0] ?? header;
        const lines = fileDiff.split('\n');
        return (
          <details key={i} open className="group">
            <summary className="flex cursor-pointer items-center gap-2 bg-muted/30 px-4 py-2.5 text-xs font-mono font-medium text-foreground hover:bg-muted/50 list-none">
              <span className="min-w-0 flex-1 truncate">{filename}</span>
            </summary>
            <div className="overflow-x-auto bg-[#0d1117] font-mono text-[12px] leading-relaxed">
              {lines.slice(4).map((line, j) => {
                let cls = 'block px-4 text-muted-foreground/60';
                if (line.startsWith('+') && !line.startsWith('+++')) cls = 'block px-4 bg-success/10 text-success';
                else if (line.startsWith('-') && !line.startsWith('---')) cls = 'block px-4 bg-destructive/10 text-destructive';
                else if (line.startsWith('@@')) cls = 'block px-4 text-primary/60 bg-primary/5';
                return <span key={j} className={cls}>{line || ' '}</span>;
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

const CONTEXT_WINDOW = 200_000;

function ContextBar({ inputTokens }: { inputTokens: number }) {
  const pct = Math.min(inputTokens / CONTEXT_WINDOW, 1);
  const used = pct * 100;
  const color = pct > 0.85 ? 'bg-destructive' : pct > 0.6 ? 'bg-warning' : 'bg-primary/50';
  const label = `${Math.round(used)}% of context used · ${inputTokens.toLocaleString()} / ${CONTEXT_WINDOW.toLocaleString()} tokens`;

  return (
    <div title={label} className="flex items-center gap-2 group/ctx cursor-default">
      <div className="h-1 w-28 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${used}%` }} />
      </div>
      <span className="text-[10px] text-faint-fg opacity-0 transition-opacity group-hover/ctx:opacity-100">
        {Math.round(used)}% context
      </span>
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
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {prompts.map(prompt => (
            <Button
              key={prompt}
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onSelect(prompt)}
              className="h-auto whitespace-normal justify-start rounded-xl px-3 py-2 text-left text-xs font-normal"
            >
              {prompt}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScopePopover({
  projects,
  pinnedProject,
  inferredProject,
  agentActive,
  onOpenProject,
  onScopeChange,
}: {
  projects: Project[];
  pinnedProject: Project | null;
  inferredProject: SessionProjectLink | null;
  agentActive: boolean;
  onOpenProject: (projectId: string) => void;
  onScopeChange: (projectId: string | null) => void;
}) {
  const isAuto = !pinnedProject;
  const triggerLabel = pinnedProject?.name ?? (inferredProject ? `Auto · ${inferredProject.name}` : 'Auto');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-1 flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-border/40 bg-muted/50 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
          aria-label={`Chat scope: ${triggerLabel}`}
        >
          {isAuto ? (
            <Target size={12} className="shrink-0" strokeWidth={1.85} />
          ) : (
            <span className={cn('size-1.5 shrink-0 rounded-full', agentActive ? 'bg-success' : 'bg-muted-foreground/40')} />
          )}
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown size={11} className="shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-faint-fg">
          Scope of this chat
        </div>
        <ScopeOption
          selected={isAuto}
          icon={<Target size={14} />}
          title="Auto"
          description={inferredProject ? `Agent attached ${inferredProject.name}.` : 'Let the agent route this work or create a project.'}
          onClick={() => onScopeChange(null)}
        />
        <div className="my-1 border-t border-border-soft" />
        <div className="max-h-60 overflow-y-auto">
          {projects.map(project => (
            <ScopeOption
              key={project.id}
              selected={pinnedProject?.id === project.id}
              icon={<Folder size={14} />}
              title={project.name}
              description={project.repo_path ? project.repo_path.split('/').pop() ?? 'Code project' : 'Project context'}
              onClick={() => onScopeChange(project.id)}
              onAuxClick={() => onOpenProject(project.id)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ScopeOption({
  selected,
  icon,
  title,
  description,
  onClick,
  onAuxClick,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  onAuxClick?: () => void;
}) {
  return (
    <div className="group flex items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
          selected ? 'bg-accent-tint text-on-accent-soft' : 'hover:bg-muted',
        )}
      >
        <span className={cn('grid size-7 shrink-0 place-items-center rounded-md', selected ? 'bg-primary/10' : 'bg-muted text-muted-foreground')}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
        </span>
        {selected && <Check size={13} className="shrink-0" strokeWidth={2.4} />}
      </button>
      {onAuxClick && (
        <button
          type="button"
          onClick={onAuxClick}
          className="hidden shrink-0 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground group-hover:block"
        >
          Open
        </button>
      )}
    </div>
  );
}

function ChatConfigPopover({
  effort,
  model,
  models,
  onConfigChange,
}: {
  effort: EffortLevel;
  model: string | null;
  models: ClaudeModelInfo[];
  onConfigChange: (config: { effort?: EffortLevel; model?: string | null }) => void;
}) {
  const currentModel = models.find(m => m.id === model);
  const label = `${effort} · ${currentModel?.display_name ?? 'Auto'}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex h-7 max-w-28 gap-1.5 rounded-lg border border-border/50 bg-muted/70 px-3 text-xs font-normal sm:max-w-none"
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-3">
        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Effort</div>
            <div className="flex gap-1">
              {(['low', 'medium', 'high'] as EffortLevel[]).map(o => (
                <Button
                  key={o}
                  size="sm"
                  variant={effort === o ? 'default' : 'ghost'}
                  className="h-7 flex-1 text-xs"
                  onClick={() => onConfigChange({ effort: o })}
                >
                  {o}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Model</div>
            <Select
              value={model ?? 'auto'}
              onValueChange={value => onConfigChange({ model: value === 'auto' ? null : value })}
            >
              <SelectTrigger size="sm" className="h-7 text-xs">
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
