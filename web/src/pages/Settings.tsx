import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ContentColumn, PageBody, PageHeader, PageSection, PageShell } from '@/components/ui/app-layout';
import {
  createConnection,
  deleteConnection,
  getConnections,
  getMemory,
  getProjects,
  getScheduledTasks,
  getSettings,
  runScheduledTask,
  updateAgentBudgets,
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
  secretOptional?: boolean;
  secretOptionalHint?: string;
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
    placeholder: 'sk-ant-... (optional)',
    secretLabel: 'Anthropic API key',
    secretOptional: true,
    secretOptionalHint: "Leave blank to use this server's local `claude` CLI login (subscription auth) instead of a metered API key.",
  },
  codex: {
    title: 'Codex',
    description: 'Runs Codex coding tasks in a workspace repo.',
    type: 'openai',
    placeholder: 'sk-... (optional)',
    secretLabel: 'OpenAI API key',
    secretOptional: true,
    secretOptionalHint: "Leave blank to use this server's local `codex` CLI login instead of a metered API key.",
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

interface McpPreset {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  /** If set, shows an extra input appended as the final arg (e.g. a path or connection string). */
  extraArgLabel?: string;
  extraArgPlaceholder?: string;
  envVars?: { key: string; label: string; placeholder?: string }[];
}

const MCP_PRESETS: McpPreset[] = [
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning tool for complex problems.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Browser automation — navigate, click, screenshot, test web UIs.',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Headless Chrome browser automation and screenshots.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web and local search via the Brave Search API.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envVars: [{ key: 'BRAVE_API_KEY', label: 'Brave API key' }],
  },
  {
    id: 'github',
    name: 'GitHub (extended)',
    description: 'Full GitHub API coverage beyond the built-in github_api tool.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    envVars: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', placeholder: 'ghp_...' }],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read and post messages, list channels.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envVars: [
      { key: 'SLACK_BOT_TOKEN', label: 'Bot token', placeholder: 'xoxb-...' },
      { key: 'SLACK_TEAM_ID', label: 'Team ID', placeholder: 'T0123456' },
    ],
  },
  {
    id: 'postgres',
    name: 'Postgres',
    description: 'Read-only schema inspection and queries against a Postgres database.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    extraArgLabel: 'Connection string',
    extraArgPlaceholder: 'postgresql://user:pass@host:5432/db',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read and write Notion pages and databases.',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    envVars: [{ key: 'NOTION_TOKEN', label: 'Internal integration token', placeholder: 'ntn_...' }],
  },
];

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
  const [mcpPreset, setMcpPreset] = useState<string>('custom');
  const [mcpExtraArg, setMcpExtraArg] = useState('');
  const [mcpEnvValues, setMcpEnvValues] = useState<Record<string, string>>({});
  const [setupError, setSetupError] = useState('');

  const [projectsRoot, setProjectsRoot] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ id: string } | null>(null);
  const [projectsRootError, setProjectsRootError] = useState('');

  const [claudeCodeBudget, setClaudeCodeBudget] = useState('');
  const [codexBudget, setCodexBudget] = useState('');
  const [agentBudgetsError, setAgentBudgetsError] = useState('');

  const inputCls = 'text-sm';
  const textareaCls = 'text-sm font-mono resize-y';
  const rowCls = 'flex items-center gap-3 rounded-xl border border-border/50 bg-card px-4 py-3';

  const leadAgent = connections.find(c => c.purpose === 'lead_agent');
  const toolConnections = connections.filter(c => c.purpose === 'claude_code' || c.purpose === 'codex' || c.purpose === 'github');
  const mcpConnections = connections.filter(c => c.purpose === 'mcp');
  const projectConnections = connections.filter(c => c.purpose !== 'lead_agent');

  useEffect(() => {
    if (settings?.projects_root) setProjectsRoot(settings.projects_root);
  }, [settings]);

  useEffect(() => {
    if (!settings) return;
    setClaudeCodeBudget(settings.agent_budgets.claude_code !== null ? String(settings.agent_budgets.claude_code) : '');
    setCodexBudget(settings.agent_budgets.codex !== null ? String(settings.agent_budgets.codex) : '');
  }, [settings]);

  const createConnMutation = useMutation({
    mutationFn: () => {
      if (!activeSetup) throw new Error('Pick what you want to set up');
      const meta = SETUP_META[activeSetup];
      let config: Record<string, unknown>;

      if (activeSetup === 'mcp') {
        const preset = MCP_PRESETS.find(p => p.id === mcpPreset);
        if (preset) {
          const args = [...preset.args];
          if (preset.extraArgLabel) {
            if (!mcpExtraArg.trim()) throw new Error(`${preset.extraArgLabel} required`);
            args.push(mcpExtraArg.trim());
          }
          const env: Record<string, string> = {};
          for (const v of preset.envVars ?? []) {
            if (!mcpEnvValues[v.key]?.trim()) throw new Error(`${v.label} required`);
            env[v.key] = mcpEnvValues[v.key].trim();
          }
          config = { command: preset.command, args: JSON.stringify(args), env: JSON.stringify(env) };
        } else {
          if (!mcpCommand.trim()) throw new Error('Command required');
          try {
            if (mcpArgs.trim()) JSON.parse(mcpArgs);
            JSON.parse(mcpEnv);
          } catch {
            throw new Error('MCP args and env must be valid JSON');
          }
          config = { command: mcpCommand.trim(), args: mcpArgs.trim() || '[]', env: mcpEnv.trim() || '{}' };
        }
      } else {
        if (!secret.trim() && !meta.secretOptional) throw new Error(`${meta.secretLabel} required`);
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

  const updateSettingsMutation = useMutation({
    mutationFn: (root: string) => updateSettings({ projects_root: root }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e: Error) => setProjectsRootError(e.message),
  });

  const updateAgentBudgetsMutation = useMutation({
    mutationFn: (body: { claude_code?: number | null; codex?: number | null }) => updateAgentBudgets(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e: Error) => setAgentBudgetsError(e.message),
  });

  function saveAgentBudgets() {
    setAgentBudgetsError('');
    const parseBudget = (v: string): number | null => {
      if (!v.trim()) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new Error('Budgets must be non-negative numbers');
      return n;
    };
    try {
      const claude_code = parseBudget(claudeCodeBudget);
      const codex = parseBudget(codexBudget);
      updateAgentBudgetsMutation.mutate({ claude_code, codex });
    } catch (e) {
      setAgentBudgetsError((e as Error).message);
    }
  }

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
    setMcpPreset('custom');
    setMcpExtraArg('');
    setMcpEnvValues({});
    setSetupError('');
  }

  function selectMcpPreset(presetId: string) {
    setMcpPreset(presetId);
    setMcpExtraArg('');
    setMcpEnvValues({});
    setSetupError('');
    const preset = MCP_PRESETS.find(p => p.id === presetId);
    setSetupName(preset ? preset.name : SETUP_META.mcp.title);
  }

  function closeSetupModal() {
    setActiveSetup(null);
    setSetupName('');
    setSecret('');
    setMcpCommand('');
    setMcpArgs('');
    setMcpEnv('{}');
    setMcpPreset('custom');
    setMcpExtraArg('');
    setMcpEnvValues({});
    setSetupError('');
  }

  function handleSignOut() {
    clearToken();
    navigate('/login', { replace: true });
  }

  function SetupCard({ kind, connection }: { kind: SetupKind; connection?: Connection }) {
    const meta = SETUP_META[kind];
    return (
      <Card className="rounded-xl bg-background/55 shadow-none" size="sm">
        <CardHeader>
          <CardTitle>{meta.title}</CardTitle>
          <CardDescription className="text-xs leading-relaxed">{meta.description}</CardDescription>
          <CardAction>
            <Badge variant={connection ? 'secondary' : 'outline'} className={connection ? 'text-success' : ''}>
            {connection ? 'Connected' : 'Not set'}
            </Badge>
          </CardAction>
        </CardHeader>
        {connection && <CardContent className="text-xs text-muted-foreground">{connection.name}</CardContent>}
        <CardFooter className="gap-2">
          <Button variant={connection ? 'ghost' : undefined} size="sm" onClick={() => openSetupModal(kind)}>
            {connection ? 'Details' : 'Connect'}
          </Button>
          {connection && <DeleteBtn onClick={() => setPendingDelete({ id: connection.id })} />}
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
            <DeleteBtn onClick={() => setPendingDelete({ id: existing.id })} />
          </div>
        )}
        {existing && activeSetup !== 'mcp' ? (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={closeSetupModal}>Close</Button>
          </div>
        ) : (
        <div className="flex flex-col gap-3">
          {activeSetup === 'mcp' && (
            <div>
              <Label>Preset</Label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={mcpPreset === 'custom' ? 'secondary' : 'outline'}
                  onClick={() => selectMcpPreset('custom')}
                >
                  Custom
                </Button>
                {MCP_PRESETS.map(p => (
                  <Button
                    key={p.id}
                    type="button"
                    size="sm"
                    variant={mcpPreset === p.id ? 'secondary' : 'outline'}
                    onClick={() => selectMcpPreset(p.id)}
                  >
                    {p.name}
                  </Button>
                ))}
              </div>
              {mcpPreset !== 'custom' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {MCP_PRESETS.find(p => p.id === mcpPreset)?.description}
                </p>
              )}
            </div>
          )}
          <div>
            <Label>Name</Label>
            <Input value={setupName} onChange={e => setSetupName(e.target.value)} className={inputCls} />
          </div>
          {activeSetup === 'mcp' ? (
            mcpPreset !== 'custom' ? (
              <>
                {(() => {
                  const preset = MCP_PRESETS.find(p => p.id === mcpPreset);
                  if (!preset) return null;
                  return (
                    <>
                      {preset.extraArgLabel && (
                        <div>
                          <Label>{preset.extraArgLabel}</Label>
                          <Input
                            placeholder={preset.extraArgPlaceholder}
                            value={mcpExtraArg}
                            onChange={e => setMcpExtraArg(e.target.value)}
                            className={inputCls}
                          />
                        </div>
                      )}
                      {(preset.envVars ?? []).map(v => (
                        <div key={v.key}>
                          <Label>{v.label}</Label>
                          <Input
                            type="password"
                            placeholder={v.placeholder}
                            value={mcpEnvValues[v.key] ?? ''}
                            onChange={e => setMcpEnvValues(prev => ({ ...prev, [v.key]: e.target.value }))}
                            className={inputCls}
                          />
                        </div>
                      ))}
                    </>
                  );
                })()}
              </>
            ) : (
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
            )
          ) : (
            <div>
              <Label>{meta.secretLabel}{meta.secretOptional ? ' (optional)' : ''}</Label>
              <Input type="password" placeholder={meta.placeholder} value={secret} onChange={e => setSecret(e.target.value)} className={inputCls} />
              {meta.secretOptionalHint && (
                <p className="mt-1 text-xs text-muted-foreground">{meta.secretOptionalHint}</p>
              )}
            </div>
          )}
          {setupError && <div className="text-destructive text-sm">{setupError}</div>}
          <DialogFooter>
            <Button variant="ghost" onClick={closeSetupModal}>Cancel</Button>
            <Button onClick={() => createConnMutation.mutate()}>Save setup</Button>
          </DialogFooter>
        </div>
        )}
      </Modal>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="Connect agents, tools, workspaces, and local memory."
      />
      <PageBody>
      <ContentColumn>

      <PageSection title="Lead Agent">
        <div className="max-w-2xl">
          <SetupCard kind="lead_agent" connection={leadAgent} />
        </div>
      </PageSection>

      <PageSection title="Tools">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SetupCard kind="claude_code" connection={toolConnections.find(c => c.purpose === 'claude_code')} />
          <SetupCard kind="codex" connection={toolConnections.find(c => c.purpose === 'codex')} />
          <SetupCard kind="github" connection={toolConnections.find(c => c.purpose === 'github')} />
        </div>
      </PageSection>

      <PageSection title="MCP">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {mcpConnections.map(c => (
            <Card key={c.id} className="rounded-xl bg-background/55 shadow-none" size="sm">
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
                <CardAction><Badge variant="secondary" className="text-success">Connected</Badge></CardAction>
              </CardHeader>
              <CardFooter className="gap-2">
                <Button variant="ghost" size="sm" onClick={() => openSetupModal('mcp')}>Details</Button>
                <DeleteBtn onClick={() => setPendingDelete({ id: c.id })} />
              </CardFooter>
            </Card>
          ))}
          <Card className="rounded-xl border-dashed bg-background/40 shadow-none" size="sm">
            <CardHeader>
              <CardTitle>Add MCP Server</CardTitle>
              <CardDescription>Run an MCP server process (command + args) to expose extra tools.</CardDescription>
              <CardAction>
                <Button size="sm" onClick={() => openSetupModal('mcp')}>Add</Button>
              </CardAction>
            </CardHeader>
          </Card>
        </div>
      </PageSection>

      <PageSection title="Projects">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label>Projects root</Label>
            <Input
              placeholder="/Users/you/projects"
              value={projectsRoot}
              onChange={e => setProjectsRoot(e.target.value)}
              className={inputCls}
            />
          </div>
          <Button variant="ghost" onClick={() => updateSettingsMutation.mutate(projectsRoot)}>
            Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setProjectsRoot('');
              updateSettingsMutation.mutate('');
            }}
          >
            Reset to default
          </Button>
        </div>
        {projectsRootError && <div className="text-destructive text-sm mb-3">{projectsRootError}</div>}
        <p className="mb-3 max-w-3xl text-xs leading-relaxed text-muted-foreground/70">
          New repo-backed projects are created here. Keep the default app data folder, or point it at a workspace
          location such as <code>~/code</code>.
        </p>
      </PageSection>

      <PageSection title="Agent budgets">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label>Claude Code monthly budget (USD)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="No limit"
              value={claudeCodeBudget}
              onChange={e => setClaudeCodeBudget(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex-1">
            <Label>Codex monthly budget (USD)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="No limit"
              value={codexBudget}
              onChange={e => setCodexBudget(e.target.value)}
              className={inputCls}
            />
          </div>
          <Button variant="ghost" onClick={saveAgentBudgets}>
            Save
          </Button>
        </div>
        {agentBudgetsError && <div className="text-destructive text-sm mb-3">{agentBudgetsError}</div>}
        <p className="mb-3 max-w-3xl text-xs leading-relaxed text-muted-foreground/70">
          Set a monthly spend cap for each coding agent. Leave blank for no limit. The lead agent sees current
          spend against these budgets and can favor the less-constrained agent when nearly exhausted.
        </p>
      </PageSection>

      <PageSection title="Memory">
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
      </PageSection>

      <PageSection title="Scheduled Tasks">
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
                <Button variant="ghost" size="sm" onClick={() => runTaskMutation.mutate(task.id)}>
                  Run now
                </Button>
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
      </PageSection>

      <PageSection title="Account">
        <Button variant="destructive" onClick={handleSignOut}>Sign out</Button>
      </PageSection>

      {pendingDelete && (
        <ConfirmDialog
          title="Remove connection?"
          description="This will disconnect the integration. You can reconnect it at any time."
          confirmLabel="Delete"
          onConfirm={() => {
            deleteConnMutation.mutate(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <SetupModal />
      </ContentColumn>
      </PageBody>
    </PageShell>
  );
}
