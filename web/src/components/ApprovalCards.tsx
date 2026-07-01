import { useState } from 'react';
import { ArrowRight, Cable, Clock, KeyRound, Package, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { approveExecution, rejectExecution } from '../lib/api.js';
import type { ApprovalUI } from '../types.js';

interface CardActionsProps {
  cancelLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function CardActions({ cancelLabel = 'Not now', confirmLabel, danger, disabled, onCancel, onConfirm }: CardActionsProps) {
  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        disabled={disabled}
        className="rounded-xl px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className={cn(
          'rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50',
          danger
            ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
            : 'bg-foreground text-background hover:bg-foreground/90',
        )}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

// ─── Question ──────────────────────────────────────────────────────────────

function QuestionCard({ ui, executionId, onDone }: { ui: Extract<ApprovalUI, { kind: 'question' }>; executionId: string; onDone: () => void }) {
  const isMulti = ui.type === 'multi';
  const isText = ui.type === 'text' || !ui.options?.length;
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [acting, setActing] = useState(false);

  function toggle(opt: string) {
    if (isMulti) {
      setSelected(prev => prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]);
    } else {
      setSelected([opt]);
    }
  }

  async function submit() {
    const value = isText ? text.trim() : selected.join(',');
    if (!value && !ui.skippable) return;
    setActing(true);
    try {
      await approveExecution(executionId, value || undefined);
      onDone();
    } finally { setActing(false); }
  }

  async function skip() {
    setActing(true);
    try { await rejectExecution(executionId); onDone(); } finally { setActing(false); }
  }

  const canSubmit = isText ? !!text.trim() : selected.length > 0;

  return (
    <div className="flex flex-col gap-4 p-5">
      {(ui.step !== undefined && ui.total !== undefined) && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Step {ui.step} of {ui.total}</span>
          {ui.skippable && (
            <button type="button" onClick={skip} disabled={acting} className="text-xs text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>
      )}
      <p className="text-[15px] font-medium leading-snug text-foreground">{ui.question}</p>

      {!isText && ui.options && (
        <div className="flex flex-col divide-y divide-border-soft overflow-hidden rounded-xl border border-border-soft">
          {ui.options.map(opt => {
            const checked = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                className={cn(
                  'flex items-center justify-between px-4 py-3 text-left text-sm transition-colors',
                  checked ? 'bg-foreground/5 text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )}
              >
                {opt}
                {checked && <span className="size-1.5 rounded-full bg-foreground" />}
              </button>
            );
          })}
        </div>
      )}

      {isText && (
        <input
          autoFocus
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={ui.skippable ? 'Type your answer or skip…' : 'Type your answer…'}
          className="w-full rounded-xl border border-border-soft bg-muted/30 px-4 py-2.5 text-sm text-foreground placeholder:text-faint-fg focus:outline-none focus:ring-1 focus:ring-border"
        />
      )}

      <div className="flex items-center justify-end gap-2">
        {ui.skippable && (
          <button type="button" onClick={skip} disabled={acting} className="rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50">
            Skip
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={acting || !canSubmit}
          className="flex items-center gap-1.5 rounded-xl bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40"
        >
          Continue <ArrowRight size={13} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

// ─── Connection ─────────────────────────────────────────────────────────────

const SERVICE_COLORS: Record<string, string> = {
  gmail: 'bg-red-500', github: 'bg-gray-800', linkedin: 'bg-blue-600',
  slack: 'bg-purple-600', notion: 'bg-gray-700', google: 'bg-blue-500',
};

function ConnectionCard({ ui, executionId, onDone }: { ui: Extract<ApprovalUI, { kind: 'connection' }>; executionId: string; onDone: () => void }) {
  const [acting, setActing] = useState(false);
  const slug = ui.name.toLowerCase().replace(/\s+/g, '');
  const color = SERVICE_COLORS[slug] ?? 'bg-muted';
  const initials = ui.name.slice(0, 2).toUpperCase();

  async function connect() {
    setActing(true);
    try { await approveExecution(executionId); onDone(); } finally { setActing(false); }
  }
  async function dismiss() {
    setActing(true);
    try { await rejectExecution(executionId); onDone(); } finally { setActing(false); }
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start gap-4">
        <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold text-white', color)}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-foreground">Connect to {ui.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{ui.description}</p>
          {ui.command && (
            <code className="mt-2 inline-block rounded-lg bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              {ui.command.length > 60 ? `${ui.command.slice(0, 57)}…` : ui.command}
            </code>
          )}
          {ui.url && !ui.command && (
            <p className="mt-1.5 font-mono text-[11px] text-faint-fg">{ui.url}</p>
          )}
        </div>
      </div>
      <CardActions cancelLabel="Not now" confirmLabel="Connect" disabled={acting} onCancel={dismiss} onConfirm={connect} />
    </div>
  );
}

// ─── Trigger preview ────────────────────────────────────────────────────────

function TriggerPreviewCard({ ui, executionId, onDone }: { ui: Extract<ApprovalUI, { kind: 'trigger_preview' }>; executionId: string; onDone: () => void }) {
  const [acting, setActing] = useState(false);

  async function create() {
    setActing(true);
    try { await approveExecution(executionId); onDone(); } finally { setActing(false); }
  }
  async function dismiss() {
    setActing(true);
    try { await rejectExecution(executionId); onDone(); } finally { setActing(false); }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Clock size={14} />
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Set up automation</span>
      </div>
      <div>
        <p className="text-[15px] font-semibold text-foreground">{ui.playbookTitle}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{ui.schedule}</p>
      </div>
      {ui.preview && (
        <p className="line-clamp-3 rounded-xl bg-muted/40 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {ui.preview}
        </p>
      )}
      <CardActions cancelLabel="Cancel" confirmLabel="Create" disabled={acting} onCancel={dismiss} onConfirm={create} />
    </div>
  );
}

// ─── Secret entry ───────────────────────────────────────────────────────────

function SecretEntryCard({ ui, executionId, onDone }: { ui: Extract<ApprovalUI, { kind: 'secret_entry' }>; executionId: string; onDone: () => void }) {
  const [value, setValue] = useState('');
  const [acting, setActing] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setActing(true);
    try { await approveExecution(executionId, value.trim()); onDone(); } finally { setActing(false); }
  }
  async function dismiss() {
    setActing(true);
    try { await rejectExecution(executionId); onDone(); } finally { setActing(false); }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <KeyRound size={14} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-foreground">{ui.label}</p>
          <p className="text-xs text-muted-foreground">{ui.description}</p>
        </div>
      </div>
      <input
        autoFocus
        type="password"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && save()}
        placeholder={ui.placeholder ?? 'Paste your secret here…'}
        className="w-full rounded-xl border border-border-soft bg-muted/30 px-4 py-2.5 font-mono text-sm text-foreground placeholder:text-faint-fg focus:outline-none focus:ring-1 focus:ring-border"
      />
      <CardActions cancelLabel="Cancel" confirmLabel="Save" disabled={acting || !value.trim()} onCancel={dismiss} onConfirm={save} />
    </div>
  );
}

// ─── Dependency ─────────────────────────────────────────────────────────────

function DependencyCard({ ui, executionId, onDone }: { ui: Extract<ApprovalUI, { kind: 'dependency' }>; executionId: string; onDone: () => void }) {
  const [acting, setActing] = useState(false);

  async function install() {
    setActing(true);
    try { await approveExecution(executionId); onDone(); } finally { setActing(false); }
  }
  async function dismiss() {
    setActing(true);
    try { await rejectExecution(executionId); onDone(); } finally { setActing(false); }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Package size={14} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-foreground">Install {ui.packageName}</p>
          <p className="text-xs text-muted-foreground">{ui.reason}</p>
        </div>
      </div>
      <code className="block overflow-x-auto rounded-xl bg-muted/50 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre">
        {ui.command}
      </code>
      <CardActions cancelLabel="Skip" confirmLabel="Install" disabled={acting} onCancel={dismiss} onConfirm={install} />
    </div>
  );
}

// ─── Tool package ──────────────────────────────────────────────────────────

function ToolPackageCard({ ui, executionId, onDone }: { ui: Extract<ApprovalUI, { kind: 'tool_package' }>; executionId: string; onDone: () => void }) {
  const [acting, setActing] = useState(false);
  const filesystem = ui.permissions?.filesystem?.join(', ') || 'none';
  const subprocess = ui.permissions?.subprocess?.join(', ') || 'none';
  const secrets = ui.permissions?.secrets?.join(', ') || 'none';

  async function install() {
    setActing(true);
    try { await approveExecution(executionId); onDone(); } finally { setActing(false); }
  }
  async function dismiss() {
    setActing(true);
    try { await rejectExecution(executionId); onDone(); } finally { setActing(false); }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Package size={14} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-foreground">Install {ui.name}</p>
          <p className="text-xs text-muted-foreground">{ui.reason || ui.description}</p>
        </div>
      </div>
      <div className="rounded-xl bg-muted/40 px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
        <div>runtime: {ui.runtime}</div>
        <div>entry: {ui.entry}</div>
        <div>filesystem: {filesystem}</div>
        <div>network: {ui.permissions?.network ? 'yes' : 'no'}</div>
        <div>secrets: {secrets}</div>
        <div>subprocess: {subprocess}</div>
      </div>
      <CardActions cancelLabel="Skip" confirmLabel="Install" disabled={acting} onCancel={dismiss} onConfirm={install} />
    </div>
  );
}

function ToolPackageDisableCard({ ui, executionId, onDone }: { ui: Extract<ApprovalUI, { kind: 'tool_package_disable' }>; executionId: string; onDone: () => void }) {
  const [acting, setActing] = useState(false);

  async function disable() {
    setActing(true);
    try { await approveExecution(executionId); onDone(); } finally { setActing(false); }
  }
  async function dismiss() {
    setActing(true);
    try { await rejectExecution(executionId); onDone(); } finally { setActing(false); }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div>
        <p className="text-[15px] font-semibold text-foreground">Disable generated tool</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {ui.name || ui.packageId} will be removed from the active MCP connections.
        </p>
      </div>
      <CardActions cancelLabel="Cancel" confirmLabel="Disable" disabled={acting} onCancel={dismiss} onConfirm={disable} />
    </div>
  );
}

// ─── Confirm ────────────────────────────────────────────────────────────────

function ConfirmCard({ ui, executionId, onDone }: { ui: Extract<ApprovalUI, { kind: 'confirm' }>; executionId: string; onDone: () => void }) {
  const [acting, setActing] = useState(false);

  async function confirm() {
    setActing(true);
    try { await approveExecution(executionId); onDone(); } finally { setActing(false); }
  }
  async function dismiss() {
    setActing(true);
    try { await rejectExecution(executionId); onDone(); } finally { setActing(false); }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <div>
        <p className={cn('text-[15px] font-semibold', ui.danger ? 'text-destructive' : 'text-foreground')}>{ui.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{ui.description}</p>
        {ui.details && (
          <p className="mt-2 rounded-xl bg-muted/40 px-3.5 py-2 font-mono text-[11px] text-muted-foreground">{ui.details}</p>
        )}
      </div>
      <CardActions cancelLabel="Cancel" confirmLabel="Confirm" danger={ui.danger} disabled={acting} onCancel={dismiss} onConfirm={confirm} />
    </div>
  );
}

// ─── Generic fallback (no ui field) ─────────────────────────────────────────

function GenericApprovalCard({ action, executionId, onDone }: { action: string | null; executionId: string; onDone: () => void }) {
  const [acting, setActing] = useState(false);

  async function approve() {
    setActing(true);
    try { await approveExecution(executionId); onDone(); } finally { setActing(false); }
  }
  async function reject() {
    setActing(true);
    try { await rejectExecution(executionId); onDone(); } finally { setActing(false); }
  }

  return (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Cable size={14} />
        </span>
        <div>
          <p className="text-[15px] font-semibold text-foreground">Approval needed</p>
          {action && <p className="text-xs text-muted-foreground font-mono">{action}</p>}
        </div>
      </div>
      <CardActions cancelLabel="Reject" confirmLabel="Approve" disabled={acting} onCancel={reject} onConfirm={approve} />
    </div>
  );
}

// ─── Router ──────────────────────────────────────────────────────────────────

export function ApprovalCard({
  ui,
  action,
  executionId,
  onDone,
}: {
  ui?: ApprovalUI;
  action: string | null;
  executionId: string;
  onDone: () => void;
}) {
  if (!ui) return <GenericApprovalCard action={action} executionId={executionId} onDone={onDone} />;
  switch (ui.kind) {
    case 'question':       return <QuestionCard       ui={ui} executionId={executionId} onDone={onDone} />;
    case 'connection':     return <ConnectionCard     ui={ui} executionId={executionId} onDone={onDone} />;
    case 'trigger_preview':return <TriggerPreviewCard ui={ui} executionId={executionId} onDone={onDone} />;
    case 'secret_entry':   return <SecretEntryCard    ui={ui} executionId={executionId} onDone={onDone} />;
    case 'dependency':     return <DependencyCard     ui={ui} executionId={executionId} onDone={onDone} />;
    case 'tool_package':   return <ToolPackageCard    ui={ui} executionId={executionId} onDone={onDone} />;
    case 'tool_package_disable': return <ToolPackageDisableCard ui={ui} executionId={executionId} onDone={onDone} />;
    case 'confirm':        return <ConfirmCard        ui={ui} executionId={executionId} onDone={onDone} />;
    default:               return <GenericApprovalCard action={action} executionId={executionId} onDone={onDone} />;
  }
}
