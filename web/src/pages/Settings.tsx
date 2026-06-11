import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  createConnection,
  createProject,
  deleteConnection,
  deleteProject,
  getConnections,
  getMemory,
  getProjects,
  getScheduledTasks,
  getSettings,
  runScheduledTask,
  updateScheduledTask,
  updateSettings,
} from '../lib/api.js';
import { clearToken } from '../lib/auth.js';
import type { Connection, Memory, Project, ScheduledTask, UserSettings } from '../types.js';

type SetupKind = 'lead_agent' | 'claude_code' | 'codex' | 'github' | 'mcp';

const SETUP_META: Record<SetupKind, {
  title: string;
  description: string;
  type: Connection['type'];
  placeholder: string;
  secretLabel: string;
}> = {
  lead_agent: {
    title: 'Lead Agent',
    description: 'Runs the main conversation and decides when tools are needed.',
    type: 'anthropic',
    placeholder: 'sk-ant-...',
    secretLabel: 'Anthropic API key',
  },
  claude_code: {
    title: 'Claude Code',
    description: 'Runs coding tasks in a workspace repo.',
    type: 'anthropic',
    placeholder: 'sk-ant-...',
    secretLabel: 'Anthropic API key',
  },
  codex: {
    title: 'Codex',
    description: 'Runs Codex coding tasks in a workspace repo.',
    type: 'openai',
    placeholder: 'sk-...',
    secretLabel: 'OpenAI API key',
  },
  github: {
    title: 'GitHub',
    description: 'Reads repos, issues, and comments; write actions ask first.',
    type: 'github',
    placeholder: 'ghp_...',
    secretLabel: 'Personal access token',
  },
  mcp: {
    title: 'MCP Server',
    description: 'Adds extra tools that can be attached to workspaces.',
    type: 'mcp',
    placeholder: '',
    secretLabel: '',
  },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 py-7">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-medium">{title}</h2>
        <Separator className="flex-1" />
      </div>
      {children}
    </section>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" onClick={onClick} className="rounded-xl text-muted-foreground hover:text-destructive" title="Delete">
      <Trash2 size={15} strokeWidth={1.75} />
    </Button>
  );
}

function purposeLabel(purpose: Connection['purpose']): string {
  switch (purpose) {
    case 'lead_agent': return 'Lead Agent';
    case 'claude_code': return 'Claude Code';
    case 'codex': return 'Codex';
    case 'github': return 'GitHub';
    case 'mcp': return 'MCP';
    case 'tool': return 'Tool';
  }
}

