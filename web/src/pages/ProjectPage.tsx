import type React from 'react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, GitBranch } from 'lucide-react';
import {
  getProject, updateProject, deleteTopLevelProject,
  getConnections, updateSpace, getSpaces,
} from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageBody, PageHeader, PageLoading, PageShell } from '@/components/ui/app-layout';
import FileBrowser from '../components/FileBrowser.js';
import type { Connection, Project } from '../types.js';

type SubRoute = 'overview' | 'files';

function subRoute(pathname: string, projectId: string): SubRoute {
  const suffix = pathname.slice(`/projects/${projectId}`.length).split('/').filter(Boolean)[0];
  if (suffix === 'files') return 'files';
  return 'overview';
}

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const view = subRoute(location.pathname, projectId!);

  const { data: project, isLoading } = useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });

  usePageTitle(project?.name);

  if (isLoading) return <PageShell><PageLoading rows={4} /></PageShell>;
  if (!project) return <PageShell><PageHeader title="Project not found" /></PageShell>;

  if (view === 'files') {
    return (
      <PageShell>
        <PageHeader
          title={project.name}
          breadcrumb="Files"
          className="px-4 pt-6 sm:px-8 sm:pt-10"
          contentClassName="max-w-7xl"
          titleClassName="text-2xl sm:text-3xl"
        />
        <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
          <div className="mx-auto max-w-7xl">
            <FileBrowser spaceId={project.space_id} projectId={project.id} projectName={project.name} />
          </div>
        </PageBody>
      </PageShell>
    );
  }

  // Overview (default)
  return (
    <ProjectOverview project={project} navigate={navigate} />
  );
}

