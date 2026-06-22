import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Moon, Play, Plus, Sun, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ContentColumn, PageBody, PageHeader, PageShell } from '@/components/ui/app-layout';
import { cn } from '@/lib/utils';
import {
  createConnection,
  deleteConnection,
  deleteScheduledTask,
  getConnections,
  getMemory,
  getProjects,
  getScheduledTasks,
  getSettings,
  runScheduledTask,
  testConnection,
  updateAgentBudgets,
  updateScheduledTask,
  updateSettings,
} from '../lib/api.js';
import { clearToken, getToken } from '../lib/auth.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { useTheme } from '../lib/useTheme.js';
import { useAccent } from '../lib/useAccent.js';
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../lib/accent.js';
import type { Connection, Memory, PermissionProfile, Project, ScheduledTask, UserSettings } from '../types.js';

type Tab = 'agents' | 'tools' | 'mcp' | 'workspace' | 'memory' | 'account';

const TABS: { id: Tab; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'tools', label: 'Tools' },
  { id: 'mcp', label: 'MCP' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'memory', label: 'Memory' },
  { id: 'account', label: 'Account' },
];

type SetupKind = 'lead_agent' | 'claude_code' | 'codex' | 'mcp';

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
  extraArgLabel?: string;
  extraArgPlaceholder?: string;
  envVars?: { key: string; label: string; placeholder?: string }[];
}

const MCP_PRESETS: McpPreset[] = [
  { id: 'sequential-thinking', name: 'Sequential Thinking', description: 'Structured step-by-step reasoning tool for complex problems.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
  { id: 'playwright', name: 'Playwright', description: 'Browser automation — navigate, click, screenshot, test web UIs.', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
  { id: 'puppeteer', name: 'Puppeteer', description: 'Headless Chrome browser automation and screenshots.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
  { id: 'brave-search', name: 'Brave Search', description: 'Web and local search via the Brave Search API.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], envVars: [{ key: 'BRAVE_API_KEY', label: 'Brave API key' }] },
  { id: 'github', name: 'GitHub', description: 'GitHub API — repos, PRs, issues, code search, and more.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envVars: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', placeholder: 'ghp_...' }] },
  { id: 'slack', name: 'Slack', description: 'Read and post messages, list channels.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], envVars: [{ key: 'SLACK_BOT_TOKEN', label: 'Bot token', placeholder: 'xoxb-...' }, { key: 'SLACK_TEAM_ID', label: 'Team ID', placeholder: 'T0123456' }] },
  { id: 'postgres', name: 'Postgres', description: 'Read-only schema inspection and queries against a Postgres database.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], extraArgLabel: 'Connection string', extraArgPlaceholder: 'postgresql://user:pass@host:5432/db' },
  { id: 'notion', name: 'Notion', description: 'Read and write Notion pages and databases.', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], envVars: [{ key: 'NOTION_TOKEN', label: 'Internal integration token', placeholder: 'ntn_...' }] },
];

function ConnectedBadge() {
  return <Badge variant="secondary" className="text-success">Connected</Badge>;
}

function ConnectionErrorBadge() {
  return <Badge variant="secondary" className="text-destructive">Error</Badge>;
}

function NotSetBadge() {
  return <Badge variant="outline">Not set</Badge>;
}

function DeleteBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" onClick={onClick} className="text-muted-foreground hover:text-destructive" title="Delete">
      <Trash2 size={15} strokeWidth={1.75} />
    </Button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 text-[11px] font-semibold tracking-wide text-faint-fg">{children}</div>;
}

function SettingRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-4 rounded-lg border border-border-soft bg-card p-4', className)}>
      {children}
    </div>
  );
}

