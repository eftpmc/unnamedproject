import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Clipboard, Loader2, MoreHorizontal, Play, Plus, Trash2, X } from 'lucide-react';
import { getAllTriggers, updateGlobalTrigger, deleteGlobalTrigger, runTriggerNow, createGlobalTrigger, getAllFiles, getProjects } from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { timeAgo } from '../lib/utils.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CenteredEmptyState, ContentColumn, PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import { DataTable, DataTableBody, DataTableHeader, DataTableRow } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { LibraryFile, Project, Trigger } from '../types.js';

export default function TriggersPage() {
  usePageTitle('Triggers');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Trigger | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  // New trigger dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newKind, setNewKind] = useState<Trigger['kind']>('manual');
  const [newCron, setNewCron] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [newPlaybookId, setNewPlaybookId] = useState('');

  // Set playbook dialog
  const [playbookTarget, setPlaybookTarget] = useState<Trigger | null>(null);
  const [playbookValue, setPlaybookValue] = useState('');

  const { data: triggers = [], isLoading } = useQuery<Trigger[]>({
    queryKey: ['triggers-global'],
    queryFn: getAllTriggers,
  });

  const { data: documents = [] } = useQuery<LibraryFile[]>({
    queryKey: ['library-files'],
    queryFn: () => getAllFiles(),
    staleTime: 60_000,
  });

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
    staleTime: 60_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateGlobalTrigger(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['triggers-global'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGlobalTrigger(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['triggers-global'] }); setPendingDelete(null); },
    onError: () => setPendingDelete(null),
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => runTriggerNow(id),
    onMutate: (id) => setRunningId(id),
    onSuccess: (result) => {
      setRunningId(null);
      qc.invalidateQueries({ queryKey: ['triggers-global'] });
      qc.invalidateQueries({ queryKey: ['chats'] });
      navigate(`/c/${result.sessionId}`);
    },
    onError: () => setRunningId(null),
  });

  const createMutation = useMutation({
    mutationFn: () => createGlobalTrigger({
      kind: newKind,
      schedule_cron: newKind === 'schedule' && newCron.trim() ? newCron.trim() : undefined,
      project_id: newProjectId || undefined,
      playbook_id: newPlaybookId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['triggers-global'] });
      setCreateOpen(false);
      resetCreateForm();
    },
  });

  const setPlaybookMutation = useMutation({
    mutationFn: ({ id, playbook_id }: { id: string; playbook_id: string | null }) =>
      updateGlobalTrigger(id, { playbook_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['triggers-global'] });
      setPlaybookTarget(null);
    },
  });

  function resetCreateForm() {
    setNewKind('manual');
    setNewCron('');
    setNewProjectId(projects[0]?.id ?? '');
    setNewPlaybookId('');
  }

  function openCreateDialog() {
    resetCreateForm();
    setCreateOpen(true);
  }

  function openSetPlaybook(trigger: Trigger) {
    setPlaybookTarget(trigger);
    setPlaybookValue(trigger.playbook_id ?? '');
  }

  const docMap = new Map(documents.map(d => [d.id, d]));

  return (
    <PageShell>
      <PageHeader
        title="Triggers"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
        actions={
          <Button
            size="lg"
            className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm"
            onClick={openCreateDialog}
            disabled={projects.length === 0}
            title={projects.length === 0 ? 'Create a project first' : 'New trigger'}
          >
            <Plus size={16} />New trigger
          </Button>
        }
      />

      {isLoading ? <PageLoading rows={3} /> : triggers.length === 0 ? (
        <CenteredEmptyState title="No triggers yet" description="Triggers run playbooks automatically on a schedule or on demand." />
      ) : (
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <ContentColumn className="max-w-7xl">
            <DataTable>
              <DataTableHeader className="grid-cols-[minmax(0,1fr)_7rem_4rem_1.75rem_1.75rem] sm:grid-cols-[minmax(0,1fr)_14rem_4rem_5rem_1.75rem_1.75rem]">
                <span>Trigger</span>
                <span className="hidden sm:block">Schedule / Playbook</span>
                <span className="justify-self-end">Enabled</span>
                <span className="hidden justify-self-end sm:block">Last run</span>
                <span />
                <span />
              </DataTableHeader>
              <DataTableBody>
                {triggers.map(t => {
                  const enabled = !!t.enabled;
                  const playbook = t.playbook_id ? docMap.get(t.playbook_id) : undefined;
                  return (
                    <DataTableRow key={t.id} className="grid-cols-[minmax(0,1fr)_7rem_4rem_1.75rem_1.75rem] sm:grid-cols-[minmax(0,1fr)_14rem_4rem_5rem_1.75rem_1.75rem]">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium capitalize text-foreground">{t.kind}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-faint-fg sm:hidden">
                          {t.kind === 'webhook'
                            ? `/webhooks/trigger/${t.id}`
                            : t.schedule_cron ?? (playbook ? playbook.title : 'No playbook')}
                        </div>
                      </div>
                      <div className="hidden min-w-0 flex-col justify-center gap-0.5 sm:flex">
                        {t.kind === 'webhook' && (
                          <span className="truncate font-mono text-xs text-muted-foreground">/webhooks/trigger/{t.id}</span>
                        )}
                        {t.schedule_cron && (
                          <span className="truncate font-mono text-xs text-muted-foreground">{t.schedule_cron}</span>
                        )}
                        {playbook ? (
                          <Link
                            to={`/library/${playbook.id}`}
                            className="flex items-center gap-1 truncate text-[11px] text-primary hover:underline"
                          >
                            <BookOpen size={10} className="shrink-0" />
                            {playbook.title}
                          </Link>
                        ) : (
                          <span className="text-[11px] text-faint-fg">No playbook</span>
                        )}
                      </div>
                      <div className="justify-self-end">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          disabled={toggleMutation.isPending}
                          onClick={() => toggleMutation.mutate({ id: t.id, enabled: !enabled })}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:opacity-50 ${enabled ? 'bg-primary' : 'bg-muted'}`}
                        >
                          <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                      <span className="hidden justify-self-end whitespace-nowrap text-[11px] text-faint-fg sm:block">
                        {t.last_run_at ? timeAgo(t.last_run_at) : 'Never'}
                      </span>
                      <button
                        type="button"
                        title="Run now"
                        aria-label="Run now"
                        disabled={runningId !== null}
                        onClick={() => runMutation.mutate(t.id)}
                        className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-40"
                      >
                        {runningId === t.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Play size={13} />}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={`Options for ${t.kind} trigger`}
                            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onSelect={() => runMutation.mutate(t.id)}
                            disabled={runningId !== null}
                          >
                            <Play size={14} />
                            {runningId === t.id ? 'Running…' : 'Run now'}
                          </DropdownMenuItem>
                          {t.kind === 'webhook' && (
                            <DropdownMenuItem
                              onSelect={() => void navigator.clipboard?.writeText(`${window.location.origin}/webhooks/trigger/${t.id}`)}
                            >
                              <Clipboard size={14} />
                              Copy webhook URL
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => openSetPlaybook(t)}>
                            <BookOpen size={14} />
                            Set playbook
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(t)}>
                            <Trash2 size={14} />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </DataTableRow>
                  );
                })}
              </DataTableBody>
            </DataTable>
          </ContentColumn>
        </PageBody>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete trigger?"
          description="This will permanently remove the trigger. Any scheduled runs will stop."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* New trigger dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New trigger</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Kind</span>
              <select
                value={newKind}
                onChange={e => setNewKind(e.target.value as Trigger['kind'])}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="manual">Manual — run on demand</option>
                <option value="schedule">Schedule — run on cron</option>
                <option value="webhook">Webhook — run on HTTP call</option>
              </select>
            </label>
            {newKind === 'schedule' && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Cron expression</span>
                <Input
                  value={newCron}
                  onChange={e => setNewCron(e.target.value)}
                  placeholder="0 9 * * 1-5  (weekdays at 9am)"
                  className="font-mono text-xs"
                />
              </label>
            )}
            {projects.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Project</span>
                <select
                  value={newProjectId}
                  onChange={e => setNewProjectId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Playbook <span className="font-normal text-faint-fg">(optional)</span></span>
              <select
                value={newPlaybookId}
                onChange={e => setNewPlaybookId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">None</option>
                {documents.map(d => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !newProjectId || (newKind === 'schedule' && !newCron.trim())}
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set playbook dialog */}
      <Dialog open={!!playbookTarget} onOpenChange={open => { if (!open) setPlaybookTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set playbook</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-xs text-muted-foreground">
              The playbook document is used as the agent's instructions when this trigger fires.
            </p>
            <select
              value={playbookValue}
              onChange={e => setPlaybookValue(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">None</option>
              {documents.map(d => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </select>
            {playbookValue && (
              <button
                type="button"
                onClick={() => setPlaybookValue('')}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X size={11} />Clear playbook
              </button>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPlaybookTarget(null)} disabled={setPlaybookMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => playbookTarget && setPlaybookMutation.mutate({
                id: playbookTarget.id,
                playbook_id: playbookValue || null,
              })}
              disabled={setPlaybookMutation.isPending}
            >
              {setPlaybookMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
