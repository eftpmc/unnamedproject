import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Moon, Play, Plus, Sun, Trash2 } from 'lucide-react';
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
  createAgentProvider,
  deleteConnection,
  deleteAgentProvider,
  deleteScheduledTask,
  disconnectGoogle,
  enableChrome,
  disableChrome,
  getChromeStatus,
  getConnections,
  getAgentProviders,
  getGoogleAuthUrl,
  getGoogleStatus,
  getMemory,
  getProjects,
  getScheduledTasks,
  getSettings,
  runScheduledTask,
  testAgentProvider,
  testConnection,
  updateSettings,
} from '../lib/api.js';
import { usePageTitle } from '../lib/usePageTitle.js';
import { useTheme } from '../lib/useTheme.js';
import { useAccent } from '../lib/useAccent.js';
import { ACCENT_PRESETS, DEFAULT_ACCENT } from '../lib/accent.js';
import type { AgentProvider, Connection, GoogleAccount, Memory, PermissionProfile, Project, ScheduledTask, UserSettings } from '../types.js';

type Section = 'tools' | 'mcp' | 'workspace' | 'memory' | 'appearance';
const SETTINGS_SECTIONS: Section[] = ['tools', 'mcp', 'workspace', 'memory', 'appearance'];
const SECTION_TITLES: Record<Section, string> = {
  tools: 'Tools',
  mcp: 'MCP',
  workspace: 'Workspace',
  memory: 'Memory',
  appearance: 'Appearance',
};

type SetupKind = 'claude_code' | 'codex' | 'mcp';

const SETUP_META: Record<SetupKind, { title: string; description: string; type: string }> = {
  claude_code: {
    title: 'Claude Code',
    description: 'Powers your conversations. Handles all tasks — coding, research, orchestration.',
    type: 'claude_code',
  },
  codex: {
    title: 'Codex',
    description: 'Powers your conversations using the OpenAI Codex CLI.',
    type: 'codex',
  },
  mcp: {
    title: 'MCP Server',
    description: 'Adds extra tools that can be attached to workspaces.',
    type: 'mcp',
  },
};

interface SetupFormState {
  setupName: string;
  mcpCommand: string;
  mcpArgs: string;
  mcpEnv: string;
  mcpPreset: string;
  mcpExtraArg: string;
  mcpEnvValues: Record<string, string>;
  providerModel: string;
  providerPermissionProfile: 'default' | 'fast' | 'strict';
}