function AppearanceSection() {
  const { theme, toggleTheme } = useTheme();
  const { accent, setAccent } = useAccent();
  const isDark = theme === 'unnamed-dark';
  const isCustom = !ACCENT_PRESETS.some(p => p.h === accent.h && p.c === accent.c);

  return (
    <>
      <SettingRow>
        <div>
          <div className="text-sm font-medium text-foreground">Theme</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Switch between light and dark mode.</div>
        </div>
        <Button variant="outline" size="sm" onClick={toggleTheme}>
          {isDark ? <Sun size={14} className="mr-1.5" /> : <Moon size={14} className="mr-1.5" />}
          {isDark ? 'Light mode' : 'Dark mode'}
        </Button>
      </SettingRow>
      <div className="rounded-lg border border-border-soft bg-card p-4">
        <div className="text-sm font-medium text-foreground">Accent</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Pick a preset or a custom hue. Applies instantly.</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map(preset => {
            const active = !isCustom && accent.h === preset.h && accent.c === preset.c;
            return (
              <button
                key={preset.name}
                type="button"
                title={preset.name}
                onClick={() => setAccent({ h: preset.h, c: preset.c })}
                className={cn(
                  'size-7 shrink-0 rounded-full ring-offset-2 ring-offset-card transition-all',
                  active ? 'ring-2 ring-foreground' : 'hover:ring-2 hover:ring-border',
                )}
                style={{ backgroundColor: `oklch(0.6 ${preset.c} ${preset.h})` }}
              >
                {active && <Check size={14} className="mx-auto text-white drop-shadow" strokeWidth={3} />}
              </button>
            );
          })}
          <button
            type="button"
            title="Custom hue"
            onClick={() => { if (!isCustom) setAccent({ h: accent.h, c: DEFAULT_ACCENT.c }); }}
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-all',
              isCustom ? 'border-foreground' : 'border-dashed border-border hover:border-muted-foreground',
            )}
            style={isCustom ? { backgroundColor: `oklch(0.6 ${accent.c} ${accent.h})` } : undefined}
          >
            {!isCustom && <Plus size={14} className="text-muted-foreground" />}
          </button>
        </div>
        {isCustom && (
          <input
            type="range"
            min={0}
            max={360}
            value={accent.h}
            onChange={e => setAccent({ h: Number(e.target.value), c: accent.c })}
            className="mt-3 w-full"
          />
        )}
      </div>
    </>
  );
}

function SettingRowInfo({ title, description, mono }: { title: string; description?: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && (
        <div className={cn('mt-0.5 text-xs text-faint-fg', mono && 'font-mono')}>{description}</div>
      )}
    </div>
  );
}

function HintText({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground/70">{children}</p>;
}

function ConnectMobileSection() {
  const [showQr, setShowQr] = useState(false);
  const token = getToken() ?? '';
  const url = window.location.origin.replace(/:\d+$/, ':3000');
  const qrValue = JSON.stringify({ url, token });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">Connect Mobile</div>
          <div className="text-xs text-muted-foreground">Scan from the Unnamed mobile app to connect instantly</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowQr(v => !v)}>
          {showQr ? 'Hide QR' : 'Show QR'}
        </Button>
      </div>
      {showQr && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border p-6 bg-white">
          <QRCodeSVG value={qrValue} size={200} />
          <p className="text-xs text-muted-foreground">Open the mobile app and tap "Scan QR code"</p>
        </div>
      )}
    </div>
  );
}