export default function Settings() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['projects'], queryFn: getProjects });
  const { data: memory = [] } = useQuery<Memory[]>({ queryKey: ['memory'], queryFn: getMemory });
  const { data: scheduledTasks = [] } = useQuery<ScheduledTask[]>({ queryKey: ['scheduledTasks'], queryFn: getScheduledTasks });
  const { data: settings } = useQuery<UserSettings>({ queryKey: ['settings'], queryFn: getSettings });

  const [activeSetup, setActiveSetup] = useState<SetupKind | null>(null);
  const [setupName, setSetupName] = useState('');
  const [secret, setSecret] = useState('');
  const [mcpCommand, setMcpCommand] = useState('');
  const [mcpArgs, setMcpArgs] = useState('');
  const [mcpEnv, setMcpEnv] = useState('{}');
  const [setupError, setSetupError] = useState('');

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [projRepo, setProjRepo] = useState('');
  const [projConnIds, setProjConnIds] = useState<string[]>([]);
  const [projError, setProjError] = useState('');
  const [projectsRoot, setProjectsRoot] = useState('');
  const [projectsRootError, setProjectsRootError] = useState('');

  const inputCls = 'text-sm';
  const textareaCls = 'text-sm font-mono resize-y';
  const primaryBtn = buttonVariants();
  const ghostBtn = buttonVariants({ variant: 'ghost' });
  const rowCls = 'flex items-center gap-3 rounded-xl border bg-card px-4 py-3';

  const leadAgent = connections.find(c => c.purpose === 'lead_agent');
  const toolConnections = connections.filter(c => c.purpose === 'claude_code' || c.purpose === 'codex' || c.purpose === 'github');
  const mcpConnections = connections.filter(c => c.purpose === 'mcp');
  const projectConnections = connections.filter(c => c.purpose !== 'lead_agent');

  useEffect(() => {
    if (settings?.projects_root) setProjectsRoot(settings.projects_root);
  }, [settings]);

  const createConnMutation = useMutation({
    mutationFn: () => {
      if (!activeSetup) throw new Error('Pick what you want to set up');
      const meta = SETUP_META[activeSetup];
      let config: Record<string, unknown>;

      if (activeSetup === 'mcp') {
        if (!mcpCommand.trim()) throw new Error('Command required');
        try {
          if (mcpArgs.trim()) JSON.parse(mcpArgs);
          JSON.parse(mcpEnv);
        } catch {
          throw new Error('MCP args and env must be valid JSON');
        }
        config = { command: mcpCommand.trim(), args: mcpArgs.trim() || '[]', env: mcpEnv.trim() || '{}' };
      } else {
        if (!secret.trim()) throw new Error(`${meta.secretLabel} required`);
        config = activeSetup === 'github' ? { token: secret.trim() } : { apiKey: secret.trim() };
      }

      return createConnection({
        name: setupName.trim() || meta.title,
        type: meta.type,
        purpose: activeSetup,
        config,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      closeSetupModal();
    },
    onError: (e: Error) => setSetupError(e.message),
  });

  const deleteConnMutation = useMutation({
    mutationFn: deleteConnection,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const createProjMutation = useMutation({
    mutationFn: () => createProject({
      name: projName,
      description: projDesc || undefined,
      repo_path: projRepo || undefined,
      enabled_connection_ids: projConnIds,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      closeProjectModal();
    },
    onError: (e: Error) => setProjError(e.message),
  });

  const deleteProjMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  const updateSettingsMutation = useMutation({
    mutationFn: () => updateSettings({ projects_root: projectsRoot }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e: Error) => setProjectsRootError(e.message),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { enabled?: boolean; interval_hours?: number } }) => updateScheduledTask(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduledTasks'] }),
  });

  const runTaskMutation = useMutation({
    mutationFn: runScheduledTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduledTasks'] }),
  });

  function openSetupModal(kind: SetupKind) {
    setActiveSetup(kind);
    setSetupName(SETUP_META[kind].title);
    setSecret('');
    setMcpCommand('');
    setMcpArgs('');
    setMcpEnv('{}');
    setSetupError('');
  }

  function closeSetupModal() {
    setActiveSetup(null);
    setSetupName('');
    setSecret('');
    setMcpCommand('');
    setMcpArgs('');
    setMcpEnv('{}');
    setSetupError('');
  }

  function openProjectModal() {
    setShowProjectModal(true);
    setProjName('');
    setProjDesc('');
    setProjRepo('');
    setProjConnIds([]);
    setProjError('');
  }

  function closeProjectModal() {
    setShowProjectModal(false);
    setProjName('');
    setProjDesc('');
    setProjRepo('');
    setProjConnIds([]);
    setProjError('');
  }

  function handleSignOut() {
    clearToken();
    navigate('/login', { replace: true });
  }

  function SetupCard({ kind, connection }: { kind: SetupKind; connection?: Connection }) {
    const meta = SETUP_META[kind];
    return (
      <Card className="min-h-36 rounded-2xl">
        <CardHeader>
          <CardTitle>{meta.title}</CardTitle>
          <CardDescription>{meta.description}</CardDescription>
          <CardAction>
            <Badge variant={connection ? 'secondary' : 'outline'} className={connection ? 'text-success' : ''}>
            {connection ? 'Connected' : 'Not set'}
            </Badge>
          </CardAction>
        </CardHeader>
        {connection && <CardContent className="text-xs text-muted-foreground">{connection.name}</CardContent>}
        <CardFooter className="gap-2">
          <button onClick={() => openSetupModal(kind)} className={connection ? ghostBtn : primaryBtn}>
            {connection ? 'Details' : 'Connect'}
          </button>
          {connection && <DeleteBtn onClick={() => deleteConnMutation.mutate(connection.id)} />}
        </CardFooter>
      </Card>
    );
  }

  function SetupModal() {
    if (!activeSetup) return null;
    const meta = SETUP_META[activeSetup];
    const existing = connections.find(c => c.purpose === activeSetup);

    return (
      <Modal title={meta.title} onClose={closeSetupModal}>
        <DialogDescription>{meta.description}</DialogDescription>
        {existing && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
            <div className="flex-1">
              <div className="text-foreground/75 text-sm">{existing.name}</div>
              <Badge variant="secondary" className="mt-1 text-success">Connected</Badge>
            </div>
            <DeleteBtn onClick={() => deleteConnMutation.mutate(existing.id)} />
          </div>
        )}
        {existing && activeSetup !== 'mcp' ? (
          <div className="flex justify-end">
            <button onClick={closeSetupModal} className={ghostBtn}>Close</button>
          </div>
        ) : (
        <div className="flex flex-col gap-3">
          <div>
            <Label>Name</Label>
            <Input value={setupName} onChange={e => setSetupName(e.target.value)} className={inputCls} />
          </div>
          {activeSetup === 'mcp' ? (
            <>
              <div>
                <Label>Command</Label>
                <Input placeholder="npx" value={mcpCommand} onChange={e => setMcpCommand(e.target.value)} className={inputCls} />
              </div>
              <div>
                <Label>Args JSON</Label>
                <Textarea rows={2} placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]' value={mcpArgs} onChange={e => setMcpArgs(e.target.value)} className={textareaCls} />
              </div>
              <div>
                <Label>Env JSON</Label>
                <Textarea rows={2} placeholder='{"TOKEN":"..."}' value={mcpEnv} onChange={e => setMcpEnv(e.target.value)} className={textareaCls} />
              </div>
            </>
          ) : (
            <div>
              <Label>{meta.secretLabel}</Label>
              <Input type="password" placeholder={meta.placeholder} value={secret} onChange={e => setSecret(e.target.value)} className={inputCls} />
            </div>
          )}
          {setupError && <div className="text-destructive text-sm">{setupError}</div>}
          <DialogFooter>
            <button onClick={closeSetupModal} className={ghostBtn}>Cancel</button>
            <button onClick={() => createConnMutation.mutate()} className={primaryBtn}>
              Save setup
            </button>
          </DialogFooter>
        </div>
        )}
      </Modal>
    );
  }

  function ProjectModal() {
    if (!showProjectModal) return null;
    return (
      <Modal title="Project" onClose={closeProjectModal}>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Name</Label>
            <Input placeholder="Main app" value={projName} onChange={e => setProjName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>Description</Label>
            <Input placeholder="Optional" value={projDesc} onChange={e => setProjDesc(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>Repo path (optional)</Label>
            <Input placeholder="/Users/you/project" value={projRepo} onChange={e => setProjRepo(e.target.value)} className={inputCls} />
          </div>
          {projectConnections.length > 0 && (
            <div>
              <Label>Allowed tools</Label>
              <div className="mt-2 rounded-xl border bg-card px-3 py-2">
                {projectConnections.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={projConnIds.includes(c.id)}
                      onChange={e => setProjConnIds(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))}
                      className="h-4 w-4 rounded border-border bg-background accent-primary"
                    />
                    <span className="text-sm text-foreground/70">{c.name}</span>
                    <Badge variant="outline">{purposeLabel(c.purpose)}</Badge>
                  </label>
                ))}
              </div>
            </div>
          )}
          {projError && <div className="text-destructive text-sm">{projError}</div>}
          <DialogFooter>
            <button onClick={closeProjectModal} className={ghostBtn}>Cancel</button>
            <button onClick={() => createProjMutation.mutate()} className={primaryBtn} disabled={!projName.trim()}>Save project</button>
          </DialogFooter>
        </div>
      </Modal>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <div className="mx-auto max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Connect agents, tools, workspaces, and local memory.</p>
      </div>

      <Section title="Lead Agent">
        <SetupCard kind="lead_agent" connection={leadAgent} />
      </Section>

      <Section title="Tools">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SetupCard kind="claude_code" connection={toolConnections.find(c => c.purpose === 'claude_code')} />
          <SetupCard kind="codex" connection={toolConnections.find(c => c.purpose === 'codex')} />
          <SetupCard kind="github" connection={toolConnections.find(c => c.purpose === 'github')} />
        </div>
      </Section>

      <Section title="MCP">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {mcpConnections.map(c => (
            <Card key={c.id} className="rounded-2xl" size="sm">
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
                <CardAction><Badge variant="secondary" className="text-success">Connected</Badge></CardAction>
              </CardHeader>
              <CardFooter className="gap-2">
                <button onClick={() => openSetupModal('mcp')} className={ghostBtn}>Details</button>
                <DeleteBtn onClick={() => deleteConnMutation.mutate(c.id)} />
              </CardFooter>
            </Card>
          ))}
          <Card className="min-h-28 rounded-2xl border-dashed" size="sm">
            <CardHeader>
              <CardTitle>Add MCP Server</CardTitle>
              <CardDescription>Expose extra tools to workspaces.</CardDescription>
              <CardAction>
                <button onClick={() => openSetupModal('mcp')} className={primaryBtn}>Add</button>
              </CardAction>
            </CardHeader>
          </Card>
        </div>
      </Section>

      <Section title="Projects">
        <div className="mb-3 flex items-end gap-3">
          <div className="flex-1">
            <Label>Projects root</Label>
            <Input
              placeholder="/Users/you/projects"
              value={projectsRoot}
              onChange={e => setProjectsRoot(e.target.value)}
              className={inputCls}
            />
          </div>
          <button onClick={() => updateSettingsMutation.mutate()} className={ghostBtn} disabled={!projectsRoot.trim()}>
            Save
          </button>
        </div>
        {projectsRootError && <div className="text-destructive text-sm mb-3">{projectsRootError}</div>}
        <p className="text-muted-foreground/70 text-xs mb-3">
          The agent creates new repo-backed projects under this directory.
        </p>
        {projects.length > 0 && (
          <div className="mb-3 grid gap-2">
            {projects.map(p => (
              <div key={p.id} className={rowCls}>
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {p.name}
                    {!p.repo_path && <span className="ml-2 text-muted-foreground/70 text-xs">(no repo)</span>}
                  </div>
                  {p.description && <div className="text-muted-foreground/70 text-xs mt-0.5">{p.description}</div>}
                </div>
                <DeleteBtn onClick={() => deleteProjMutation.mutate(p.id)} />
              </div>
            ))}
          </div>
        )}
        <button onClick={openProjectModal} className={primaryBtn}>Add project</button>
      </Section>

      <Section title="Memory">
        {memory.length === 0 ? (
          <div className="text-muted-foreground/70 text-sm">No memory stored yet.</div>
        ) : (
          <div className="grid gap-4">
            {(['user', 'feedback', 'project', 'reference'] as const).map(type => {
              const entries = memory.filter(m => m.type === type);
              if (entries.length === 0) return null;
              return (
                <div key={type}>
                  <h3 className="mb-2 text-sm font-medium capitalize text-muted-foreground">{type}</h3>
                  <div className="grid gap-2">
                    {entries.map(m => (
                      <div key={`${m.type}-${m.key}`} className={rowCls}>
                        <div className="w-40 text-muted-foreground text-sm font-mono shrink-0">
                          {m.key}
                          {m.type === 'project' && (
                            <div className="text-muted-foreground/60 text-xs font-sans">
                              {projects.find(p => p.id === m.project_id)?.name ?? m.project_id}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 text-foreground/75 text-sm">{m.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Scheduled Tasks">
        {scheduledTasks.length === 0 ? (
          <div className="text-muted-foreground/70 text-sm">No scheduled tasks.</div>
        ) : (
          <div className="grid gap-2">
            {scheduledTasks.map(task => (
              <div key={task.id} className={rowCls}>
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {task.type === 'reorganize_memory' ? 'Memory reorganization' : task.type}
                  </div>
                  <div className="text-muted-foreground/70 text-xs mt-0.5">
                    {task.last_run_at
                      ? `Last ran ${new Date(task.last_run_at * 1000).toLocaleString()}`
                      : 'Never run'}
                  </div>
                </div>
                <button onClick={() => runTaskMutation.mutate(task.id)} className={ghostBtn}>
                  Run now
                </button>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!task.enabled}
                    onChange={e => updateTaskMutation.mutate({ id: task.id, body: { enabled: e.target.checked } })}
                    className="h-4 w-4 rounded border-border bg-background accent-primary"
                  />
                  <span className="text-sm text-foreground/70">Enabled</span>
                </label>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Account">
        <Button variant="destructive" onClick={handleSignOut}>Sign out</Button>
      </Section>

      <SetupModal />
      <ProjectModal />
      </div>
    </div>
  );
}