const INITIAL_SETUP_FORM: SetupFormState = {
  setupName: '',
  mcpCommand: '',
  mcpArgs: '',
  mcpEnv: '{}',
  mcpPreset: 'custom',
  mcpExtraArg: '',
  mcpEnvValues: {},
  providerModel: '',
  providerPermissionProfile: 'default',
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
  // Browser
  { id: 'playwright', name: 'Playwright', description: 'Full browser control — navigate, click, fill forms, screenshot. Essential for web scraping and automation.', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
  { id: 'puppeteer', name: 'Puppeteer', description: 'Headless Chrome browser automation and screenshots.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
  // Dev tools
  { id: 'github', name: 'GitHub', description: 'GitHub API — repos, PRs, issues, code search, and more.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envVars: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'Personal access token', placeholder: 'ghp_...' }] },
  // Communication
  // Note: @modelcontextprotocol/server-slack is deprecated — using community replacement
  { id: 'slack', name: 'Slack', description: 'Read and post Slack messages, list channels. Requires a Slack app with a bot token.', command: 'npx', args: ['-y', '@nrjdalal/slack-mcp-server'], envVars: [{ key: 'SLACK_BOT_TOKEN', label: 'Bot token', placeholder: 'xoxb-...' }] },
  // Productivity
  { id: 'notion', name: 'Notion', description: 'Read and write Notion pages and databases. Create an internal integration at notion.so/my-integrations.', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], envVars: [{ key: 'NOTION_TOKEN', label: 'Integration token', placeholder: 'ntn_...' }] },
  { id: 'airtable', name: 'Airtable', description: 'Read and write Airtable bases and tables.', command: 'npx', args: ['-y', 'airtable-mcp-server'], envVars: [{ key: 'AIRTABLE_API_KEY', label: 'Personal access token', placeholder: 'pat...' }] },
  // Search & data
  // Note: @modelcontextprotocol/server-brave-search is deprecated — using official Brave package
  { id: 'brave-search', name: 'Brave Search', description: 'Web search via the Brave Search API. Get a free API key at brave.com/search/api.', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'], envVars: [{ key: 'BRAVE_API_KEY', label: 'Brave API key' }] },
  { id: 'postgres', name: 'Postgres', description: 'Read-only schema inspection and queries against a Postgres database.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], extraArgLabel: 'Connection string', extraArgPlaceholder: 'postgresql://user:pass@host:5432/db' },
  // Reasoning
  { id: 'sequential-thinking', name: 'Sequential Thinking', description: 'Structured step-by-step reasoning tool for complex problems.', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
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
  return <div className="mb-3 text-sm font-medium text-foreground">{children}</div>;
}

function SettingRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border border-border-soft bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4', className)}>
      {children}
    </div>
  );
}

function ChromeBrowserSection({ connections, onConnectionsChanged }: { connections: Connection[]; onConnectionsChanged: () => void }) {
  const qc = useQueryClient();
  const chromeConn = connections.find(c => c.type === 'chrome');

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['chrome-status'],
    queryFn: getChromeStatus,
    refetchInterval: chromeConn ? 8000 : false,
    staleTime: 5000,
  });

  const enableMutation = useMutation({
    mutationFn: enableChrome,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['connections'] }); onConnectionsChanged(); refetchStatus(); },
  });

  const disableMutation = useMutation({
    mutationFn: () => disableChrome(chromeConn!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['connections'] }); onConnectionsChanged(); refetchStatus(); },
  });

  const statusLabel = !chromeConn
    ? null
    : status?.debugPortOpen
      ? 'Connected via CDP'
      : status?.chromeRunning
        ? 'Chrome running — no debug port'
        : 'Chrome not running';

  const statusColor = !chromeConn
    ? null
    : status?.debugPortOpen
      ? 'text-success'
      : status?.chromeRunning
        ? 'text-warning'
        : 'text-muted-foreground';

  return (
    <div>
      <SectionLabel>Chrome Browser</SectionLabel>
      <SettingRow>
        <div className="min-w-0">
          <SettingRowInfo title="Chrome Browser" description={chromeConn ? (statusLabel ?? 'Checking…') : 'Control your real Chrome browser with all your sign-ins and cookies.'} />
          {chromeConn && statusLabel && (
            <div className={`mt-1 text-xs ${statusColor ?? ''}`}>{statusLabel}</div>
          )}
          {chromeConn && status?.chromeRunning && !status.debugPortOpen && (
            <div className="mt-1 text-xs text-muted-foreground/70">
              The agent will ask to restart Chrome when it needs browser access.
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
          {chromeConn && <ConnectedBadge />}
          {chromeConn ? (
            <Button size="sm" variant="ghost" onClick={() => disableMutation.mutate()} disabled={disableMutation.isPending}>
              Disable
            </Button>
          ) : (
            <Button size="sm" onClick={() => enableMutation.mutate()} disabled={enableMutation.isPending}>
              Enable
            </Button>
          )}
        </div>
      </SettingRow>
      <HintText>
        Tries to attach to Chrome on port 9222 first (CDP). If Chrome is not running, launches it with your real profile.
        If Chrome is already running without a debug port, the agent will ask permission before restarting it.
      </HintText>
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

function ProviderRow({
  kind,
  providers,
  onOpenSetup,
  onRequestDelete,
}: {
  kind: 'claude_code' | 'codex';
  providers: AgentProvider[];
  onOpenSetup: (kind: SetupKind) => void;
  onRequestDelete: (id: string) => void;
}) {
  const meta = SETUP_META[kind];
  const provider = providers.find(p => p.type === kind);
  const { data: health } = useQuery({
    queryKey: ['provider-health', provider?.id],
    queryFn: () => testAgentProvider(provider!.id),
    enabled: !!provider,
    staleTime: 60_000,
    retry: false,
  });
  const healthDot = provider && health !== undefined
    ? health.ok === true ? 'bg-success' : health.ok === false ? 'bg-destructive' : null
    : null;
  const healthTitle = health?.ok === true
    ? `Connected · ${health.latencyMs}ms`
    : health?.ok === false ? `Error: ${health.error}` : undefined;

  return (
    <SettingRow>
      <div className="min-w-0">
        <SettingRowInfo title={meta.title} description={provider ? provider.name : meta.description} />
        {health?.ok === false && <div className="mt-1 text-xs text-destructive">Error: {health.error}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
        {healthDot && <span title={healthTitle} className={cn('size-2 shrink-0 rounded-full', healthDot)} />}
        {provider ? (health?.ok === false ? <ConnectionErrorBadge /> : <ConnectedBadge />) : <NotSetBadge />}
        <Button size="sm" variant={provider ? 'ghost' : 'default'} onClick={() => onOpenSetup(kind)}>
          {provider ? 'Edit' : 'Connect'}
        </Button>
        {provider && <DeleteBtn onClick={() => onRequestDelete(provider.id)} />}
      </div>
    </SettingRow>
  );
}

function SetupModal({
  activeSetup,
  providers,
  connections,
  form,
  updateForm,
  setupError,
  onClose,
  onSave,
  onDelete,
}: {
  activeSetup: SetupKind | null;
  providers: AgentProvider[];
  connections: Connection[];
  form: SetupFormState;
  updateForm: (patch: Partial<SetupFormState>) => void;
  setupError: string;
  onClose: () => void;
  onSave: () => void;
  onDelete: (id: string) => void;
}) {
  if (!activeSetup) return null;
  const meta = SETUP_META[activeSetup];
  const existing = activeSetup === 'mcp'
    ? connections.find(c => c.purpose === activeSetup)
    : providers.find(p => p.type === activeSetup);
  const { setupName, mcpCommand, mcpArgs, mcpEnv, mcpPreset, mcpExtraArg, mcpEnvValues, providerModel, providerPermissionProfile } = form;

  const selectedPreset = activeSetup === 'mcp' && mcpPreset !== 'custom'
    ? MCP_PRESETS.find(p => p.id === mcpPreset)
    : null;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{selectedPreset ? selectedPreset.name : meta.title}</DialogTitle>
          <DialogDescription>{selectedPreset ? selectedPreset.description : meta.description}</DialogDescription>
        </DialogHeader>

        {existing && activeSetup !== 'mcp' && (
          <div className="flex items-center gap-3 rounded-lg border border-border-soft bg-card px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-foreground">{existing.name}</div>
              <div className="mt-1 flex items-center gap-2">
                <ConnectedBadge />
              </div>
            </div>
            <DeleteBtn onClick={() => onDelete(existing.id)} />
          </div>
        )}

        {existing && activeSetup !== 'mcp' ? (
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <Label>Name</Label>
              <Input value={setupName} onChange={e => updateForm({ setupName: e.target.value })} className="text-sm" />
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
                            <Input placeholder={preset.extraArgPlaceholder} value={mcpExtraArg} onChange={e => updateForm({ mcpExtraArg: e.target.value })} className="text-sm" />
                          </div>
                        )}
                        {(preset.envVars ?? []).map(v => (
                          <div key={v.key}>
                            <Label>{v.label}</Label>
                            <Input type="password" placeholder={v.placeholder} value={mcpEnvValues[v.key] ?? ''} onChange={e => updateForm({ mcpEnvValues: { ...mcpEnvValues, [v.key]: e.target.value } })} className="text-sm" />
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
                  <div><Label>Command</Label><Input placeholder="npx" value={mcpCommand} onChange={e => updateForm({ mcpCommand: e.target.value })} className="text-sm" /></div>
                  <div><Label>Args JSON</Label><Textarea rows={2} placeholder='["-y", "@modelcontextprotocol/server-filesystem", "/path"]' value={mcpArgs} onChange={e => updateForm({ mcpArgs: e.target.value })} className="text-sm font-mono resize-y" /></div>
                  <div><Label>Env JSON</Label><Textarea rows={2} placeholder='{"TOKEN":"..."}' value={mcpEnv} onChange={e => updateForm({ mcpEnv: e.target.value })} className="text-sm font-mono resize-y" /></div>
                </>
              )
            ) : (
              <>
                <div>
                  <Label>Model</Label>
                  <Input
                    placeholder={activeSetup === 'claude_code' ? 'claude-sonnet-4-6' : 'Use Codex account default'}
                    value={providerModel}
                    onChange={e => updateForm({ providerModel: e.target.value })}
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label>Permission profile</Label>
                  <Select value={providerPermissionProfile} onValueChange={value => updateForm({ providerPermissionProfile: value as 'default' | 'fast' | 'strict' })}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default</SelectItem>
                      <SelectItem value="fast">Fast</SelectItem>
                      <SelectItem value="strict">Strict</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            {setupError && <div className="text-sm text-destructive">{setupError}</div>}
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={onSave}>Save</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Settings() {
  usePageTitle('Settings');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { section: sectionParam } = useParams<{ section?: string }>();
  const section = SETTINGS_SECTIONS.includes(sectionParam as Section) ? (sectionParam as Section) : 'tools';

  const { data: connections = [] } = useQuery<Connection[]>({ queryKey: ['connections'], queryFn: getConnections });
  const { data: agentProviders = [] } = useQuery<AgentProvider[]>({ queryKey: ['agent-providers'], queryFn: getAgentProviders });
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ['projects'], queryFn: () => getProjects() });
  const { data: memory = [] } = useQuery<Memory[]>({ queryKey: ['memory'], queryFn: getMemory });
  const { data: scheduledTasks = [] } = useQuery<ScheduledTask[]>({ queryKey: ['scheduledTasks'], queryFn: getScheduledTasks });
  const { data: settings } = useQuery<UserSettings>({ queryKey: ['settings'], queryFn: getSettings });
  const [activeSetup, setActiveSetup] = useState<SetupKind | null>(null);
  const [form, setForm] = useState<SetupFormState>(INITIAL_SETUP_FORM);
  const updateForm = (patch: Partial<SetupFormState>) => setForm(prev => ({ ...prev, ...patch }));
  const [setupError, setSetupError] = useState('');

  const [projectsRoot, setProjectsRoot] = useState('');
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>('fast');
  const [pendingDelete, setPendingDelete] = useState<{ id: string } | null>(null);
  const [projectsRootError, setProjectsRootError] = useState('');

  // Google connect dialog state
  const [googleConnectDialog, setGoogleConnectDialog] = useState<{ service: string; label: string } | null>(null);

  const mcpConnections = connections.filter(c => c.purpose === 'mcp');

  const { data: googleStatus = {} } = useQuery<Record<string, GoogleAccount[]>>({
    queryKey: ['google-status'],
    queryFn: getGoogleStatus,
  });

  const disconnectGoogleMutation = useMutation({
    mutationFn: (id: string) => disconnectGoogle(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['google-status'] }),
  });

  const [googleError, setGoogleError] = useState('');

  // Handle redirect back from Google OAuth
  useEffect(() => {
    if (sectionParam && !SETTINGS_SECTIONS.includes(sectionParam as Section)) {
      navigate('/settings/tools', { replace: true });
    }
  }, [navigate, sectionParam]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('google_connected');
    const error = params.get('google_error');
    if (connected || error) {
      if (connected) {
        qc.invalidateQueries({ queryKey: ['google-status'] });
        navigate('/settings/mcp', { replace: true });
      } else if (error) {
        setGoogleError(error);
        navigate('/settings/mcp', { replace: true });
      }
    }
  }, [qc]);

  useEffect(() => {
    if (settings?.projects_root) setProjectsRoot(settings.projects_root);
    if (settings?.permission_profile) setPermissionProfile(settings.permission_profile);
  }, [settings]);

  const createConnMutation = useMutation({
    mutationFn: () => {
      if (!activeSetup) throw new Error('Pick what you want to set up');
      const meta = SETUP_META[activeSetup];
      const { setupName, mcpCommand, mcpArgs, mcpEnv, mcpPreset, mcpExtraArg, mcpEnvValues, providerModel, providerPermissionProfile } = form;

      if (activeSetup === 'claude_code' || activeSetup === 'codex') {
        const defaultModel = activeSetup === 'claude_code' ? 'claude-sonnet-4-6' : '';
        const resolvedModel = providerModel.trim() || defaultModel;
        return createAgentProvider({
          name: setupName.trim() || meta.title,
          type: activeSetup,
          config: { ...(resolvedModel ? { model: resolvedModel } : {}), permissionProfile: providerPermissionProfile },
        });
      }

      const preset = MCP_PRESETS.find(p => p.id === mcpPreset);
      let config: Record<string, unknown>;
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
      return createConnection({ name: setupName.trim() || meta.title, type: meta.type, purpose: activeSetup, config });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['agent-providers'] });
      closeSetupModal();
    },
    onError: (e: Error) => setSetupError(e.message),
  });

  const deleteConnMutation = useMutation({
    mutationFn: (id: string) => {
      // Determine if this is a provider or connection by checking both lists
      const isProvider = agentProviders.some(p => p.id === id);
      return isProvider ? deleteAgentProvider(id) : deleteConnection(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connections'] });
      qc.invalidateQueries({ queryKey: ['agent-providers'] });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (body: { projects_root: string; permission_profile?: PermissionProfile }) => updateSettings(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e: Error) => setProjectsRootError(e.message),
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
    setForm({ ...INITIAL_SETUP_FORM, setupName: SETUP_META[kind].title });
    setSetupError('');
  }

  function openMcpPresetModal(presetId: string) {
    const preset = MCP_PRESETS.find(p => p.id === presetId);
    setActiveSetup('mcp');
    setForm({ ...INITIAL_SETUP_FORM, setupName: preset ? preset.name : SETUP_META.mcp.title, mcpPreset: presetId });
    setSetupError('');
  }

  function closeSetupModal() {
    setActiveSetup(null);
    setForm(INITIAL_SETUP_FORM);
    setSetupError('');
  }

  return (
    <PageShell>
      <PageHeader
        title={SECTION_TITLES[section]}
        breadcrumb="Settings"
        className="px-4 pt-6 sm:px-8 sm:pt-10"
        contentClassName="max-w-5xl"
        titleClassName="text-2xl sm:text-3xl"
      />

      <PageBody className="px-4 pt-5 sm:px-8 sm:pt-9">
        <ContentColumn className="max-w-5xl">
          <div className="flex flex-col gap-8">

          {/* ── Tools ──────────────────────────────────── */}
          {section === 'tools' && (
            <div className="flex flex-col gap-7">
              <div>
                <SectionLabel>Coding tools</SectionLabel>
                <div className="flex flex-col gap-3">
                  <ProviderRow kind="claude_code" providers={agentProviders} onOpenSetup={openSetupModal} onRequestDelete={id => setPendingDelete({ id })} />
                  <ProviderRow kind="codex" providers={agentProviders} onOpenSetup={openSetupModal} onRequestDelete={id => setPendingDelete({ id })} />
                </div>
              </div>
              <div>
                <SectionLabel>Permissions</SectionLabel>
                <div className="flex flex-col gap-4 rounded-lg border border-border-soft bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
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
                      className="h-9 gap-1.5 text-xs sm:self-end"
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
            </div>
          )}

          {/* ── MCP ────────────────────────────────────── */}
          {section === 'mcp' && (
            <div className="flex flex-col gap-6">

              {/* Chrome Browser */}
              <ChromeBrowserSection connections={connections} onConnectionsChanged={() => qc.invalidateQueries({ queryKey: ['connections'] })} />

              {/* Google services */}
              <div>
                <SectionLabel>Google</SectionLabel>
                {googleError && <p className="mb-2 text-xs text-destructive">{googleError}</p>}
                <div className="flex flex-col gap-3">
                  {(['gmail', 'drive'] as const).map(svc => {
                    const accounts: GoogleAccount[] = googleStatus[svc] ?? [];
                    const label = svc === 'gmail' ? 'Gmail' : 'Google Drive';
                    const description = svc === 'gmail' ? 'Read, send, and search email' : 'List, read, and create files';
                    return (
                      <div key={svc} className="flex flex-col gap-2">
                        {accounts.length > 0 ? accounts.map(acct => (
                          <SettingRow key={acct.id}>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-foreground">{label}</div>
                              <div className="text-xs text-muted-foreground">{acct.email}{acct.name !== svc ? ` · ${acct.name}` : ''}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
                              <ConnectedBadge />
                              <DeleteBtn onClick={() => disconnectGoogleMutation.mutate(acct.id)} />
                            </div>
                          </SettingRow>
                        )) : (
                          <SettingRow>
                            <SettingRowInfo title={label} description={description} />
                            <div className="shrink-0 self-start sm:self-center">
                              <Button size="sm" onClick={() => setGoogleConnectDialog({ service: svc, label: svc })}>Connect</Button>
                            </div>
                          </SettingRow>
                        )}
                        {accounts.length > 0 && (
                          <div className="flex justify-end">
                            <Button size="sm" variant="ghost" onClick={() => setGoogleConnectDialog({ service: svc, label: '' })}>
                              <Plus size={13} className="mr-1" />Add account
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <HintText>Requires <code className="text-xs">GOOGLE_CLIENT_ID</code> and <code className="text-xs">GOOGLE_CLIENT_SECRET</code> in your server .env.</HintText>
              </div>

              {mcpConnections.length > 0 && (
                <div className="flex flex-col gap-3">
                  <SectionLabel>Connected MCP servers</SectionLabel>
                  {mcpConnections.map(c => (
                    <SettingRow key={c.id}>
                      <SettingRowInfo title={c.name} description="MCP server" />
                      <div className="flex shrink-0 items-center gap-2 self-start sm:self-center">
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
          {section === 'workspace' && (
            <div className="flex flex-col gap-7">
              <div>
                <SectionLabel>Projects repository root</SectionLabel>
                <div className="flex flex-col gap-3 rounded-lg border border-border-soft bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1">
                      <Label className="text-xs">Directory path</Label>
                      <Input
                        placeholder="/Users/you/projects"
                        value={projectsRoot}
                        onChange={e => setProjectsRoot(e.target.value)}
                        className="mt-1 text-sm font-mono"
                      />
                    </div>
                    <Button size="sm" className="h-9 gap-1.5 text-xs sm:self-end" onClick={() => updateSettingsMutation.mutate({ projects_root: projectsRoot })}>
                      <Check size={13} strokeWidth={2.2} />
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" className="h-9 text-xs sm:self-end" onClick={() => { setProjectsRoot(''); updateSettingsMutation.mutate({ projects_root: '' }); }}>
                      Reset
                    </Button>
                  </div>
                  {projectsRootError && <div className="text-sm text-destructive">{projectsRootError}</div>}
                  <HintText>Repositories created for new projects are stored here. Keep the default, or point to a workspace location such as <code>~/code</code>.</HintText>
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
                      const nextRun = task.enabled ? new Date(task.next_run_at * 1000).toLocaleString() : null;
                      return (
                        <div key={task.id} className="flex flex-col gap-3 rounded-lg border border-border-soft bg-card p-4">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
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
                            <div className="flex shrink-0 items-center gap-2">
                              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => runTaskMutation.mutate(task.id)}>
                                <Play size={11} />
                                Run now
                              </Button>
                              <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => deleteTaskMutation.mutate(task.id)}>
                                <Trash2 size={14} />
                              </Button>
                            </div>
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
          {section === 'memory' && (
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
                          <div key={`${m.type}-${m.key}`} className="flex flex-col gap-2 rounded-lg border border-border-soft bg-card px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                            <div className="shrink-0 font-mono text-xs text-muted-foreground sm:w-36">
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

          {/* ── Appearance ─────────────────────────────── */}
          {section === 'appearance' && (
            <div className="flex flex-col gap-3">
              <AppearanceSection />
            </div>
          )}

          </div>
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
      <SetupModal activeSetup={activeSetup} providers={agentProviders} connections={connections} form={form} updateForm={updateForm} setupError={setupError} onClose={closeSetupModal} onSave={() => createConnMutation.mutate()} onDelete={id => { setPendingDelete({ id }); closeSetupModal(); }} />

      {/* Google connect dialog */}
      {googleConnectDialog && (
        <Dialog open onOpenChange={open => { if (!open) setGoogleConnectDialog(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Connect {googleConnectDialog.service === 'gmail' ? 'Gmail' : 'Google Drive'}</DialogTitle>
              <DialogDescription>Choose a label to identify this account.</DialogDescription>
            </DialogHeader>
            <div>
              <Label>Label</Label>
              <Input
                placeholder={googleConnectDialog.service}
                value={googleConnectDialog.label}
                onChange={e => setGoogleConnectDialog(d => d ? { ...d, label: e.target.value } : null)}
                className="mt-1 text-sm"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setGoogleConnectDialog(null)}>Cancel</Button>
              <Button onClick={async () => {
                const { service, label } = googleConnectDialog;
                const resolvedLabel = label.trim() || service;
                setGoogleConnectDialog(null);
                const { url } = await getGoogleAuthUrl(service, resolvedLabel);
                window.location.href = url;
              }}>Connect</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </PageShell>
  );
}
