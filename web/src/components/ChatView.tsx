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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import ContextPanel from './ContextPanel.js';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import EditableTitle from './EditableTitle.js';
import WorktreeDiff from './WorktreeDiff.js';
import ContextBar from './ContextBar.js';
import EmptyChatState from './EmptyChatState.js';
import ScopePopover from './ScopePopover.js';
import { getMessages, sendMessage, getChats, updateChatConfig, getSessionWorktree, mergeSessionBranch, getWorktreeDiff, getProjects, truncateMessagesFrom, approveExecution, rejectExecution, getChatEvents, getChatStatus, getChatUsageRisk, resetChatProviderSession, stopChat, getPendingApprovals } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '../lib/utils.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { getAgentStatusText } from '../lib/chatStatus.js';
import type { EffortLevel, Message, MessageExecution, Session, SessionEvent, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved, WSSessionTitleUpdated, WSSessionEventCreated, WSAgentError, WSTurnComplete } from '../types.js';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

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

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: () => getChats(),
  });
  const chat = chats.find(s => s.id === chatId);
  const effort = chat?.effort ?? 'medium';

  usePageTitle(chat?.title);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
    staleTime: 60_000,
  });
  const pinnedProject = projects.find(p => p.id === chat?.pinned_project_id) ?? null;

  const configMutation = useMutation({
    mutationFn: (config: { effort?: EffortLevel; pinned_project_id?: string | null; title?: string }) => updateChatConfig(chatId, config),
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
    riskWarnedRef.current = false;
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

  // Hydrate pending approvals that belong to this chat session but have no message
  // (e.g. browser_restart_chrome runs outside any message context)
  const pendingApprovalsFetched = useRef(false);
  useEffect(() => {
    if (pendingApprovalsFetched.current) return;
    pendingApprovalsFetched.current = true;
    getPendingApprovals().then(approvals => {
      const relevant = approvals.filter(a => {
        const sessionId = a.session_id ?? (typeof a.payload?.session_id === 'string' ? a.payload.session_id : null);
        return sessionId === chatId;
      });
      if (!relevant.length) return;
      setExecutions(prev => {
        const orphans = [...(prev.__orphan__ ?? [])];
        for (const a of relevant) {
          if (orphans.some(e => e.executionId === a.execution_id)) continue;
          orphans.push({
            executionId: a.execution_id,
            tool: a.tool ?? 'browser_restart_chrome',
            status: 'awaiting_approval',
            outputLog: '',
            result: null,
            createdAt: a.created_at ?? Math.floor(Date.now() / 1000),
            needsApproval: true,
            approvalId: a.approval_id,
            action: a.action,
            payload: a.payload,
          });
        }
        return { ...prev, __orphan__: orphans };
      });
    }).catch(() => { /* non-fatal */ });
  }, [chatId]);

  const draftKey = `draft:${chatId}`;
  const [inputValue, setInputValue] = useState(() => localStorage.getItem(draftKey) ?? '');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [failedMessageId, setFailedMessageId] = useState<string | null>(null);
  const [pendingRiskSend, setPendingRiskSend] = useState<{ content: string; attachments: File[]; costUsd: number; messageCount: number } | null>(null);
  const riskWarnedRef = useRef(false);
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

  async function handleApprove(executionId: string) {
    await approveExecution(executionId);
  }
  async function handleDeny(executionId: string) {
    await rejectExecution(executionId);
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

  const sendPrompt = useCallback(async (overrideContent?: string, attachments: File[] = [], opts: { skipRiskCheck?: boolean } = {}): Promise<boolean> => {
    const content = (overrideContent ?? inputValue).trim();
    if (!content && attachments.length === 0) return false;

    if (!opts.skipRiskCheck && !riskWarnedRef.current && !editingMessageId && messages.length > 0) {
      try {
        const risk = await getChatUsageRisk(chatId);
        if (risk.shouldWarn) {
          setPendingRiskSend({
            content,
            attachments,
            costUsd: risk.attributedCostUsd,
            messageCount: risk.messageCount,
          });
          return false;
        }
      } catch {
        // Risk checks should not block chat if the endpoint is unavailable.
      }
    }

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
  }, [inputValue, editingMessageId, messages.length, chatId, queryClient, mutation]);

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
      // approval_requested with null sessionId may still belong to this chat (tool ran without
      // a message context); don't drop it — the handler below will decide what to do with it.
      if (eventSessionId !== null && eventSessionId !== chatId) return;
      if (eventSessionId === null && event.type !== 'approval_requested') return;
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
      if (ev.status === 'done' && ev.inputTokens != null) setLastInputTokens(ev.inputTokens);
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
        // Update to existing execution (including orphans with no messageId)
        setExecutions(prev => {
          const msgId = execToMsgRef.current[ev.executionId] ?? (prev.__orphan__?.some(e => e.executionId === ev.executionId) ? '__orphan__' : null);
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
        for (const [msgId, list] of Object.entries(prev)) {
          const existing = list.find(e => e.executionId === ev.executionId);
          if (existing) {
            const updated = { ...existing, status: 'awaiting_approval' as const, needsApproval: true, approvalId: ev.approvalId, action: ev.action, payload: ev.payload };
            return { ...prev, [msgId]: list.map(e => e.executionId === ev.executionId ? updated : e) };
          }
        }
        // Execution has no message (e.g. browser_restart_chrome) — park under __orphan__
        // so pendingApproval is detected and the approval banner shows in this chat.
        const orphanEntry: InlineExecution = {
          executionId: ev.executionId,
          tool: 'browser_restart_chrome',
          status: 'awaiting_approval',
          outputLog: '',
          result: null,
          createdAt: Math.floor(Date.now() / 1000),
          needsApproval: true,
          approvalId: ev.approvalId,
          action: ev.action,
          payload: ev.payload,
        };
        return { ...prev, __orphan__: [...(prev.__orphan__ ?? []).filter(e => e.executionId !== ev.executionId), orphanEntry] };
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
        queryClient.setQueryData<{ events: SessionEvent[] }>(['chat-events', chatId], prev => {
          if (!prev) return { events: [ev.event] };
          if (prev.events.some(e => e.id === ev.event.id)) return prev;
          return { events: [...prev.events, ev.event] };
        });
        queryClient.invalidateQueries({ queryKey: ['chat-events', chatId] });
        if (ev.event.type === 'document_created' || ev.event.type === 'document_updated') {
          queryClient.invalidateQueries({ queryKey: ['documents'] });
        }
        if (ev.event.type === 'project_created') {
          queryClient.invalidateQueries({ queryKey: ['projects'] });
        }
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
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-soft px-4 sm:px-5">
        {/* Title + settings dropdown */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          <EditableTitle title={chat?.title ?? 'Untitled chat'} onSave={(t) => configMutation.mutate({ title: t })} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Chat settings"
                className="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronDown size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <ScopePopover
                projects={projects}
                pinnedProject={pinnedProject}
                agentActive={agentActive}
                onScopeChange={(projectId) => configMutation.mutate({ pinned_project_id: projectId })}
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

        {/* Right-side actions */}
        <div className="flex shrink-0 items-center gap-2">
          {pinnedProject && (
            <span className="hidden items-center gap-1.5 rounded-full border border-border-soft bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground sm:flex">
              <span className="size-1.5 rounded-full bg-primary/50" />
              {pinnedProject.name}
            </span>
          )}
          {lastInputTokens !== null && <ContextBar inputTokens={lastInputTokens} />}
          {(pinnedProject || worktree || pendingApproval) && (
            <button
              type="button"
              onClick={toggleCtx}
              aria-pressed={ctxOpen}
              title={ctxOpen ? 'Hide context' : 'Show context'}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                ctxOpen
                  ? 'border-transparent bg-accent-tint text-on-accent-soft'
                  : 'border-border-soft bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <PanelRight size={13} strokeWidth={1.75} />
              <span className="hidden sm:inline">Context</span>
              {!ctxOpen && pendingApproval && (
                <span className="size-1.5 rounded-full bg-warning" />
              )}
            </button>
          )}
        </div>
      </header>

      {messages.length === 0 ? (
        <EmptyChatState
          value={inputValue}
          onChange={(v) => { setInputValue(v); if (v) localStorage.setItem(draftKey, v); else localStorage.removeItem(draftKey); }}
          onSend={(content, attachments) => sendPrompt(content, attachments)}
          disabled={agentActive}
          pendingFiles={dropFiles}
          onPendingFilesConsumed={() => setDropFiles([])}
          projectName={pinnedProject?.name}
          projects={pinnedProject ? [] : projects}
          onPinProject={(projectId) => configMutation.mutate({ pinned_project_id: projectId })}
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
          agentThinking={agentStarting || sending}
          onRetryFailedMessage={() => {
            const lastUserContent = [...messages].reverse().find(m => m.role === 'user')?.content ?? null;
            if (lastUserContent) sendPrompt(lastUserContent);
          }}
        />
      )}

      {messages.length > 0 && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="pointer-events-auto relative flex flex-col">

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

      {pendingRiskSend && (
        <Dialog open onOpenChange={open => { if (!open) setPendingRiskSend(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Large chat context</DialogTitle>
              <DialogDescription>
                This chat has {pendingRiskSend.messageCount} messages and about ${pendingRiskSend.costUsd.toFixed(2)} attributed usage. Starting fresh keeps the visible chat but drops hidden provider context for this next turn.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  const pending = pendingRiskSend;
                  setPendingRiskSend(null);
                  riskWarnedRef.current = true;
                  sendPrompt(pending.content, pending.attachments, { skipRiskCheck: true });
                }}
              >
                Resume anyway
              </Button>
              <Button
                onClick={async () => {
                  const pending = pendingRiskSend;
                  setPendingRiskSend(null);
                  riskWarnedRef.current = true;
                  await resetChatProviderSession(chatId);
                  sendPrompt(pending.content, pending.attachments, { skipRiskCheck: true });
                }}
              >
                Start fresh
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <ContextPanel
        open={ctxOpen}
        onClose={() => { setCtxOpen(false); localStorage.setItem('ctx_panel', 'closed'); }}
        pinnedProject={pinnedProject}
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
