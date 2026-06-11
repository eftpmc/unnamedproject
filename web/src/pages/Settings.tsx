import { useState } from 'react';
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
  createWorkspace,
  deleteConnection,
  deleteWorkspace,
  getConnections,
  getMemory,
  getWorkspaces,
} from '../lib/api.js';
import { clearToken } from '../lib/auth.js';
import type { Connection, Workspace } from '../types.js';

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
  const { data: workspaces = [] } = useQuery<Workspace[]>({ queryKey: ['workspaces'], queryFn: getWorkspaces });
  const { data: memory = {} } = useQuery<Record<string, string>>({ queryKey: ['memory'], queryFn: getMemory });

  const [activeSetup, setActiveSetup] = useState<SetupKind | null>(null);
  const [setupName, setSetupName] = useState('');
  const [secret, setSecret] = useState('');
  const [mcpCommand, setMcpCommand] = useState('');
  const [mcpArgs, setMcpArgs] = useState('');
  const [mcpEnv, setMcpEnv] = useState('{}');
  const [setupError, setSetupError] = useState('');

  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsDesc, setWsDesc] = useState('');
  const [wsRepo, setWsRepo] = useState('');
  const [wsConnIds, setWsConnIds] = useState<string[]>([]);
  const [wsError, setWsError] = useState('');

  const inputCls = 'text-sm';
  const textareaCls = 'text-sm font-mono resize-y';
  const primaryBtn = buttonVariants();
  const ghostBtn = buttonVariants({ variant: 'ghost' });
  const rowCls = 'flex items-center gap-3 rounded-xl border bg-card px-4 py-3';

  const leadAgent = connections.find(c => c.purpose === 'lead_agent');
  const toolConnections = connections.filter(c => c.purpose === 'claude_code' || c.purpose === 'codex' || c.purpose === 'github');
  const mcpConnections = connections.filter(c => c.purpose === 'mcp');
  const workspaceConnections = connections.filter(c => c.purpose !== 'lead_agent');

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

  const createWsMutation = useMutation({
    mutationFn: () => createWorkspace({
      name: wsName,
      description: wsDesc || undefined,
      repo_path: wsRepo || undefined,
      enabled_connection_ids: wsConnIds,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      closeWorkspaceModal();
    },
    onError: (e: Error) => setWsError(e.message),
  });

  const deleteWsMutation = useMutation({
    mutationFn: deleteWorkspace,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspaces'] }),
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

  function openWorkspaceModal() {
    setShowWorkspaceModal(true);
    setWsName('');
    setWsDesc('');
    setWsRepo('');
    setWsConnIds([]);
    setWsError('');
  }

  function closeWorkspaceModal() {
    setShowWorkspaceModal(false);
    setWsName('');
    setWsDesc('');
    setWsRepo('');
    setWsConnIds([]);
    setWsError('');
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

  function WorkspaceModal() {
    if (!showWorkspaceModal) return null;
    return (
      <Modal title="Workspace" onClose={closeWorkspaceModal}>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Name</Label>
            <Input placeholder="Main app" value={wsName} onChange={e => setWsName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>Description</Label>
            <Input placeholder="Optional" value={wsDesc} onChange={e => setWsDesc(e.target.value)} className={inputCls} />
          </div>
          <div>
            <Label>Repo path</Label>
            <Input placeholder="/Users/you/project" value={wsRepo} onChange={e => setWsRepo(e.target.value)} className={inputCls} />
          </div>
          {workspaceConnections.length > 0 && (
            <div>
              <Label>Allowed tools</Label>
              <div className="mt-2 rounded-xl border bg-card px-3 py-2">
                {workspaceConnections.map(c => (
                  <label key={c.id} className="flex items-center gap-2 py-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wsConnIds.includes(c.id)}
                      onChange={e => setWsConnIds(prev => e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id))}
                      className="h-4 w-4 rounded border-border bg-background accent-primary"
                    />
                    <span className="text-sm text-foreground/70">{c.name}</span>
                    <Badge variant="outline">{purposeLabel(c.purpose)}</Badge>
                  </label>
                ))}
              </div>
            </div>
          )}
          {wsError && <div className="text-destructive text-sm">{wsError}</div>}
          <DialogFooter>
            <button onClick={closeWorkspaceModal} className={ghostBtn}>Cancel</button>
            <button onClick={() => createWsMutation.mutate()} className={primaryBtn} disabled={!wsName.trim()}>Save workspace</button>
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

      <Section title="Workspaces">
        {workspaces.length > 0 && (
          <div className="mb-3 grid gap-2">
            {workspaces.map(w => (
              <div key={w.id} className={rowCls}>
                <div className="flex-1">
                  <div className="text-sm font-medium">{w.name}</div>
                  {w.description && <div className="text-muted-foreground/70 text-xs mt-0.5">{w.description}</div>}
                </div>
                <DeleteBtn onClick={() => deleteWsMutation.mutate(w.id)} />
              </div>
            ))}
          </div>
        )}
        <button onClick={openWorkspaceModal} className={primaryBtn}>Add workspace</button>
      </Section>

      <Section title="Memory">
        {Object.keys(memory).length === 0 ? (
          <div className="text-muted-foreground/70 text-sm">No memory stored yet.</div>
        ) : (
          <div className="grid gap-2">
            {Object.entries(memory).map(([k, v]) => (
              <div key={k} className={rowCls}>
                <div className="w-36 text-muted-foreground text-sm font-mono shrink-0">{k}</div>
                <div className="flex-1 text-foreground/75 text-sm">{v}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Account">
        <Button variant="destructive" onClick={handleSignOut}>Sign out</Button>
      </Section>

      <SetupModal />
      <WorkspaceModal />
      </div>
    </div>
  );
}