export default function Settings() {
  usePageTitle('Settings');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('agents');

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
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>('fast');
  const [pendingDelete, setPendingDelete] = useState<{ id: string } | null>(null);
  const [projectsRootError, setProjectsRootError] = useState('');

  const [claudeCodeBudget, setClaudeCodeBudget] = useState('');
  const [codexBudget, setCodexBudget] = useState('');
  const [claudeCodeDailyBudget, setClaudeCodeDailyBudget] = useState('');
  const [codexDailyBudget, setCodexDailyBudget] = useState('');
  const [agentBudgetsError, setAgentBudgetsError] = useState('');
  const [taskIntervals, setTaskIntervals] = useState<Record<string, string>>({});

  const leadAgent = connections.find(c => c.purpose === 'lead_agent');
  const mcpConnections = connections.filter(c => c.purpose === 'mcp');

  useEffect(() => {
    if (settings?.projects_root) setProjectsRoot(settings.projects_root);
    if (settings?.permission_profile) setPermissionProfile(settings.permission_profile);
  }, [settings]);

  useEffect(() => {
    if (!settings) return;
    setClaudeCodeBudget(settings.agent_budgets.claude_code !== null ? String(settings.agent_budgets.claude_code) : '');
    setCodexBudget(settings.agent_budgets.codex !== null ? String(settings.agent_budgets.codex) : '');
    setClaudeCodeDailyBudget(settings.agent_daily_budgets.claude_code !== null ? String(settings.agent_daily_budgets.claude_code) : '');
    setCodexDailyBudget(settings.agent_daily_budgets.codex !== null ? String(settings.agent_daily_budgets.codex) : '');
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
        config = { apiKey: secret.trim() };
      }

      return createConnection({ name: setupName.trim() || meta.title, type: meta.type, purpose: activeSetup, config });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['connections'] }); closeSetupModal(); },
    onError: (e: Error) => setSetupError(e.message),
  });

  const deleteConnMutation = useMutation({
    mutationFn: deleteConnection,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (body: { projects_root: string; permission_profile?: PermissionProfile }) => updateSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e: Error) => setProjectsRootError(e.message),
  });

  const updateAgentBudgetsMutation = useMutation({
    mutationFn: (body: { claude_code?: number | null; codex?: number | null; claude_code_daily?: number | null; codex_daily?: number | null }) => updateAgentBudgets(body),
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
      updateAgentBudgetsMutation.mutate({
        claude_code: parseBudget(claudeCodeBudget),
        codex: parseBudget(codexBudget),
        claude_code_daily: parseBudget(claudeCodeDailyBudget),
        codex_daily: parseBudget(codexDailyBudget),
      });
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

  const deleteTaskMutation = useMutation({
    mutationFn: deleteScheduledTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduledTasks'] }),
  });

  function openSetupModal(kind: SetupKind) {
    setActiveSetup(kind);
    setSetupName(SETUP_META[kind].title);
    setSecret(''); setMcpCommand(''); setMcpArgs(''); setMcpEnv('{}');
    setMcpPreset('custom'); setMcpExtraArg(''); setMcpEnvValues({}); setSetupError('');
  }

  function openMcpPresetModal(presetId: string) {
    const preset = MCP_PRESETS.find(p => p.id === presetId);
    setActiveSetup('mcp');
    setSetupName(preset ? preset.name : SETUP_META.mcp.title);
    setMcpPreset(presetId);
    setMcpExtraArg(''); setMcpEnvValues({}); setSetupError('');
    setSecret(''); setMcpCommand(''); setMcpArgs(''); setMcpEnv('{}');
  }

  function closeSetupModal() {
    setActiveSetup(null);
    setSetupName(''); setSecret(''); setMcpCommand(''); setMcpArgs(''); setMcpEnv('{}');
    setMcpPreset('custom'); setMcpExtraArg(''); setMcpEnvValues({}); setSetupError('');
  }

  function handleSignOut() {
    clearToken();
    navigate('/login', { replace: true });
  }

  function ConnectionRow({ kind }: { kind: SetupKind }) {
    const meta = SETUP_META[kind];
    const connection = connections.find(c => c.purpose === kind);
    const { data: health } = useQuery({
      queryKey: ['connection-health', connection?.id],
      queryFn: () => testConnection(connection!.id),
      enabled: !!connection && connection.type !== 'mcp',
      staleTime: 60_000,
      retry: false,
    });
    const healthDot = connection && health !== undefined
      ? health.ok === true ? 'bg-success' : health.ok === false ? 'bg-destructive' : null
      : null;
    const healthTitle = health?.ok === true
      ? `Connected · ${health.latencyMs}ms`
      : health?.ok === false ? `Error: ${health.error}` : undefined;

    return (
      <SettingRow>
        <div className="min-w-0">
          <SettingRowInfo title={meta.title} description={connection ? connection.name : meta.description} />
          {health?.ok === false && (
            <div className="mt-1 text-xs text-destructive">Error: {health.error}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {healthDot && (
            <span title={healthTitle} className={cn('size-2 shrink-0 rounded-full', healthDot)} />
          )}
          {connection ? (health?.ok === false ? <ConnectionErrorBadge /> : <ConnectedBadge />) : <NotSetBadge />}
          <Button size="sm" variant={connection ? 'ghost' : 'default'} onClick={() => openSetupModal(kind)}>
            {connection ? 'Edit' : 'Connect'}
          </Button>
          {connection && <DeleteBtn onClick={() => setPendingDelete({ id: connection.id })} />}
        </div>
      </SettingRow>
    );
  }

  function SetupModal() {
    if (!activeSetup) return null;
    const meta = SETUP_META[activeSetup];
    const existing = connections.find(c => c.purpose === activeSetup);

    const selectedPreset = activeSetup === 'mcp' && mcpPreset !== 'custom'
      ? MCP_PRESETS.find(p => p.id === mcpPreset)
      : null;

    return (
      <Dialog open onOpenChange={open => { if (!open) closeSetupModal(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedPreset ? selectedPreset.name : meta.title}</DialogTitle>
            <DialogDescription>{selectedPreset ? selectedPreset.description : meta.description}</DialogDescription>
          </DialogHeader>

          {existing && activeSetup !== 'mcp' && (
            <div className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground">{existing.name}</div>
                <ConnectedBadge />
              </div>
              <DeleteBtn onClick={() => { setPendingDelete({ id: existing.id }); closeSetupModal(); }} />
            </div>
          )}

          {existing && activeSetup !== 'mcp' ? (
            <div className="flex justify-end">
              <Button variant="ghost" onClick={closeSetupModal}>Close</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <Label>Name</Label>
                <Input value={setupName} onChange={e => setSetupName(e.target.value)} className="text-sm" />
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
                              <Input placeholder={preset.extraArgPlaceholder} value={mcpExtraArg} onChange={e => setMcpExtraArg(e.target.value)} className="text-sm" />
                            </div>
                          )}
                          {(preset.envVars ?? []).map(v => (
                            <div key={v.key}>
                              <Label>{v.label}</Label>
                              <Input type="password" placeholder={v.placeholder} value={mcpEnvValues[v.key] ?? ''} onChange={e => setMcpEnvValues(prev => ({ ...prev, [v.key]: e.target.value }))} className="text-sm" />
                            </div>
                          ))}
                          {!preset.extraArgLabel && (preset.envVars ?? []).length === 0 && (
                            <p className="text-sm text-muted-foreground">No configuration needed — just save to add this server.</p>
                          )}
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <>
                    <div><Label>Command</Label><Input placeholder="npx" value={mcpCommand} onChange={e => setMcpCommand(e.target.value)} className="text-sm" /></div>
                    <div><Label>Args JSON</Label><Textarea rows={2} placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]' value={mcpArgs} onChange={e => setMcpArgs(e.target.value)} className="text-sm font-mono resize-y" /></div>
                    <div><Label>Env JSON</Label><Textarea rows={2} placeholder='{"TOKEN":"..."}' value={mcpEnv} onChange={e => setMcpEnv(e.target.value)} className="text-sm font-mono resize-y" /></div>
                  </>
                )
              ) : (
                <div>
                  <Label>{meta.secretLabel}{meta.secretOptional ? ' (optional)' : ''}</Label>
                  <Input type="password" placeholder={meta.placeholder} value={secret} onChange={e => setSecret(e.target.value)} className="text-sm" />
                  {meta.secretOptionalHint && <p className="mt-1 text-xs text-muted-foreground">{meta.secretOptionalHint}</p>}
                </div>
              )}
              {setupError && <div className="text-sm text-destructive">{setupError}</div>}
              <DialogFooter>
                <Button variant="ghost" onClick={closeSetupModal}>Cancel</Button>
                <Button onClick={() => createConnMutation.mutate()}>Save</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        className="border-b-0 pb-0"
      />

      {/* Tab strip */}
      <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-border-soft px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'border-b-2 px-1 pb-3 pt-3 text-sm font-medium whitespace-nowrap transition-colors',
              'mx-3 first:ml-0',
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-fg-soft',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <PageBody>
        <ContentColumn className="max-w-3xl">

          {/* ── Agents ─────────────────────────────────── */}
          {tab === 'agents' && (
            <div className="flex flex-col gap-7">
              <div>
                <SectionLabel>Lead agent</SectionLabel>
                <ConnectionRow kind="lead_agent" />
              </div>

              <div>
                <SectionLabel>Permissions</SectionLabel>
                <div className="rounded-lg border border-border-soft bg-card p-4 flex flex-col gap-4">
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <Label className="text-xs">Permission profile</Label>
                      <Select value={permissionProfile} onValueChange={value => setPermissionProfile(value as PermissionProfile)}>
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fast">Fast</SelectItem>
                          <SelectItem value="trusted">Trusted</SelectItem>
                          <SelectItem value="strict">Strict</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      className="h-9 gap-1.5 text-xs"
                      onClick={() => updateSettingsMutation.mutate({ projects_root: projectsRoot, permission_profile: permissionProfile })}
                    >
                      <Check size={13} strokeWidth={2.2} />
                      Save
                    </Button>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground/70">
                    Fast keeps delegated agents non-interactive with a minimal environment. Trusted restores full
                    environment inheritance for local-only work. Strict removes bypass flags and may require manual CLI approval.
                  </p>
                </div>
              </div>

              <div>
                <SectionLabel>Agent budgets</SectionLabel>
                <div className="rounded-lg border border-border-soft bg-card p-4 flex flex-col gap-4">
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <Label className="text-xs">Claude Code monthly (USD)</Label>
                      <Input type="number" min="0" step="0.01" placeholder="No limit" value={claudeCodeBudget} onChange={e => setClaudeCodeBudget(e.target.value)} className="mt-1 text-sm" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Codex monthly (USD)</Label>
                      <Input type="number" min="0" step="0.01" placeholder="No limit" value={codexBudget} onChange={e => setCodexBudget(e.target.value)} className="mt-1 text-sm" />
                    </div>
                  </div>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <Label className="text-xs">Claude Code daily (USD)</Label>
                      <Input type="number" min="0" step="0.01" placeholder="No limit" value={claudeCodeDailyBudget} onChange={e => setClaudeCodeDailyBudget(e.target.value)} className="mt-1 text-sm" />
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Codex daily (USD)</Label>
                      <Input type="number" min="0" step="0.01" placeholder="No limit" value={codexDailyBudget} onChange={e => setCodexDailyBudget(e.target.value)} className="mt-1 text-sm" />
                    </div>
                    <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={saveAgentBudgets}>
                      <Check size={13} strokeWidth={2.2} />
                      Save
                    </Button>
                  </div>
                  {agentBudgetsError && <div className="text-sm text-destructive">{agentBudgetsError}</div>}
                  <p className="text-xs leading-relaxed text-muted-foreground/70">
                    Set monthly and/or daily spend caps for each coding agent. Daily caps reset at UTC midnight; monthly caps reset on the 1st. Leave blank for no limit.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Tools ──────────────────────────────────── */}
          {tab === 'tools' && (
            <div className="flex flex-col gap-3">
              <SectionLabel>Coding tools</SectionLabel>
              <ConnectionRow kind="claude_code" />
              <ConnectionRow kind="codex" />
            </div>
          )}

          {/* ── MCP ────────────────────────────────────── */}
          {tab === 'mcp' && (
            <div className="flex flex-col gap-6">
              {mcpConnections.length > 0 && (
                <div className="flex flex-col gap-3">
                  <SectionLabel>Connected</SectionLabel>
                  {mcpConnections.map(c => (
                    <SettingRow key={c.id}>
                      <SettingRowInfo title={c.name} description="MCP server" />
                      <div className="flex items-center gap-2 shrink-0">
                        <ConnectedBadge />
                        <DeleteBtn onClick={() => setPendingDelete({ id: c.id })} />
                      </div>
                    </SettingRow>
                  ))}
                </div>
              )}

              <div>
                <SectionLabel>Add a server</SectionLabel>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {MCP_PRESETS.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openMcpPresetModal(p.id)}
                      className="group flex flex-col gap-1 rounded-lg border border-border-soft bg-card p-3.5 text-left transition-colors hover:border-border hover:bg-muted/40"
                    >
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                      <span className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{p.description}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => openSetupModal('mcp')}
                    className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/20 p-3.5 text-muted-foreground transition-colors hover:border-border-soft hover:bg-muted/40 hover:text-foreground"
                  >
                    <Plus size={16} />
                    <span className="text-sm font-medium">Custom</span>
                  </button>
                </div>
                <HintText>MCP servers run as child processes and expose extra tools to the agent.</HintText>
              </div>
            </div>
          )}

          {/* ── Workspace ──────────────────────────────── */}
          {tab === 'workspace' && (
            <div className="flex flex-col gap-7">
              <div>
                <SectionLabel>Projects root</SectionLabel>
                <div className="rounded-lg border border-border-soft bg-card p-4 flex flex-col gap-3">
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <Label className="text-xs">Directory path</Label>
                      <Input
                        placeholder="/Users/you/projects"
                        value={projectsRoot}
                        onChange={e => setProjectsRoot(e.target.value)}
                        className="mt-1 text-sm font-mono"
                      />
                    </div>
                    <Button size="sm" className="h-9 gap-1.5 text-xs" onClick={() => updateSettingsMutation.mutate({ projects_root: projectsRoot })}>
                      <Check size={13} strokeWidth={2.2} />
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-9 text-xs" onClick={() => { setProjectsRoot(''); updateSettingsMutation.mutate({ projects_root: '' }); }}>
                      Reset
                    </Button>
                  </div>
                  {projectsRootError && <div className="text-sm text-destructive">{projectsRootError}</div>}
                  <HintText>New repo-backed projects are created here. Keep the default, or point to a workspace location such as <code>~/code</code>.</HintText>
                </div>
              </div>

              <div>
                <SectionLabel>Scheduled tasks</SectionLabel>
                {scheduledTasks.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                    No scheduled tasks.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {scheduledTasks.map(task => {
                      const intervalVal = taskIntervals[task.id] ?? String(task.interval_hours);
                      const intervalDirty = intervalVal !== String(task.interval_hours);
                      const nextRun = task.enabled ? new Date(task.next_run_at * 1000).toLocaleString() : null;
                      return (
                        <div key={task.id} className="rounded-lg border border-border-soft bg-card p-4 flex flex-col gap-3">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-foreground">
                                {task.type === 'reorganize_memory' ? 'Memory reorganization' : task.type}
                              </div>
                              <div className="mt-0.5 text-xs text-faint-fg">
                                {task.last_run_at ? `Last ran ${new Date(task.last_run_at * 1000).toLocaleString()}` : 'Never run'}
                                {nextRun && ` · Next: ${nextRun}`}
                              </div>
                              {task.prompt && (
                                <div className="mt-1 truncate text-xs text-muted-foreground/60" title={task.prompt}>
                                  {task.prompt}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => runTaskMutation.mutate(task.id)}>
                                <Play size={11} />
                                Run now
                              </Button>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!task.enabled}
                                  onChange={e => updateTaskMutation.mutate({ id: task.id, body: { enabled: e.target.checked } })}
                                  className="h-4 w-4 rounded border-border bg-background accent-primary"
                                />
                                <span className="text-xs text-muted-foreground">On</span>
                              </label>
                              <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => deleteTaskMutation.mutate(task.id)}>
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground shrink-0">Every</span>
                            <Input
                              type="number"
                              min="1"
                              className="h-7 w-20 text-xs"
                              value={intervalVal}
                              onChange={e => setTaskIntervals(prev => ({ ...prev, [task.id]: e.target.value }))}
                            />
                            <span className="text-xs text-muted-foreground shrink-0">hours</span>
                            {intervalDirty && (
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  const hours = Number(intervalVal);
                                  if (!Number.isFinite(hours) || hours < 1) return;
                                  updateTaskMutation.mutate({ id: task.id, body: { interval_hours: hours } });
                                  setTaskIntervals(prev => { const n = { ...prev }; delete n[task.id]; return n; });
                                }}
                              >
                                Save
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Memory ─────────────────────────────────── */}
          {tab === 'memory' && (
            <div className="flex flex-col gap-5">
              <SectionLabel>Stored memory</SectionLabel>
              {memory.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  No memory stored yet.
                </div>
              ) : (
                (['user', 'feedback', 'project', 'reference'] as const).map(type => {
                  const entries = memory.filter(m => m.type === type);
                  if (entries.length === 0) return null;
                  return (
                    <div key={type}>
                      <div className="mb-2 text-[11px] font-semibold capitalize text-faint-fg">{type}</div>
                      <div className="flex flex-col gap-1.5">
                        {entries.map(m => (
                          <div key={`${m.type}-${m.key}`} className="flex items-start gap-4 rounded-lg border border-border-soft bg-card px-4 py-3">
                            <div className="w-36 shrink-0 font-mono text-xs text-muted-foreground">
                              {m.key}
                              {m.type === 'project' && (
                                <div className="mt-0.5 font-sans text-[11px] text-faint-fg">
                                  {projects.find(p => p.id === m.project_id)?.name ?? m.project_id}
                                </div>
                              )}
                            </div>
                            <div className="flex-1 text-sm text-fg-soft">{m.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ── Account ────────────────────────────────── */}
          {tab === 'account' && (
            <div className="flex flex-col gap-3">
              <SectionLabel>Appearance</SectionLabel>
              <AppearanceSection />
              <SectionLabel>Account</SectionLabel>
              <ConnectMobileSection />
              <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-4">
                <div>
                  <div className="text-sm font-medium text-foreground">Sign out</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">You will be returned to the login screen.</div>
                </div>
                <Button variant="destructive" size="sm" onClick={handleSignOut}>Sign out</Button>
              </div>
            </div>
          )}

        </ContentColumn>
      </PageBody>

      {pendingDelete && (
        <ConfirmDialog
          title="Remove connection?"
          description="This will disconnect the integration. You can reconnect it at any time."
          confirmLabel="Delete"
          onConfirm={() => { deleteConnMutation.mutate(pendingDelete.id); setPendingDelete(null); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      <SetupModal />
    </PageShell>
  );
}