function ProjectOverview({ project, navigate }: { project: Project; navigate: ReturnType<typeof useNavigate> }) {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editBranch, setEditBranch] = useState(project.default_branch ?? '');
  const [settingsEditing, setSettingsEditing] = useState(false);

  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const mcpConnections = connections.filter(c => c.type === 'mcp');

  // Load space to read enabled_connection_ids
  const { data: spaces = [] } = useQuery({
    queryKey: ['spaces'],
    queryFn: getSpaces,
    staleTime: 60_000,
  });
  const space = (spaces as { id: string; enabled_connection_ids: string[] }[]).find(s => s.id === project.space_id);

  const updateMutation = useMutation({
    mutationFn: () => updateProject(project.id, {
      name: editName.trim() || project.name,
      default_branch: editBranch.trim() || null,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTopLevelProject(project.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['projects'] }); navigate('/projects'); },
  });

  function toggleMcp(connectionId: string) {
    if (!space) return;
    const current = space.enabled_connection_ids ?? [];
    const updated = current.includes(connectionId) ? current.filter(id => id !== connectionId) : [...current, connectionId];
    updateSpace(project.space_id, { enabled_connection_ids: updated }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['spaces'] }),
    );
  }

  useEffect(() => {
    setEditName(project.name);
    setEditBranch(project.default_branch ?? '');
    setSettingsEditing(false);
  }, [project.id, project.name, project.default_branch]);

  return (
    <PageShell>
      <PageHeader
        title={project.name}
        breadcrumb="Overview"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-7xl"
        titleClassName="text-2xl sm:text-3xl"
      />
      <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
        <div className="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
          <div className="min-w-0 space-y-5">
            <ProjectSummaryPanel project={project} />
          </div>

          <aside className="min-w-0 space-y-5 pt-1">
            <ProjectSettingsPanel
              project={project}
              editing={settingsEditing}
              editName={editName}
              editBranch={editBranch}
              saving={updateMutation.isPending}
              onNameChange={setEditName}
              onBranchChange={setEditBranch}
              onEdit={() => setSettingsEditing(true)}
              onCancel={() => {
                setEditName(project.name);
                setEditBranch(project.default_branch ?? '');
                setSettingsEditing(false);
              }}
              onSave={() => updateMutation.mutate(undefined, { onSuccess: () => setSettingsEditing(false) })}
            />

            {mcpConnections.length > 0 && (
              <McpToolsPanel
                connections={mcpConnections}
                enabledIds={space?.enabled_connection_ids ?? []}
                onToggle={toggleMcp}
              />
            )}

            <DangerPanel onDelete={() => setConfirmDelete(true)} />
          </aside>
        </div>
      </PageBody>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${project.name}?`}
          description="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </PageShell>
  );
}

function ProjectSummaryPanel({ project }: { project: Project }) {
  return (
    <section className="rounded-lg border border-border-soft bg-card">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border-soft px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">Repository</h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {project.repo_path || 'No repository linked'}
          </p>
        </div>
        <Link
          to={`/projects/${project.id}/files`}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="View files"
          aria-label="View files"
        >
          <ArrowRight size={14} />
        </Link>
      </div>
      <div className="grid divide-y divide-border-soft sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <ProjectFact label="Branch" value={project.default_branch ?? 'Not set'} icon={<GitBranch size={11} />} />
        <ProjectFact label="Origin" value={project.origin === 'linked' ? 'Linked repo' : 'Created'} />
        <ProjectFact label="Created" value={formatProjectDate(project.created_at)} />
      </div>
    </section>
  );
}

function ProjectFact({ label, value, icon, mono }: { label: string; value: string; icon?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-2.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-sm text-foreground ${mono ? 'font-mono text-xs' : 'font-medium'}`}>
        {icon && <span className="shrink-0 text-faint-fg">{icon}</span>}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function formatProjectDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ProjectSettingsPanel({
  project,
  editing,
  editName,
  editBranch,
  saving,
  onNameChange,
  onBranchChange,
  onEdit,
  onCancel,
  onSave,
}: {
  project: Project;
  editing: boolean;
  editName: string;
  editBranch: string;
  saving: boolean;
  onNameChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <RightRailSection
      title={(
        <span className="flex items-center justify-between gap-3">
          <span>Project settings</span>
          {!editing && (
            <button
              type="button"
              onClick={onEdit}
              className="text-xs font-medium text-primary hover:underline"
            >
              Edit
            </button>
          )}
        </span>
      )}
    >
      {editing ? (
        <div className="space-y-2.5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Name</span>
            <Input value={editName} onChange={e => onNameChange(e.target.value)} className="h-8 text-xs" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Default branch</span>
            <Input value={editBranch} onChange={e => onBranchChange(e.target.value)} placeholder="main" className="h-8 text-xs" />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" className="h-7 text-xs" disabled={saving || !editName.trim()} onClick={onSave}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <ReadOnlyRow label="Name" value={project.name} />
          <ReadOnlyRow label="Default branch" value={project.default_branch ?? 'Not set'} />
        </div>
      )}
    </RightRailSection>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-h-8 grid-cols-[7rem_minmax(0,1fr)] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function McpToolsPanel({
  connections,
  enabledIds,
  onToggle,
}: {
  connections: Connection[];
  enabledIds: string[];
  onToggle: (connectionId: string) => void;
}) {
  return (
    <RightRailSection
      title={(
        <span className="flex items-center gap-2">
          MCP tools
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">{connections.length}</span>
        </span>
      )}
    >
      <div className="space-y-1">
        {connections.map(conn => {
          const enabled = enabledIds.includes(conn.id);
          return (
            <div key={conn.id} className="grid min-h-8 grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-3">
              <span className="truncate text-sm font-medium text-foreground">{conn.name}</span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => onToggle(conn.id)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${enabled ? 'bg-primary' : 'bg-muted'}`}
              >
                <span className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          );
        })}
      </div>
    </RightRailSection>
  );
}

function DangerPanel({ onDelete }: { onDelete: () => void }) {
  return (
    <RightRailSection title={<span className="text-destructive">Danger zone</span>}>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Permanently deletes this project and its documents.</p>
      <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={onDelete}>Delete project</Button>
    </RightRailSection>
  );
}

function RightRailSection({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-border-soft pt-4 first:border-t-0 first:pt-0">
      <h2 className="mb-2.5 text-sm font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}
