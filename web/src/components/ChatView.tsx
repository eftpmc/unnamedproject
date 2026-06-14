import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, PanelRight, X } from 'lucide-react';
import ContextPanel from './ContextPanel.js';
import MessageList from './MessageList.js';
import MessageInput from './MessageInput.js';
import { getMessages, sendMessage, getChats, updateChatConfig, getModelsForEffort, getSessionWorktree, mergeSessionBranch, getProjects, truncateMessagesFrom, approveExecution, rejectExecution } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '../lib/utils.js';
import type { EffortLevel, Message, MessageExecution, Session, WSEvent, WSMessageCreated, WSMessageStarted, WSMessageDelta, WSExecutionUpdate, WSApprovalRequested, WSAutoApproved, WSSessionTitleUpdated, WSAgentError, ClaudeModelInfo } from '../types.js';
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

  const [inputValue, setInputValue] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const agentActive = sending || streamingIds.size > 0 || Object.values(executions).some(list =>
    list.some(exec => exec.status === 'running' || exec.status === 'awaiting_approval')
  );

  const pendingApproval = Object.values(executions).flat().find(
    e => e.status === 'awaiting_approval' && e.needsApproval
  ) ?? null;

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
    mutationFn: (content: string) => sendMessage(chatId, content),
    onMutate: () => setSending(true),
    onSettled: () => setSending(false),
    onSuccess: (newMsg) => {
      queryClient.setQueryData<Message[]>(['messages', chatId], prev =>
        prev ? [...prev, newMsg] : [newMsg]
      );
    },
  });

  const handleEditMessage = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setInputValue(content);
  }, []);

  const sendPrompt = useCallback(async (overrideContent?: string) => {
    const content = (overrideContent ?? inputValue).trim();
    if (!content) return;
    setAgentError(null);
    setInputValue('');

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

    mutation.mutate(content);
  }, [inputValue, editingMessageId, chatId, queryClient, mutation]);

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
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title={chat?.title ?? 'Untitled chat'}
        description={pinnedProject ? (
          <button
            onClick={() => navigate(`/projects/${pinnedProject.id}`)}
            className="flex w-fit max-w-full items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
            title={`Open ${pinnedProject.name}`}
          >
            <span className={cn(
              'size-1.5 shrink-0 rounded-full',
              agentActive ? 'bg-success' : 'bg-muted-foreground/40',
            )} />
            <span className="truncate">{pinnedProject.name}</span>
          </button>
        ) : undefined}
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
        />
      )}

      {agentError && (
        <div className="shrink-0 flex items-center justify-between gap-3 border-t border-destructive/20 bg-destructive/5 px-5 py-2.5 text-xs text-destructive">
          <span>{agentError}</span>
          <button onClick={() => setAgentError(null)} className="shrink-0 text-destructive/60 hover:text-destructive" aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {pendingApproval && !ctxOpen && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-warning/25 bg-warning/8 px-5 py-2.5 text-sm">
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

      <MessageInput
        value={inputValue}
        onChange={setInputValue}
        onSend={sendPrompt}
        disabled={agentActive}
      />
      </div>
      <ContextPanel
        open={ctxOpen}
        onClose={() => { setCtxOpen(false); localStorage.setItem('ctx_panel', 'closed'); }}
        project={pinnedProject}
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
          className="h-7 max-w-36 gap-1.5 rounded-lg border border-border/50 bg-muted/70 px-3 text-xs font-normal sm:max-w-none"
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
